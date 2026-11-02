import {
  allocateFrame,
  BODY_STRIDE,
  FrameView,
  H,
  type EngineClient,
  type FrameSample,
  type Scenario,
} from '@nbody/protocol';

/**
 * Analytic mock engine.
 *
 * Bodies move on exact circular orbits, evaluated in closed form at whatever
 * instant the renderer asks for. Nothing is integrated and nothing jitters.
 *
 * This exists so the renderer lane can build and judge its own work before the
 * real engine is ready, and so it has a reference that is smooth by
 * construction: if motion looks uneven against this source, the fault is in
 * the renderer or the camera, not in the physics or the interpolator.
 *
 * It satisfies EngineClient so it can be dropped in wherever the real client
 * goes. Control messages that would change the physics are accepted and
 * ignored.
 */

interface MockOrbit {
  radius: number;
  period: number;
  phase: number;
  inclination: number;
}

export interface MockEngineOptions {
  /** Number of orbiting bodies, not counting the central one. */
  bodyCount?: number;
  /** Multiplies every orbital rate. */
  speed?: number;
  /** Tilts orbits out of the plane, to exercise the 3D camera. */
  spread?: number;
}

export function createMockEngineClient(options: MockEngineOptions = {}): EngineClient {
  const orbitCount = options.bodyCount ?? 8;
  const speed = options.speed ?? 1;
  const spread = options.spread ?? 0;
  const count = orbitCount + 1;

  const orbits: MockOrbit[] = [];
  for (let i = 0; i < orbitCount; i++) {
    const radius = 0.4 + i * 0.45;
    orbits.push({
      radius,
      // Kepler's third law, so the inner bodies visibly outrun the outer ones.
      period: (6 * Math.pow(radius, 1.5)) / speed,
      phase: (i * 2.399963) % (Math.PI * 2),
      inclination: spread * Math.sin(i * 1.7),
    });
  }

  const positions = new Float64Array(count * 3);
  const velocities = new Float64Array(count * 3);
  const handles = new Uint32Array(count);
  for (let i = 0; i < count; i++) handles[i] = i + 1;

  const view = new FrameView(allocateFrame(count));
  view.header[H.bodyCount] = count;
  view.header[H.energy0] = -1;
  view.header[H.energy] = -1;
  view.header[H.publishDt] = 1 / 60;
  for (let i = 0; i < count; i++) view.handles[i] = handles[i];

  const sample: FrameSample = {
    count,
    simTime: 0,
    positions,
    velocities,
    handles,
    topologyVersion: 0,
    latest: view,
  };
  const mutable = sample as {
    simTime: number;
    count: number;
  };

  let running = true;
  let simTime = 0;
  let lastMs = 0;
  let timeScale = 1;

  function evaluate(t: number): void {
    // Central body at the origin.
    positions[0] = 0;
    positions[1] = 0;
    positions[2] = 0;
    velocities[0] = 0;
    velocities[1] = 0;
    velocities[2] = 0;

    for (let i = 0; i < orbits.length; i++) {
      const orbit = orbits[i]!;
      const omega = (Math.PI * 2) / orbit.period;
      const angle = orbit.phase + omega * t;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const ci = Math.cos(orbit.inclination);
      const si = Math.sin(orbit.inclination);

      const d = (i + 1) * 3;
      positions[d] = orbit.radius * cos;
      positions[d + 1] = orbit.radius * sin * ci;
      positions[d + 2] = orbit.radius * sin * si;

      const v = orbit.radius * omega;
      velocities[d] = -v * sin;
      velocities[d + 1] = v * cos * ci;
      velocities[d + 2] = v * cos * si;
    }

    for (let i = 0; i < count; i++) {
      const s = i * BODY_STRIDE;
      const d = i * 3;
      view.bodies[s] = positions[d];
      view.bodies[s + 1] = positions[d + 1];
      view.bodies[s + 2] = positions[d + 2];
      view.bodies[s + 3] = velocities[d];
      view.bodies[s + 4] = velocities[d + 1];
      view.bodies[s + 5] = velocities[d + 2];
    }
    view.header[H.simTime] = t;
  }

  evaluate(0);

  const noop = () => {};

  return {
    ready: Promise.resolve({ engine: 'reference' as const }),
    load: noop,
    play: () => {
      running = true;
    },
    pause: () => {
      running = false;
    },
    stepOnce: (steps = 1) => {
      simTime += steps / 60;
      evaluate(simTime);
    },
    reset: () => {
      simTime = 0;
      evaluate(0);
    },
    setTimeScale: (value: number) => {
      timeScale = value;
    },
    setIntegrator: noop,
    setDt: noop,
    setTheta: noop,
    setForceModel: noop,
    setCollisions: noop,
    setRestitution: noop,
    setSoftening: noop,
    setG: noop,
    patchBody: noop,
    addBody: noop,
    removeBody: noop,
    snapshot: () => Promise.reject(new Error('the mock engine has no scenario to snapshot')),

    sample(nowMs: number): FrameSample {
      const delta = lastMs === 0 ? 0 : (nowMs - lastMs) / 1000;
      lastMs = nowMs;
      if (running) simTime += delta * timeScale;
      evaluate(simTime);
      mutable.simTime = simTime;
      mutable.count = count;
      return sample;
    },

    onError: () => noop,
    dispose: noop,
  };
}

/** A scenario-shaped description of the mock, for UI panels that expect one. */
export const MOCK_SCENARIO_NAME = 'Mock Orbits';
export type { Scenario as MockScenario };
