import {
  BODY_STRIDE,
  FrameFlags,
  H,
  resolveForceModel,
  type Body,
  type BodyPatch,
  type FrameView,
  type Scenario,
  type ScenarioSettings,
} from '@nbody/protocol';
import { resolveMerges } from './collisions.ts';
import { computeDiagnostics, emptyDiagnostics, type Diagnostics } from './diagnostics.ts';
import { computeAccelerations, stepLeapfrog, stepYoshida4 } from './integrators.ts';
import { RefState } from './state.ts';

/**
 * The TypeScript reference engine.
 *
 * Direct summation and symplectic integration only. It has no octree and no
 * adaptive integrator, so `forceModel`, `theta` and `bulirsch-stoer` are
 * carried for snapshot fidelity but do not change its behaviour. The Rust core
 * is the authority on all three; this engine's job is to be obviously correct,
 * so that any disagreement between the two is a bug in the fast one.
 */
export class ReferenceEngine {
  readonly state = new RefState();

  settings: ScenarioSettings = {
    G: 1,
    softening: 0,
    integrator: 'leapfrog',
    dt: 1e-3,
    forceModel: 'auto',
    theta: 0.5,
    collisions: 'none',
    timeScale: 1,
  };

  simTime = 0;
  stepCount = 0;
  energy0 = 0;
  diverged = false;

  /** Centre of mass at t=0. comDrift is measured against this, not the
   *  origin, because a system set up off-origin is not drifting. */
  private com0X = 0;
  private com0Y = 0;
  private com0Z = 0;

  private template: Scenario | null = null;
  private diagnostics: Diagnostics = emptyDiagnostics();
  private pendingFlags = 0;
  private sequence = 0;
  private unsupportedIntegratorReported = false;

  /** Set when an unsupported setting was silently approximated. */
  warning: string | null = null;

  load(scenario: Scenario): void {
    this.template = scenario;
    this.settings = {
      G: scenario.G,
      softening: scenario.softening,
      integrator: scenario.integrator,
      dt: scenario.dt,
      forceModel: scenario.forceModel,
      theta: scenario.theta,
      collisions: scenario.collisions,
      timeScale: scenario.timeScale,
    };
    this.state.loadFrom(scenario);
    this.simTime = 0;
    this.stepCount = 0;
    this.diverged = false;
    this.unsupportedIntegratorReported = false;
    this.pendingFlags = FrameFlags.TopologyChanged;
    this.refreshForces();
    const initial = this.measure();
    this.energy0 = initial.energy;
    this.com0X = initial.comX;
    this.com0Y = initial.comY;
    this.com0Z = initial.comZ;
  }

  reset(): void {
    if (this.template) {
      const settings = this.settings;
      this.load(this.template);
      // Live setting edits survive a reset. Resetting means "put the bodies
      // back", not "undo my control panel".
      this.settings = settings;
      this.refreshForces();
      this.energy0 = this.measure().energy;
    }
  }

  /** Recomputes accelerations, restoring the integrators' entry invariant. */
  refreshForces(): void {
    computeAccelerations(this.state, this.settings.G, this.settings.softening);
  }

  step(): void {
    if (this.diverged) return;
    const { G, softening, dt, integrator, collisions } = this.settings;

    if (integrator === 'bulirsch-stoer') {
      if (!this.unsupportedIntegratorReported) {
        this.unsupportedIntegratorReported = true;
        this.warning =
          'The reference engine has no adaptive integrator. Using yoshida4 instead. ' +
          'Close encounters will be less accurate than the Rust engine.';
      }
      stepYoshida4(this.state, G, softening, dt);
    } else if (integrator === 'yoshida4') {
      stepYoshida4(this.state, G, softening, dt);
    } else {
      stepLeapfrog(this.state, G, softening, dt);
    }

    this.simTime += dt;
    this.stepCount++;

    if (collisions === 'merge' && resolveMerges(this.state) > 0) {
      this.pendingFlags |= FrameFlags.Collided | FrameFlags.TopologyChanged;
      this.refreshForces();
    }
  }

  measure(): Diagnostics {
    return computeDiagnostics(
      this.state,
      this.settings.G,
      this.settings.softening,
      this.diagnostics,
    );
  }

  patchBody(id: string, patch: BodyPatch): void {
    const i = this.state.slotOf(id);
    if (i < 0) return;
    const s = this.state;
    if (patch.mass !== undefined) s.mass[i] = patch.mass;
    if (patch.radius !== undefined) s.radius[i] = patch.radius;
    if (patch.position) {
      s.x[i] = patch.position[0];
      s.y[i] = patch.position[1];
      s.z[i] = patch.position[2];
    }
    if (patch.velocity) {
      s.vx[i] = patch.velocity[0];
      s.vy[i] = patch.velocity[1];
      s.vz[i] = patch.velocity[2];
    }
    if (patch.name !== undefined) s.names[i] = patch.name;
    if (patch.color !== undefined) s.colors[i] = patch.color;
    if (patch.locked !== undefined) s.locked[i] = patch.locked ? 1 : 0;
    if (patch.trail !== undefined) s.trails[i] = patch.trail;

    // Mass, position and lock state all change the force field, so the
    // integrators' entry invariant has to be restored before the next step.
    if (patch.mass !== undefined || patch.position !== undefined || patch.locked !== undefined) {
      this.refreshForces();
    }
  }

  addBody(body: Body): void {
    this.state.push(body);
    this.pendingFlags |= FrameFlags.TopologyChanged;
    this.refreshForces();
  }

  removeBody(id: string): void {
    const i = this.state.slotOf(id);
    if (i < 0) return;
    this.state.removeAt(i);
    this.pendingFlags |= FrameFlags.TopologyChanged;
    this.refreshForces();
  }

  applySettings(patch: Partial<ScenarioSettings>): void {
    const before = this.settings;
    this.settings = { ...before, ...patch };
    if (patch.G !== undefined || patch.softening !== undefined) {
      this.refreshForces();
      // The conserved quantity itself changed, so the drift baseline has to
      // move with it or the readout would report a fault that is not one.
      this.energy0 = this.measure().energy;
    }
  }

  snapshot(): Scenario {
    const template = this.template;
    if (!template) throw new Error('no scenario loaded');
    const scenario = this.state.toScenario(template);
    scenario.G = this.settings.G;
    scenario.softening = this.settings.softening;
    scenario.integrator = this.settings.integrator;
    scenario.dt = this.settings.dt;
    scenario.forceModel = this.settings.forceModel;
    scenario.theta = this.settings.theta;
    scenario.collisions = this.settings.collisions;
    scenario.timeScale = this.settings.timeScale;
    return scenario;
  }

  /** Model actually in use, with `auto` resolved against the live body count. */
  activeForceModel(): 'direct' | 'barnes-hut' {
    return resolveForceModel(this.settings.forceModel, this.state.count);
  }

  /**
   * Writes the current state into a frame buffer and clears pending flags.
   *
   * `publishDt` is the sim time elapsed since the previous publish, which the
   * client's interpolator needs in order to place this frame on its playback
   * timeline. Allocates nothing.
   */
  writeFrame(view: FrameView, publishDt: number, msPerStep: number, paused: boolean): void {
    const s = this.state;
    const n = Math.min(s.count, view.capacity);
    const diag = this.measure();

    const dest = view.bodies;
    for (let i = 0; i < n; i++) {
      const d = i * BODY_STRIDE;
      dest[d] = s.x[i];
      dest[d + 1] = s.y[i];
      dest[d + 2] = s.z[i];
      dest[d + 3] = s.vx[i];
      dest[d + 4] = s.vy[i];
      dest[d + 5] = s.vz[i];
      view.handles[i] = s.handles[i];
    }

    if (!Number.isFinite(diag.energy)) {
      this.diverged = true;
      this.pendingFlags |= FrameFlags.Diverged;
    }

    let flags = this.pendingFlags;
    if (paused) flags |= FrameFlags.Paused;
    if (this.settings.dt < 0) flags |= FrameFlags.Reversed;
    if (this.diverged) flags |= FrameFlags.Diverged;

    const header = view.header;
    header[H.simTime] = this.simTime;
    header[H.stepCount] = this.stepCount;
    header[H.bodyCount] = n;
    header[H.energy] = diag.energy;
    header[H.energy0] = this.energy0;
    header[H.angularMomentum] = diag.angularMomentum;
    header[H.momentum] = diag.momentum;
    header[H.comDrift] = Math.hypot(
      diag.comX - this.com0X,
      diag.comY - this.com0Y,
      diag.comZ - this.com0Z,
    );
    header[H.virialRatio] = diag.virialRatio;
    header[H.msPerStep] = msPerStep;
    header[H.publishDt] = publishDt;
    header[H.flags] = flags;
    header[H.sequence] = ++this.sequence;

    this.pendingFlags = 0;
  }
}
