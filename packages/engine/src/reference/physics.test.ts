import { defineScenario, type Scenario } from '@nbody/protocol';
import { describe, expect, it } from 'vitest';
import { ReferenceEngine } from './engine.ts';

/**
 * Physics verification.
 *
 * These are the tests the Rust core will be held to as well. The reference
 * engine is only useful as a parity oracle if it is independently known to be
 * right, so correctness here is established against closed-form solutions and
 * published periodic orbits rather than against itself.
 */

/** A circular equal-mass binary, separation 1, in natural units. */
function circularBinary(dt: number, integrator: Scenario['integrator']): Scenario {
  // Each body orbits the centre of mass at r = 0.5. Centripetal acceleration
  // v^2/r must equal the mutual attraction G*m/d^2 = 1, so v = sqrt(0.5).
  const v = Math.sqrt(0.5);
  return defineScenario({
    id: 'binary',
    name: 'Circular Binary',
    description: '',
    units: 'natural',
    dt,
    integrator,
    forceModel: 'direct',
    timeScale: 1,
    bodies: [
      { name: 'A', mass: 1, radius: 0, position: [-0.5, 0, 0], velocity: [0, -v, 0] },
      { name: 'B', mass: 1, radius: 0, position: [0.5, 0, 0], velocity: [0, v, 0] },
    ],
  });
}

const BINARY_PERIOD = (2 * Math.PI * 0.5) / Math.sqrt(0.5);

function run(engine: ReferenceEngine, steps: number): void {
  for (let i = 0; i < steps; i++) engine.step();
}

/** Max distance between a body's current position and its exact position. */
function positionError(engine: ReferenceEngine, exact: readonly number[][]): number {
  const s = engine.state;
  let worst = 0;
  for (let i = 0; i < s.count; i++) {
    const e = exact[i]!;
    worst = Math.max(worst, Math.hypot(s.x[i] - e[0]!, s.y[i] - e[1]!, s.z[i] - e[2]!));
  }
  return worst;
}

/** Exact state of the circular binary at time t. */
function binaryExact(t: number): number[][] {
  const omega = (2 * Math.PI) / BINARY_PERIOD;
  // Body A starts at angle pi, body B at angle 0, both rotating with +omega.
  const a = omega * t;
  return [
    [-0.5 * Math.cos(a), -0.5 * Math.sin(a), 0],
    [0.5 * Math.cos(a), 0.5 * Math.sin(a), 0],
  ];
}

describe('two-body closed orbit', () => {
  it('reproduces the analytic circular orbit', () => {
    const engine = new ReferenceEngine();
    engine.load(circularBinary(1e-4, 'yoshida4'));
    const steps = Math.round(BINARY_PERIOD / 1e-4);
    run(engine, steps);
    expect(positionError(engine, binaryExact(steps * 1e-4))).toBeLessThan(1e-9);
  });

  it('has the energy the closed form predicts', () => {
    const engine = new ReferenceEngine();
    engine.load(circularBinary(1e-3, 'leapfrog'));
    // T = 2 * (1/2 * 1 * 1/2) = 1/2, U = -G m1 m2 / d = -1.
    const diag = engine.measure();
    expect(diag.kinetic).toBeCloseTo(0.5, 12);
    expect(diag.potential).toBeCloseTo(-1, 12);
    expect(diag.energy).toBeCloseTo(-0.5, 12);
  });

  it('keeps leapfrog energy error bounded over a thousand orbits', () => {
    // The point of a symplectic integrator: the error oscillates with the
    // orbit instead of accumulating. A non-symplectic method of the same order
    // would drift roughly linearly in the number of orbits.
    const engine = new ReferenceEngine();
    engine.load(circularBinary(1e-3, 'leapfrog'));
    const steps = Math.round((1000 * BINARY_PERIOD) / 1e-3);

    let worst = 0;
    for (let i = 0; i < steps; i++) {
      engine.step();
      if (i % 5000 === 0) {
        const drift = Math.abs((engine.measure().energy - engine.energy0) / engine.energy0);
        worst = Math.max(worst, drift);
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('conserves momentum and the centre of mass exactly under leapfrog', () => {
    // Exact, not approximate: every kick applies equal and opposite impulses,
    // so total momentum is conserved to round-off regardless of step size.
    const engine = new ReferenceEngine();
    engine.load(circularBinary(1e-2, 'leapfrog'));
    run(engine, 10_000);
    const diag = engine.measure();
    expect(diag.momentum).toBeLessThan(1e-14);
    expect(Math.hypot(diag.comX, diag.comY, diag.comZ)).toBeLessThan(1e-14);
  });
});

describe('order of convergence', () => {
  // Halving the step size must reduce the global error by 2^order. This is the
  // test that catches an integrator which is subtly mis-composed: such a bug
  // usually still conserves energy approximately but silently drops an order.
  function errorAt(dt: number, integrator: Scenario['integrator']): number {
    const engine = new ReferenceEngine();
    engine.load(circularBinary(dt, integrator));
    const target = BINARY_PERIOD;
    const steps = Math.round(target / dt);
    run(engine, steps);
    return positionError(engine, binaryExact(steps * dt));
  }

  it('shows leapfrog converging at 2nd order', () => {
    const coarse = errorAt(4e-3, 'leapfrog');
    const fine = errorAt(2e-3, 'leapfrog');
    expect(coarse / fine).toBeGreaterThan(3.5);
    expect(coarse / fine).toBeLessThan(4.5);
  });

  it('shows yoshida4 converging at 4th order', () => {
    const coarse = errorAt(8e-3, 'yoshida4');
    const fine = errorAt(4e-3, 'yoshida4');
    expect(coarse / fine).toBeGreaterThan(14);
    expect(coarse / fine).toBeLessThan(18);
  });

  it('makes yoshida4 far more accurate than leapfrog at equal step size', () => {
    expect(errorAt(2e-3, 'yoshida4')).toBeLessThan(errorAt(2e-3, 'leapfrog') / 1000);
  });
});

describe('time reversal', () => {
  it('retraces its own path when dt is negated', () => {
    // Both symplectic integrators are time-symmetric, which is what makes the
    // UI's reverse button exact rather than approximate.
    for (const integrator of ['leapfrog', 'yoshida4'] as const) {
      const engine = new ReferenceEngine();
      engine.load(circularBinary(1e-3, integrator));
      const start = binaryExact(0);

      run(engine, 5000);
      expect(positionError(engine, start)).toBeGreaterThan(0.1);

      engine.applySettings({ dt: -1e-3 });
      engine.refreshForces();
      run(engine, 5000);

      expect(positionError(engine, start)).toBeLessThan(1e-11);
    }
  });
});

describe('figure-eight choreography', () => {
  // Chenciner and Montgomery's equal-mass periodic solution. All three bodies
  // trace the same curve, and after one period each returns to its own
  // starting point. Nothing about this orbit is forgiving: an integrator with
  // a sign error or a mis-scaled force term loses it within a fraction of a
  // period, which makes it the single best regression test available.
  const PERIOD = 6.32591398;

  function figureEight(dt: number): Scenario {
    const vx = 0.466203685;
    const vy = 0.43236573;
    return defineScenario({
      id: 'figure-eight',
      name: 'Figure Eight',
      description: '',
      units: 'natural',
      dt,
      integrator: 'yoshida4',
      forceModel: 'direct',
      softening: 0,
      timeScale: 1,
      bodies: [
        {
          name: 'One',
          mass: 1,
          radius: 0,
          position: [0.97000436, -0.24308753, 0],
          velocity: [vx, vy, 0],
        },
        {
          name: 'Two',
          mass: 1,
          radius: 0,
          position: [-0.97000436, 0.24308753, 0],
          velocity: [vx, vy, 0],
        },
        {
          name: 'Three',
          mass: 1,
          radius: 0,
          position: [0, 0, 0],
          velocity: [-2 * vx, -2 * vy, 0],
        },
      ],
    });
  }

  it('starts at rest in the centre-of-mass frame', () => {
    const engine = new ReferenceEngine();
    engine.load(figureEight(1e-3));
    const diag = engine.measure();
    expect(diag.momentum).toBeLessThan(1e-12);
    expect(Math.hypot(diag.comX, diag.comY, diag.comZ)).toBeLessThan(1e-12);
  });

  it('returns every body to its starting point after one period', () => {
    // dt is chosen to divide the period exactly. Using a round dt and
    // `round(PERIOD / dt)` steps stops short of the true period by up to half
    // a step, and because the bodies move at order unity that offset shows up
    // as a position error near 1e-5, swamping the real integration error by
    // three orders of magnitude.
    const steps = 63_259;
    const dt = PERIOD / steps;
    const engine = new ReferenceEngine();
    engine.load(figureEight(dt));
    const start = engine.snapshot().bodies.map((b) => [...b.position]);

    run(engine, steps);

    // The floor here is about 4e-8 and does not improve with smaller dt: it is
    // set by the published initial conditions and period, which are given to
    // eight or nine significant figures. Refining the period to 6.32591403
    // brings the return error down to 2e-8, which confirms the residual is in
    // the data rather than in the integrator. A genuine integrator fault moves
    // this to 1e-5 or worse.
    expect(positionError(engine, start)).toBeLessThan(1e-7);
  });

  it('conserves energy through the close approaches', () => {
    const dt = 1e-4;
    const engine = new ReferenceEngine();
    engine.load(figureEight(dt));
    run(engine, Math.round(PERIOD / dt));
    const drift = Math.abs((engine.measure().energy - engine.energy0) / engine.energy0);
    expect(drift).toBeLessThan(1e-10);
  });
});

describe('locked bodies', () => {
  it('exert gravity but do not move', () => {
    // This is how restricted problems are expressed without a second code
    // path: pin the primaries, let the test particle respond.
    const engine = new ReferenceEngine();
    engine.load(
      defineScenario({
        id: 'restricted',
        name: 'Restricted',
        description: '',
        units: 'natural',
        dt: 1e-3,
        forceModel: 'direct',
        timeScale: 1,
        bodies: [
          {
            name: 'Primary',
            mass: 1,
            radius: 0,
            position: [0, 0, 0],
            velocity: [0, 0, 0],
            locked: true,
          },
          { name: 'Particle', mass: 0, radius: 0, position: [1, 0, 0], velocity: [0, 1, 0] },
        ],
      }),
    );

    run(engine, 2000);

    expect(engine.state.x[0]).toBe(0);
    expect(engine.state.y[0]).toBe(0);
    expect(engine.state.vx[0]).toBe(0);
    expect(Math.hypot(engine.state.x[1], engine.state.y[1])).toBeCloseTo(1, 2);
  });
});

describe('softening', () => {
  it('bounds the force at zero separation instead of producing infinities', () => {
    const engine = new ReferenceEngine();
    engine.load(
      defineScenario({
        id: 'overlap',
        name: 'Overlap',
        description: '',
        units: 'natural',
        dt: 1e-3,
        softening: 0.1,
        forceModel: 'direct',
        timeScale: 1,
        bodies: [
          { name: 'A', mass: 1, radius: 0, position: [0, 0, 0], velocity: [0, 0, 0] },
          { name: 'B', mass: 1, radius: 0, position: [1e-9, 0, 0], velocity: [0, 0, 0] },
        ],
      }),
    );
    run(engine, 100);
    expect(Number.isFinite(engine.state.x[0])).toBe(true);
    expect(Number.isFinite(engine.measure().energy)).toBe(true);
    expect(engine.diverged).toBe(false);
  });
});
