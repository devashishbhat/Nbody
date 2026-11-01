import { defineScenario } from '@nbody/protocol';
import { describe, expect, it } from 'vitest';
import { resolveMerges } from './collisions.ts';
import { ReferenceEngine } from './engine.ts';
import { RefState } from './state.ts';

function state(
  bodies: {
    name: string;
    mass: number;
    radius: number;
    p: [number, number, number];
    v: [number, number, number];
  }[],
): RefState {
  const s = new RefState();
  s.loadFrom(
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
      })),
    }),
  );
  return s;
}

function momentum(s: RefState): [number, number, number] {
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < s.count; i++) {
    px += s.mass[i] * s.vx[i];
    py += s.mass[i] * s.vy[i];
    pz += s.mass[i] * s.vz[i];
  }
  return [px, py, pz];
}

describe('merge-on-contact', () => {
  it('leaves separated bodies alone', () => {
    const s = state([
      { name: 'A', mass: 1, radius: 0.1, p: [0, 0, 0], v: [0, 0, 0] },
      { name: 'B', mass: 1, radius: 0.1, p: [1, 0, 0], v: [0, 0, 0] },
    ]);
    expect(resolveMerges(s)).toBe(0);
    expect(s.count).toBe(2);
  });

  it('conserves mass, momentum and volume', () => {
    const s = state([
      { name: 'A', mass: 3, radius: 0.5, p: [0, 0, 0], v: [1, 0, 0] },
      { name: 'B', mass: 1, radius: 0.3, p: [0.4, 0, 0], v: [-2, 1, 0] },
    ]);
    const before = momentum(s);
    const volumeBefore = 0.5 ** 3 + 0.3 ** 3;

    expect(resolveMerges(s)).toBe(1);

    expect(s.count).toBe(1);
    expect(s.mass[0]).toBe(4);
    const after = momentum(s);
    expect(after[0]).toBeCloseTo(before[0], 12);
    expect(after[1]).toBeCloseTo(before[1], 12);
    expect(after[2]).toBeCloseTo(before[2], 12);
    expect(s.radius[0] ** 3).toBeCloseTo(volumeBefore, 12);
  });

  it('places the merged body at the mass-weighted centre', () => {
    const s = state([
      { name: 'A', mass: 3, radius: 0.5, p: [0, 0, 0], v: [0, 0, 0] },
      { name: 'B', mass: 1, radius: 0.5, p: [0.4, 0, 0], v: [0, 0, 0] },
    ]);
    resolveMerges(s);
    expect(s.x[0]).toBeCloseTo((3 * 0 + 1 * 0.4) / 4, 12);
  });

  it('keeps the heavier body identity so its trail survives the merge', () => {
    const s = state([
      { name: 'Pebble', mass: 1, radius: 0.5, p: [0, 0, 0], v: [0, 0, 0] },
      { name: 'Planet', mass: 100, radius: 0.5, p: [0.4, 0, 0], v: [0, 0, 0] },
    ]);
    const planetHandle = s.handles[1];
    resolveMerges(s);
    expect(s.names[0]).toBe('Planet');
    expect(s.handles[0]).toBe(planetHandle);
  });

  it('collapses a pile-up in a single pass', () => {
    const s = state(
      Array.from({ length: 5 }, (_, i) => ({
        name: `B${i}`,
        mass: 1,
        radius: 0.5,
        p: [i * 0.1, 0, 0] as [number, number, number],
        v: [0, 0, 0] as [number, number, number],
      })),
    );
    expect(resolveMerges(s)).toBe(4);
    expect(s.count).toBe(1);
    expect(s.mass[0]).toBe(5);
  });

  it('is reported through the engine as a topology change', () => {
    const engine = new ReferenceEngine();
    engine.load(
      defineScenario({
        id: 'crash',
        name: 'Crash',
        description: '',
        units: 'natural',
        dt: 1e-2,
        collisions: 'merge',
        forceModel: 'direct',
        timeScale: 1,
        bodies: [
          { name: 'A', mass: 1, radius: 0.2, position: [-0.5, 0, 0], velocity: [1, 0, 0] },
          { name: 'B', mass: 1, radius: 0.2, position: [0.5, 0, 0], velocity: [-1, 0, 0] },
        ],
      }),
    );

    for (let i = 0; i < 200 && engine.state.count > 1; i++) engine.step();

    expect(engine.state.count).toBe(1);
    expect(engine.state.mass[0]).toBe(2);
  });

  it('does not merge when collisions are off', () => {
    const engine = new ReferenceEngine();
    engine.load(
      defineScenario({
        id: 'pass',
        name: 'Pass',
        description: '',
        units: 'natural',
        dt: 1e-2,
        collisions: 'none',
        softening: 0.1,
        forceModel: 'direct',
        timeScale: 1,
        bodies: [
          { name: 'A', mass: 1, radius: 0.2, position: [-0.5, 0, 0], velocity: [1, 0, 0] },
          { name: 'B', mass: 1, radius: 0.2, position: [0.5, 0, 0], velocity: [-1, 0, 0] },
        ],
      }),
    );
    for (let i = 0; i < 200; i++) engine.step();
    expect(engine.state.count).toBe(2);
  });
});

describe('RefState swap removal', () => {
  it('keeps id lookup correct after removing a middle slot', () => {
    const s = state([
      { name: 'A', mass: 1, radius: 0, p: [0, 0, 0], v: [0, 0, 0] },
      { name: 'B', mass: 2, radius: 0, p: [1, 0, 0], v: [0, 0, 0] },
      { name: 'C', mass: 3, radius: 0, p: [2, 0, 0], v: [0, 0, 0] },
    ]);
    s.removeAt(s.slotOf('b'));

    expect(s.count).toBe(2);
    expect(s.slotOf('b')).toBe(-1);
    expect(s.mass[s.slotOf('a')]).toBe(1);
    expect(s.mass[s.slotOf('c')]).toBe(3);
  });
});
