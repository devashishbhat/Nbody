import type { UnitSystem } from './units.ts';

export type Vec3 = readonly [number, number, number];

/**
 * Integrators.
 *
 * `leapfrog` is kick-drift-kick velocity Verlet: symplectic, time-symmetric,
 * one force evaluation per step. Its energy error stays bounded rather than
 * drifting, and it conserves momentum exactly, which is why it is the default
 * for a tool whose job is to look right over long runs.
 *
 * `yoshida4` is a 4th order symplectic composition, three force evaluations
 * per step. For long accurate runs such as a thousand-orbit solar system.
 *
 * `dopri5` is Dormand-Prince 5(4), adaptive. Required for close encounters,
 * collisions and chaotic few-body problems, where any fixed step produces
 * visibly wrong trajectories. It is not symplectic and not time-symmetric, so
 * its energy drifts rather than oscillating and reversing time under it does
 * not retrace the path exactly. The plan called for Gragg-Bulirsch-Stoer;
 * packages/engine/src/reference/dopri5.ts records why this is here instead.
 *
 * Time reversal falls out of the symplectic integrators for free: negate dt
 * and the trajectory retraces itself.
 */
export type IntegratorId = 'leapfrog' | 'yoshida4' | 'dopri5';

/**
 * `auto` selects direct summation below AUTO_BARNES_HUT_THRESHOLD bodies and
 * Barnes-Hut above it.
 */
export type ForceModelId = 'direct' | 'barnes-hut' | 'auto';

/**
 * What happens when two bodies touch.
 *
 * `none` lets them pass through each other, which is the right default: at
 * astronomical scale bodies almost never actually hit, and the geometry is
 * usually there to be looked at rather than enforced.
 *
 * `merge` always combines them, conserving mass, momentum and volume. This is
 * not a simplification: it is what really happens when two bodies meet slowly
 * enough, and it is how planets were built.
 *
 * `bounce` always rebounds them as hard spheres, with `restitution` setting
 * how much speed survives the impact.
 *
 * `realistic` chooses between the two by the criterion that actually decides
 * it in nature: whether the bodies are closing faster than their mutual
 * escape velocity. Below it, gravity wins and they accrete. Above it, they
 * have more than enough energy to separate again, so they scatter.
 */
export type CollisionMode = 'none' | 'merge' | 'bounce' | 'realistic';

export type CameraMode = '2d' | '3d';

/** Body count at which `forceModel: 'auto'` switches to Barnes-Hut. */
export const AUTO_BARNES_HUT_THRESHOLD = 2000;

/** Hard sanity bound, so a hostile share link cannot ask for 10^9 bodies. */
export const MAX_BODIES = 100_000;

export interface Body {
  /** Stable within a scenario. Survives edits. Used by the UI and for sharing. */
  id: string;
  name: string;
  /** May be 0 for a massless test particle, which is how test particles in
   *  restricted problems and asteroid belts are represented. */
  mass: number;
  /** Physical radius, in the scenario's length unit. Drives collisions and
   *  true-scale rendering. Never used as a display size directly. */
  radius: number;
  position: Vec3;
  velocity: Vec3;
  /** `#rrggbb`. */
  color: string;
  /** Immovable. Forces act from it but not on it. For restricted problems. */
  locked?: boolean;
  /** Render a trail for this body. Capped by the renderer, see MAX_TRAILS. */
  trail?: boolean;
}

export interface CameraState {
  mode: CameraMode;
  /** World-space look-at point. */
  target: Vec3;
  /** Orthographic half-height in 2d mode, orbit radius in 3d mode. */
  distance: number;
  /** Radians. 3d mode only. */
  azimuth: number;
  /** Radians. 3d mode only. */
  elevation: number;
  /** When set, the camera target tracks this body every frame. */
  followBodyId?: string;
}

export interface Scenario {
  schema: 1;
  /** Stable slug. Share links reference presets by this. */
  id: string;
  name: string;
  /** One or two sentences, shown in the preset picker. */
  description: string;
  /** Optional nudge toward what makes this setup interesting. */
  watchFor?: string;

  units: UnitSystem;
  /** In the scenario's own units. Editable, because making gravity stronger
   *  is one of the first things anyone will try. */
  G: number;
  /** Plummer softening epsilon. 0 is allowed and is correct for the periodic
   *  families, which must stay exactly Newtonian to close their orbits. */
  softening: number;

  integrator: IntegratorId;
  /** Fixed step, in the scenario's time unit. Negative runs time backwards. */
  dt: number;
  forceModel: ForceModelId;
  /** Barnes-Hut opening angle. Smaller is more accurate and slower. */
  theta: number;
  collisions: CollisionMode;
  /**
   * Coefficient of restitution, 0 to 1. Used by `bounce` and `realistic`.
   *
   * The fraction of the closing speed that survives a rebound. 1 is perfectly
   * elastic and conserves kinetic energy; 0 means the bodies stop dead
   * relative to each other without combining. Real rock on rock is around
   * 0.1 to 0.4, which is why the default is low.
   */
  restitution: number;

  /** Sim time units advanced per real second at 1x speed. */
  timeScale: number;
  /** Suggested run length, used to label the preset. Not enforced. */
  suggestedDuration?: number;

  bodies: Body[];
  camera?: CameraState;
  tags: string[];
}

export type BodyPatch = Partial<Omit<Body, 'id'>>;

/** Fields that can be changed live without reloading the scenario. */
export type ScenarioSettings = Pick<
  Scenario,
  | 'G'
  | 'softening'
  | 'integrator'
  | 'dt'
  | 'forceModel'
  | 'theta'
  | 'collisions'
  | 'restitution'
  | 'timeScale'
>;

export const DEFAULT_THETA = 0.5;

/** Rock on rock, roughly. Deliberately well below elastic. */
export const DEFAULT_RESTITUTION = 0.3;

/**
 * Resolves `auto` against a body count. Kept here rather than in the engine so
 * that the UI can display which model is actually in use without asking the
 * worker.
 */
export function resolveForceModel(
  forceModel: ForceModelId,
  bodyCount: number,
): 'direct' | 'barnes-hut' {
  if (forceModel !== 'auto') return forceModel;
  return bodyCount >= AUTO_BARNES_HUT_THRESHOLD ? 'barnes-hut' : 'direct';
}
