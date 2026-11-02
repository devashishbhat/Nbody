import { defineScenario } from '@nbody/protocol';
import { describe, expect, it } from 'vitest';
import { BarnesHutTree } from './barnes-hut.ts';
import { computeAccelerations } from './forces.ts';
import { RefState } from './state.ts';

/**
 * Barnes-Hut is checked against direct summation, never against itself.
 *
 * Direct summation is the oracle: it is simple enough to be obviously right,
 * so any disagreement is a fault in the tree. The quantity that matters is the
 * relative error in acceleration, which is what theta controls.
 */

function cloud(n: number, seed = 12345): RefState {
  let s = seed >>> 0;
  const random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };

  const state = new RefState();
  state.loadFrom(
    defineScenario({
      id: 'cloud',
      name: 'Cloud',
      description: '',
      units: 'natural',
      dt: 1e-3,
      forceModel: 'direct',
      timeScale: 1,
      bodies: Array.from({ length: n }, (_, i) => {
        const r = Math.cbrt(random()) * 10;
        const theta = Math.acos(2 * random() - 1);
        const phi = random() * Math.PI * 2;
        return {
          name: `b${i}`,
          mass: 0.5 + random(),
          radius: 0,
          position: [
            r * Math.sin(theta) * Math.cos(phi),
            r * Math.sin(theta) * Math.sin(phi),
            r * Math.cos(theta),
          ] as [number, number, number],
          velocity: [0, 0, 0] as [number, number, number],
        };
      }),
    }),
  );
  return state;
}

/** Worst relative acceleration error between the tree and direct summation. */
function relativeError(n: number, theta: number, softening = 0): number {
  const state = cloud(n);
  const G = 1;

  computeAccelerations(state, G, softening);
  const exactX = Float64Array.from(state.ax.subarray(0, n));
  const exactY = Float64Array.from(state.ay.subarray(0, n));
  const exactZ = Float64Array.from(state.az.subarray(0, n));

  new BarnesHutTree().accelerations(state, G, softening, theta);

  let worst = 0;
  for (let i = 0; i < n; i++) {
    const magnitude = Math.hypot(exactX[i], exactY[i], exactZ[i]);
    if (magnitude === 0) continue;
    const error = Math.hypot(
      state.ax[i] - exactX[i],
      state.ay[i] - exactY[i],
      state.az[i] - exactZ[i],
    );
    worst = Math.max(worst, error / magnitude);
  }
  return worst;
}

describe('Barnes-Hut against direct summation', () => {
  it('converges to direct summation as theta goes to zero', () => {
    // The defining property. theta = 0 opens every node, so the tree degrades
    // to exact direct summation and the only residual is float ordering.
    const errors = [1, 0.5, 0.2, 0.05, 0].map((theta) => relativeError(600, theta));
    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]!).toBeLessThanOrEqual(errors[i - 1]!);
    }
    expect(errors.at(-1)!).toBeLessThan(1e-12);
  });

  it('stays within a few percent at the default theta of 0.5', () => {
    expect(relativeError(1000, 0.5)).toBeLessThan(0.05);
  });

  it('is accurate to a fraction of a percent at theta 0.2', () => {
    expect(relativeError(1000, 0.2)).toBeLessThan(5e-3);
  });

  it('matches direct summation exactly for a two-body system', () => {
    // Small N is where an off-by-one in the leaf chain would show, and where
    // self-interaction would be most obvious.
    const state = cloud(2);
    computeAccelerations(state, 1, 0);
    const exact = [state.ax[0], state.ay[0], state.az[0], state.ax[1]];

    new BarnesHutTree().accelerations(state, 1, 0, 0.5);

    expect(state.ax[0]).toBeCloseTo(exact[0]!, 14);
    expect(state.ay[0]).toBeCloseTo(exact[1]!, 14);
    expect(state.az[0]).toBeCloseTo(exact[2]!, 14);
    expect(state.ax[1]).toBeCloseTo(exact[3]!, 14);
  });

  it('honours softening the same way direct summation does', () => {
    expect(relativeError(500, 0.5, 0.2)).toBeLessThan(0.05);
  });

  it('never gives a body a force from itself', () => {
    // A single body has nothing to attract it. If self-interaction leaked in,
    // this would be a division by the softening length instead of zero.
    const state = cloud(1);
    new BarnesHutTree().accelerations(state, 1, 0, 0.5);
    expect(state.ax[0]).toBe(0);
    expect(state.ay[0]).toBe(0);
    expect(state.az[0]).toBe(0);
  });

  it('terminates on coincident bodies instead of subdividing forever', () => {
    // Exactly what a merge produces, and what dragging one body onto another
    // produces. Without the depth cap this would not return.
    const state = new RefState();
    state.loadFrom(
      defineScenario({
        id: 'stack',
        name: 'Stack',
        description: '',
        units: 'natural',
        dt: 1e-3,
        softening: 0.01,
        forceModel: 'direct',
        timeScale: 1,
        bodies: Array.from({ length: 12 }, (_, i) => ({
          name: `b${i}`,
          mass: 1,
          radius: 0,
          position: [0, 0, 0] as [number, number, number],
          velocity: [0, 0, 0] as [number, number, number],
        })),
      }),
    );

    const tree = new BarnesHutTree();
    tree.accelerations(state, 1, 0.01, 0.5);

    for (let i = 0; i < state.count; i++) {
      expect(Number.isFinite(state.ax[i])).toBe(true);
    }
  });

  it('leaves locked bodies with zero acceleration', () => {
    const state = cloud(200);
    state.locked[0] = 1;
    state.locked[7] = 1;
    new BarnesHutTree().accelerations(state, 1, 0, 0.5);
    expect(state.ax[0]).toBe(0);
    expect(state.ax[7]).toBe(0);
    expect(state.ax[1]).not.toBe(0);
  });

  it('reuses its node pool across rebuilds', () => {
    // The tree is rebuilt every force evaluation, thousands of times per
    // published frame, so a fresh allocation per build would dominate.
    const state = cloud(500);
    const tree = new BarnesHutTree();
    tree.accelerations(state, 1, 0, 0.5);
    const nodes = tree.nodes;
    tree.accelerations(state, 1, 0, 0.5);
    expect(tree.nodes).toBe(nodes);
  });

  it('beats direct summation by a wide margin at N=5000', () => {
    // The whole reason it exists. Direct summation measured 59 ms per force
    // evaluation at this size, three and a half times over a 60 Hz frame.
    const state = cloud(5000);
    const tree = new BarnesHutTree();

    const direct = () => computeAccelerations(state, 1, 0);
    const half = () => tree.accelerations(state, 1, 0, 0.5);
    const seven = () => tree.accelerations(state, 1, 0, 0.7);

    // Warm every path before timing any of them. Timing one run straight
    // after its own warmup leaves the comparison at the mercy of whichever
    // call the JIT happened to tier up first, which is what made an earlier
    // version of this test flap.
    for (const fn of [direct, half, seven]) {
      fn();
      fn();
    }

    const measure = (fn: () => void, reps: number): number => {
      const start = performance.now();
      for (let i = 0; i < reps; i++) fn();
      return (performance.now() - start) / reps;
    };

    const directMs = measure(direct, 2);
    const halfMs = measure(half, 3);
    const sevenMs = measure(seven, 3);

    // Ratios, not milliseconds. An absolute bound measures the machine rather
    // than the code: this asserted "under 14 ms" and failed at 21 ms on a CI
    // runner roughly half the speed of the laptop it was written on, which
    // said nothing about the tree. A ratio normalises that away, and it is
    // also the claim actually being made, that replacing distant clusters with
    // their centre of mass does far less work than visiting every pair.
    //
    // What this would fail on is the thing worth catching: a tree that has
    // regressed toward quadratic. Measured, these ratios are about 3.3 and 6.
    expect(directMs / halfMs).toBeGreaterThan(2.5);
    expect(directMs / sevenMs).toBeGreaterThan(4);
  });

  it('stays usable at the theta a large preset would choose', () => {
    // 1.4% mean error is invisible in a cluster you are looking at rather than
    // measuring, but the worst case is a quarter, so this is documented rather
    // than silently chosen: large presets set theta explicitly.
    expect(relativeError(2000, 0.7)).toBeLessThan(0.4);
  });
});
