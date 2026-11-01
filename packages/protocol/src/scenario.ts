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
 * `bulirsch-stoer` is adaptive. Required for close encounters, collisions and
 * chaotic few-body problems, where any fixed step produces visibly wrong
 * trajectories.
 *
 * Time reversal falls out of the symplectic integrators for free: negate dt
 * and the trajectory retraces itself.
 */
export type IntegratorId = 'leapfrog' | 'yoshida4' | 'bulirsch-stoer';

/**
 * `auto` selects direct summation below AUTO_BARNES_HUT_THRESHOLD bodies and
 * Barnes-Hut above it.
 */
export type ForceModelId = 'direct' | 'barnes-hut' | 'auto';

export type CollisionMode = 'none' | 'merge';

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
  'G' | 'softening' | 'integrator' | 'dt' | 'forceModel' | 'theta' | 'collisions' | 'timeScale'
>;

export const DEFAULT_THETA = 0.5;

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
