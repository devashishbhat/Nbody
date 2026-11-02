import { defineScenario } from '@nbody/protocol';
import { describe, expect, it } from 'vitest';
import { resolveCollisions } from './collisions.ts';
import { ReferenceEngine } from './engine.ts';
import { RefState } from './state.ts';

interface BodySpec {
  name: string;
  mass: number;
  radius: number;
  p: [number, number, number];
  v: [number, number, number];
  locked?: boolean;
}

function build(bodies: BodySpec[]): RefState {
  const state = new RefState();
  state.loadFrom(
    defineScenario({
      id: 'c',
      name: 'C',
      description: '',
      units: 'natural',
      dt: 1e-3,
      timeScale: 1,
      bodies: bodies.map((b) => ({
        name: b.name,
        mass: b.mass,
        radius: b.radius,
        position: b.p,
        velocity: b.v,
        ...(b.locked ? { locked: true } : {}),
      })),
    }),
  );
  return state;
}

function momentum(state: RefState): [number, number, number] {
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < state.count; i++) {
    px += state.mass[i] * state.vx[i];
    py += state.mass[i] * state.vy[i];
    pz += state.mass[i] * state.vz[i];
  }
  return [px, py, pz];
}

function kinetic(state: RefState): number {
  let total = 0;
  for (let i = 0; i < state.count; i++) {
    total += 0.5 * state.mass[i] * (state.vx[i] ** 2 + state.vy[i] ** 2 + state.vz[i] ** 2);
  }
  return total;
}

/** Two bodies closing head-on, overlapping by a little. */
function headOn(m1: number, m2: number, speed: number): RefState {
  return build([
    { name: 'A', mass: m1, radius: 0.5, p: [-0.45, 0, 0], v: [speed, 0, 0] },
    { name: 'B', mass: m2, radius: 0.5, p: [0.45, 0, 0], v: [-speed, 0, 0] },
  ]);
}

describe('merging', () => {
  it('conserves mass, momentum and volume', () => {
    const state = build([
      { name: 'A', mass: 3, radius: 0.5, p: [0, 0, 0], v: [1, 0, 0] },
      { name: 'B', mass: 1, radius: 0.3, p: [0.4, 0, 0], v: [-2, 1, 0] },
    ]);
    const before = momentum(state);
    const volumeBefore = 0.5 ** 3 + 0.3 ** 3;

    expect(resolveCollisions(state, 'merge', 1, 0).merges).toBe(1);

    expect(state.count).toBe(1);
    expect(state.mass[0]).toBe(4);
    const after = momentum(state);
    expect(after[0]).toBeCloseTo(before[0], 12);
    expect(after[1]).toBeCloseTo(before[1], 12);
    expect(state.radius[0] ** 3).toBeCloseTo(volumeBefore, 12);
  });

  it('keeps the heavier body identity so its trail survives', () => {
    const state = build([
      { name: 'Pebble', mass: 1, radius: 0.5, p: [0, 0, 0], v: [0, 0, 0] },
      { name: 'Planet', mass: 100, radius: 0.5, p: [0.4, 0, 0], v: [0, 0, 0] },
    ]);
    const planetHandle = state.handles[1];
    resolveCollisions(state, 'merge', 1, 0);
    expect(state.names[0]).toBe('Planet');
    expect(state.handles[0]).toBe(planetHandle);
  });

  it('collapses a pile-up in one pass', () => {
    const state = build(
      Array.from({ length: 5 }, (_, i) => ({
        name: `B${i}`,
        mass: 1,
        radius: 0.5,
        p: [i * 0.1, 0, 0] as [number, number, number],
        v: [0, 0, 0] as [number, number, number],
      })),
    );
    expect(resolveCollisions(state, 'merge', 1, 0).merges).toBe(4);
    expect(state.count).toBe(1);
    expect(state.mass[0]).toBe(5);
  });
});

describe('bouncing', () => {
  it('conserves momentum exactly, whatever the restitution', () => {
    // The impulse acts along the line of centres and is split by inverse mass,
    // so this holds for any pair and any bounciness.
    for (const restitution of [0, 0.3, 0.75, 1]) {
      const state = headOn(3, 7, 1.5);
      const before = momentum(state);
      expect(resolveCollisions(state, 'bounce', 1, restitution).bounces).toBe(1);
      const after = momentum(state);
      expect(after[0]).toBeCloseTo(before[0], 12);
      expect(after[1]).toBeCloseTo(before[1], 12);
      expect(after[2]).toBeCloseTo(before[2], 12);
      expect(state.count).toBe(2);
    }
  });

  it('conserves kinetic energy when perfectly elastic', () => {
    const state = headOn(2, 5, 1.2);
    const before = kinetic(state);
    resolveCollisions(state, 'bounce', 1, 1);
    expect(kinetic(state)).toBeCloseTo(before, 10);
  });

  it('swaps the velocities of equal masses in a head-on elastic hit', () => {
    // The textbook result, and a sharp check on the impulse split.
    const state = headOn(1, 1, 2);
    resolveCollisions(state, 'bounce', 1, 1);
    expect(state.vx[0]).toBeCloseTo(-2, 10);
    expect(state.vx[1]).toBeCloseTo(2, 10);
  });

  it('leaves no closing speed when perfectly inelastic', () => {
    const state = headOn(1, 1, 2);
    resolveCollisions(state, 'bounce', 1, 0);
    // Not merged, but no longer approaching.
    expect(state.count).toBe(2);
    expect(state.vx[1] - state.vx[0]).toBeCloseTo(0, 10);
  });

  it('loses energy in proportion to the bounciness', () => {
    const energies = [1, 0.6, 0.2].map((restitution) => {
      const state = headOn(1, 1, 2);
      resolveCollisions(state, 'bounce', 1, restitution);
      return kinetic(state);
    });
    expect(energies[0]!).toBeGreaterThan(energies[1]!);
    expect(energies[1]!).toBeGreaterThan(energies[2]!);
  });

  it('separates the pair, so the same contact is not resolved twice', () => {
    // Pushing them to exactly touching leaves them in contact and the pair
    // buzzes, resolving an impact every step.
    const state = headOn(1, 1, 1);
    expect(resolveCollisions(state, 'bounce', 1, 0.5).bounces).toBe(1);
    expect(resolveCollisions(state, 'bounce', 1, 0.5).bounces).toBe(0);

    const separation = Math.abs(state.x[1] - state.x[0]);
    expect(separation).toBeGreaterThanOrEqual(state.radius[0] + state.radius[1]);
  });

  it('ignores an overlapping pair that is already separating', () => {
    const state = build([
      { name: 'A', mass: 1, radius: 0.5, p: [-0.4, 0, 0], v: [-1, 0, 0] },
      { name: 'B', mass: 1, radius: 0.5, p: [0.4, 0, 0], v: [1, 0, 0] },
    ]);
    expect(resolveCollisions(state, 'bounce', 1, 1).bounces).toBe(0);
    expect(state.vx[0]).toBe(-1);
  });

  it('resolves a glancing hit along the line of centres only', () => {
    // The tangential component is untouched: a graze is not an impact at the
    // full closing speed.
    const state = build([
      { name: 'A', mass: 1, radius: 0.5, p: [0, -0.45, 0], v: [3, 1, 0] },
      { name: 'B', mass: 1, radius: 0.5, p: [0, 0.45, 0], v: [3, -1, 0] },
    ]);
    resolveCollisions(state, 'bounce', 1, 1);
    // Shared x velocity survives; the y components reverse.
    expect(state.vx[0]).toBeCloseTo(3, 10);
    expect(state.vx[1]).toBeCloseTo(3, 10);
    expect(state.vy[0]).toBeCloseTo(-1, 10);
    expect(state.vy[1]).toBeCloseTo(1, 10);
  });

  it('does not move a pinned body, and reflects what hits it', () => {
    const state = build([
      { name: 'Wall', mass: 10, radius: 0.5, p: [0, 0, 0], v: [0, 0, 0], locked: true },
      { name: 'Ball', mass: 1, radius: 0.3, p: [0.7, 0, 0], v: [-2, 0, 0] },
    ]);
    resolveCollisions(state, 'bounce', 1, 1);
    expect(state.vx[0]).toBe(0);
    expect(state.x[0]).toBe(0);
    expect(state.vx[1]).toBeCloseTo(2, 10);
  });

  it('reflects a massless particle without disturbing the massive body', () => {
    // A dust grain does not recoil a planet, and treating it as a finite mass
    // would have it do exactly that.
    const state = build([
      { name: 'Planet', mass: 5, radius: 0.5, p: [0, 0, 0], v: [0, 0, 0] },
      { name: 'Grain', mass: 0, radius: 0.1, p: [0.55, 0, 0], v: [-3, 0, 0] },
    ]);
    resolveCollisions(state, 'bounce', 1, 1);
    expect(state.vx[0]).toBe(0);
    expect(state.vx[1]).toBeCloseTo(3, 10);
  });

  it('does nothing for two massless particles', () => {
    // Neither can move the other, so there is nothing to resolve. The third
    // body is there only because a scenario needs some mass somewhere to
    // validate; it sits far enough away to touch nothing.
    const state = build([
      { name: 'A', mass: 0, radius: 0.5, p: [-0.4, 0, 0], v: [1, 0, 0] },
      { name: 'B', mass: 0, radius: 0.5, p: [0.4, 0, 0], v: [-1, 0, 0] },
      { name: 'Far', mass: 1, radius: 0.1, p: [500, 0, 0], v: [0, 0, 0] },
    ]);

    expect(resolveCollisions(state, 'bounce', 1, 1).bounces).toBe(0);
    expect(state.vx[0]).toBe(1);
    expect(state.vx[1]).toBe(-1);
    expect(state.count).toBe(3);
  });
});

describe('realistic mode', () => {
  /**
   * Mutual escape velocity for a contacting pair.
   *
   * sqrt(2 G (m1 + m2) / (r1 + r2)). Below this they cannot separate again
   * whatever they do, so they accrete; above it they arrive with enough energy
   * to leave.
   */
  function escapeSpeed(G: number, m1: number, m2: number, contact: number): number {
    return Math.sqrt((2 * G * (m1 + m2)) / contact);
  }

  it('merges a slow impact and scatters a fast one', () => {
    const G = 1;
    const escape = escapeSpeed(G, 1, 1, 1);

    // Each body carries half the closing speed.
    const slow = headOn(1, 1, escape * 0.2);
    expect(resolveCollisions(slow, 'realistic', G, 0.3).merges).toBe(1);
    expect(slow.count).toBe(1);

    const fast = headOn(1, 1, escape * 5);
    const result = resolveCollisions(fast, 'realistic', G, 0.3);
    expect(result.merges).toBe(0);
    expect(result.bounces).toBe(1);
    expect(fast.count).toBe(2);
  });

  it('puts the threshold at the escape velocity', () => {
    const G = 1;
    const escape = escapeSpeed(G, 1, 1, 1);

    // Closing speed is twice each body's speed in a symmetric head-on hit.
    const below = headOn(1, 1, escape * 0.49);
    expect(resolveCollisions(below, 'realistic', G, 0.3).merges).toBe(1);

    const above = headOn(1, 1, escape * 0.51);
    expect(resolveCollisions(above, 'realistic', G, 0.3).merges).toBe(0);
  });

  it('scales the threshold with mass, so heavy bodies accrete more readily', () => {
    const G = 1;
    // The same closing speed that scatters a light pair is captured by a
    // heavy one, because escape velocity grows with mass.
    const speed = 0.8;

    const light = headOn(0.1, 0.1, speed);
    expect(resolveCollisions(light, 'realistic', G, 0.3).merges).toBe(0);

    const heavy = headOn(100, 100, speed);
    expect(resolveCollisions(heavy, 'realistic', G, 0.3).merges).toBe(1);
  });

  it('treats a graze by its closing speed, not its total speed', () => {
    // Two bodies sweeping past each other fast but barely converging are
    // captured, which a test on speed rather than closing speed would miss.
    const G = 1;
    const state = build([
      { name: 'A', mass: 50, radius: 0.5, p: [0, -0.45, 0], v: [9, 0.01, 0] },
      { name: 'B', mass: 50, radius: 0.5, p: [0, 0.45, 0], v: [9, -0.01, 0] },
    ]);
    expect(resolveCollisions(state, 'realistic', G, 0.3).merges).toBe(1);
  });

  it('never absorbs a pinned body', () => {
    const state = build([
      { name: 'Anchor', mass: 10, radius: 0.5, p: [0, 0, 0], v: [0, 0, 0], locked: true },
      { name: 'Rock', mass: 1, radius: 0.3, p: [0.7, 0, 0], v: [-0.01, 0, 0] },
    ]);
    const result = resolveCollisions(state, 'realistic', 1, 0.3);
    expect(result.merges).toBe(0);
    expect(state.count).toBe(2);
    expect(state.x[0]).toBe(0);
  });
});

describe('through the engine', () => {
  function crash(collisions: 'none' | 'merge' | 'bounce' | 'realistic', speed: number) {
    const engine = new ReferenceEngine();
    engine.load(
      defineScenario({
        id: 'crash',
        name: 'Crash',
        description: '',
        units: 'natural',
        dt: 1e-3,
        collisions,
        restitution: 0.5,
        softening: 0.05,
        forceModel: 'direct',
        timeScale: 1,
        bodies: [
          { name: 'A', mass: 1, radius: 0.1, position: [-0.5, 0, 0], velocity: [speed, 0, 0] },
          { name: 'B', mass: 1, radius: 0.1, position: [0.5, 0, 0], velocity: [-speed, 0, 0] },
        ],
      }),
    );
    for (let i = 0; i < 4000; i++) engine.step();
    return engine;
  }

  it('merges a slow approach', () => {
    expect(crash('merge', 0.1).state.count).toBe(1);
  });

  it('bounces instead of merging, keeping both bodies', () => {
    const engine = crash('bounce', 0.1);
    expect(engine.state.count).toBe(2);
    expect(engine.diverged).toBe(false);
  });

  it('passes through when collisions are off', () => {
    expect(crash('none', 0.1).state.count).toBe(2);
  });

  it('stays finite through a very fast impact', () => {
    // Zero softening and a hard hit is the case most likely to blow up.
    const engine = crash('realistic', 40);
    expect(engine.diverged).toBe(false);
    expect(Number.isFinite(engine.measure().energy)).toBe(true);
  });
});
