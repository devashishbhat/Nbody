import {
  BODY_STRIDE,
  DEFAULT_RESTITUTION,
  FrameFlags,
  H,
  resolveForceModel,
  type Body,
  type BodyPatch,
  type FrameView,
  type Scenario,
  type ScenarioSettings,
} from '@nbody/protocol';
import { BarnesHutTree } from './barnes-hut.ts';
import { resolveCollisions } from './collisions.ts';
import { computeDiagnostics, emptyDiagnostics, type Diagnostics } from './diagnostics.ts';
import { Dopri5 } from './dopri5.ts';
import { computeAccelerations, type ForceField } from './forces.ts';
import { stepLeapfrog, stepYoshida4 } from './integrators.ts';
import { RefState } from './state.ts';

/**
 * The simulation engine.
 *
 * Owns the state, the force model and the integrator, and is the only thing
 * that mutates any of them. It implements `ForceField` itself so that the
 * choice between direct summation and Barnes-Hut is made here, once, instead
 * of being threaded through every integrator.
 *
 * Force model selection follows `resolveForceModel`: direct summation below
 * AUTO_BARNES_HUT_THRESHOLD bodies, the octree above it. Direct summation is
 * exact and cheaper at small N; the tree only pays off once N^2 stops fitting
 * in a frame.
 */
export class ReferenceEngine implements ForceField {
  readonly state = new RefState();

  settings: ScenarioSettings = {
    G: 1,
    softening: 0,
    integrator: 'leapfrog',
    dt: 1e-3,
    forceModel: 'auto',
    theta: 0.5,
    collisions: 'none',
    restitution: DEFAULT_RESTITUTION,
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

  private readonly tree = new BarnesHutTree();
  private readonly adaptive = new Dopri5();

  /** Force evaluations since the last publish, for the cost readout. */
  forceEvaluations = 0;

  /** Set when the engine needs to tell the user something non-fatal. */
  warning: string | null = null;

  /**
   * Accelerations for the current positions.
   *
   * This is the ForceField the integrators call. Dispatching here keeps every
   * integrator ignorant of which model is in use.
   */
  compute(state: RefState): void {
    this.forceEvaluations++;
    const { G, softening, theta } = this.settings;
    if (resolveForceModel(this.settings.forceModel, state.count) === 'barnes-hut') {
      this.tree.accelerations(state, G, softening, theta);
    } else {
      computeAccelerations(state, G, softening);
    }
  }

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
      restitution: scenario.restitution,
      timeScale: scenario.timeScale,
    };
    this.state.loadFrom(scenario);
    this.simTime = 0;
    this.stepCount = 0;
    this.diverged = false;
    this.adaptive.restart();
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
    this.compute(this.state);
  }

  /**
   * Advances one step and returns the simulation time actually elapsed.
   *
   * Fixed-step integrators always return `settings.dt`. The adaptive one
   * returns whatever it accepted, which is at most `|dt|` and may be far less
   * through a close encounter, so callers must use the return value rather
   * than assuming `dt`.
   */
  step(): number {
    if (this.diverged) return 0;
    const { dt, integrator, collisions } = this.settings;

    let advanced: number;
    if (integrator === 'dopri5') {
      advanced = this.adaptive.step(this.state, this, dt);
      // The adaptive integrator leaves accelerations evaluated at its last
      // internal stage, not at the accepted state, so the entry invariant the
      // symplectic integrators rely on has to be restored in case the user
      // switches integrator next step.
      this.refreshForces();
    } else if (integrator === 'yoshida4') {
      stepYoshida4(this.state, this, dt);
      advanced = dt;
    } else {
      stepLeapfrog(this.state, this, dt);
      advanced = dt;
    }

    this.simTime += advanced;
    this.stepCount++;

    if (collisions !== 'none') {
      const { merges, bounces } = resolveCollisions(
        this.state,
        collisions,
        this.settings.G,
        this.settings.restitution,
      );
      if (merges > 0 || bounces > 0) {
        this.pendingFlags |= FrameFlags.Collided;
        // Only a merge changes the set of bodies. A bounce leaves every handle
        // in place, so flagging a topology change for it would clear the
        // trails on every impact.
        if (merges > 0) this.pendingFlags |= FrameFlags.TopologyChanged;
        // Both change positions or velocities discontinuously, which breaks
        // the integrators' entry invariant and invalidates any step size the
        // adaptive controller had measured.
        this.refreshForces();
        this.adaptive.restart();

        // Re-baseline the energy drift readout. A merge is inelastic and a
        // bounce below perfect restitution is too, so both genuinely remove
        // energy from the system: that is physics, not integration error, and
        // leaving it in the drift figure would have the accuracy readout climb
        // to 1e-2 on a preset that is working exactly as intended. The same
        // reasoning already applies when G or the softening changes. What the
        // readout means is the integration error since the system last
        // changed, which is the question it is there to answer.
        this.energy0 = this.measure().energy;
      }
    }

    return advanced;
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
    this.adaptive.restart();
  }

  removeBody(id: string): void {
    const i = this.state.slotOf(id);
    if (i < 0) return;
    this.state.removeAt(i);
    this.pendingFlags |= FrameFlags.TopologyChanged;
    this.refreshForces();
    this.adaptive.restart();
  }

  applySettings(patch: Partial<ScenarioSettings>): void {
    const before = this.settings;
    this.settings = { ...before, ...patch };
    // A carried step size is only valid for the dynamics it was measured
    // against, so anything that changes the force field or the step bound
    // discards it.
    if (
      patch.G !== undefined ||
      patch.softening !== undefined ||
      patch.dt !== undefined ||
      patch.integrator !== undefined ||
      patch.forceModel !== undefined ||
      patch.theta !== undefined
    ) {
      this.adaptive.restart();
    }
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
    scenario.restitution = this.settings.restitution;
    scenario.timeScale = this.settings.timeScale;
    return scenario;
  }

  /** Model actually in use, with `auto` resolved against the live body count. */
  activeForceModel(): 'direct' | 'barnes-hut' {
    return resolveForceModel(this.settings.forceModel, this.state.count);
  }

  /** Octree nodes in the most recent tree, or 0 under direct summation. */
  treeNodes(): number {
    return this.activeForceModel() === 'barnes-hut' ? this.tree.nodes : 0;
  }

  /** Steps the adaptive controller rejected, as a fraction of those tried. */
  rejectionRate(): number {
    const total = this.adaptive.accepted + this.adaptive.rejected;
    return total === 0 ? 0 : this.adaptive.rejected / total;
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
