import { parseScenario } from './schema.ts';
import {
  DEFAULT_RESTITUTION,
  DEFAULT_THETA,
  type Body,
  type CameraState,
  type CollisionMode,
  type ForceModelId,
  type IntegratorId,
  type Scenario,
  type Vec3,
} from './scenario.ts';
import { defaultG, type UnitSystem } from './units.ts';

/**
 * Concise preset authoring.
 *
 * A preset file should state the physics that matters and nothing else. Every
 * field with a defensible default is optional here, and `defineScenario`
 * validates the completed result immediately, so a malformed preset fails at
 * module load with a precise message rather than rendering a blank screen.
 */

export interface BodyInput {
  /** Defaults to a slug of `name`, suffixed if that collides. */
  id?: string;
  name: string;
  mass: number;
  /** Defaults to a mass-derived display radius. Supply the true value when
   *  the preset is meant to be viewed at true scale. */
  radius?: number;
  position: readonly [number, number, number];
  velocity: readonly [number, number, number];
  /** Defaults to the next entry in FALLBACK_PALETTE. */
  color?: string;
  locked?: boolean;
  trail?: boolean;
}

export interface ScenarioInput {
  id: string;
  name: string;
  description: string;
  watchFor?: string;
  units: UnitSystem;
  /** Defaults to the unit system's natural value. */
  G?: number;
  softening?: number;
  integrator?: IntegratorId;
  dt: number;
  forceModel?: ForceModelId;
  theta?: number;
  collisions?: CollisionMode;
  restitution?: number;
  timeScale: number;
  suggestedDuration?: number;
  bodies: readonly BodyInput[];
  camera?: Partial<CameraState>;
  tags?: readonly string[];
}

/**
 * Neutral fallback colours, used only when a preset does not specify one.
 * Real presets name their own, and the design system owns the palette shown
 * in the UI chrome.
 */
export const FALLBACK_PALETTE: readonly string[] = [
  '#e8e6e3',
  '#7aa2f7',
  '#e0af68',
  '#9ece6a',
  '#f7768e',
  '#bb9af7',
  '#7dcfff',
  '#ff9e64',
];

/**
 * Display radius when a preset omits one.
 *
 * Scaled so that one solar mass gives one solar radius, which makes
 * star-dominated systems look right without any hand tuning. Planets come out
 * too large, which is why presets meant for true-scale viewing supply real
 * radii.
 */
function fallbackRadius(mass: number, units: UnitSystem): number {
  const reference = units === 'solar' ? 0.004650467 : units === 'si' ? 6.957e8 : 0.05;
  if (mass <= 0) return reference * 0.05;
  return reference * Math.cbrt(mass);
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'body'
  );
}

/**
 * Copies a vector, normalising negative zero away.
 *
 * Generated initial conditions produce -0 constantly: `-speed * Math.sin(0)`
 * is -0, and so is any product with a zero factor and a negative sign. It is
 * physically identical to 0, but it is not the same value to `Object.is`, and
 * JSON does not preserve it. Normalising here makes a scenario canonical, so
 * that encoding and decoding a preset gives back exactly the preset.
 */
function toVec3(v: readonly [number, number, number]): Vec3 {
  return [v[0] === 0 ? 0 : v[0], v[1] === 0 ? 0 : v[1], v[2] === 0 ? 0 : v[2]];
}

export function defineScenario(input: ScenarioInput): Scenario {
  const used = new Set<string>();
  const bodies: Body[] = input.bodies.map((b, index) => {
    let id = b.id ?? slug(b.name);
    if (used.has(id)) {
      let suffix = 2;
      while (used.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }
    used.add(id);

    const body: Body = {
      id,
      name: b.name,
      mass: b.mass,
      radius: b.radius ?? fallbackRadius(b.mass, input.units),
      position: toVec3(b.position),
      velocity: toVec3(b.velocity),
      color: b.color ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length],
    };
    // Only recorded when true. `locked: false` and `trail: false` mean
    // exactly what their absence means, and storing them explicitly makes two
    // identical scenarios structurally different, which breaks share-link
    // round trips and preset comparison for no benefit.
    if (b.locked) body.locked = true;
    if (b.trail) body.trail = true;
    return body;
  });

  // A sane default framing: fit everything in view with a little margin.
  const extent = bodies.reduce((max, b) => {
    const r = Math.hypot(b.position[0], b.position[1], b.position[2]);
    return r > max ? r : max;
  }, 0);

  const camera: CameraState = {
    mode: input.camera?.mode ?? '2d',
    target: input.camera?.target ?? [0, 0, 0],
    distance: input.camera?.distance ?? (extent > 0 ? extent * 1.4 : 1),
    azimuth: input.camera?.azimuth ?? 0,
    elevation: input.camera?.elevation ?? Math.PI / 2,
  };
  if (input.camera?.followBodyId !== undefined) {
    camera.followBodyId = input.camera.followBodyId;
  }

  const scenario: Scenario = {
    schema: 1,
    id: input.id,
    name: input.name,
    description: input.description,
    units: input.units,
    G: input.G ?? defaultG(input.units),
    softening: input.softening ?? 0,
    integrator: input.integrator ?? 'leapfrog',
    dt: input.dt,
    forceModel: input.forceModel ?? 'auto',
    theta: input.theta ?? DEFAULT_THETA,
    collisions: input.collisions ?? 'none',
    restitution: input.restitution ?? DEFAULT_RESTITUTION,
    timeScale: input.timeScale,
    bodies,
    camera,
    tags: [...(input.tags ?? [])],
  };
  if (input.watchFor !== undefined) scenario.watchFor = input.watchFor;
  if (input.suggestedDuration !== undefined) {
    scenario.suggestedDuration = input.suggestedDuration;
  }

  // Validate at authoring time so a bad preset fails loudly at module load.
  return parseScenario(scenario);
}

/**
 * Deep copy, used wherever a scenario crosses an ownership boundary.
 *
 * Written out by hand rather than using structuredClone so that this package
 * depends on no host environment at all: it is imported by the worker, the
 * main thread, the node test runner and the Rust build's fixture generator.
 */
export function cloneScenario(scenario: Scenario): Scenario {
  const copy: Scenario = {
    ...scenario,
    bodies: scenario.bodies.map((b) => ({
      ...b,
      position: [b.position[0], b.position[1], b.position[2]] as Vec3,
      velocity: [b.velocity[0], b.velocity[1], b.velocity[2]] as Vec3,
    })),
    tags: [...scenario.tags],
  };
  if (scenario.camera) {
    copy.camera = {
      ...scenario.camera,
      target: [
        scenario.camera.target[0],
        scenario.camera.target[1],
        scenario.camera.target[2],
      ] as Vec3,
    };
  }
  return copy;
}
