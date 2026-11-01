import { defineScenario, type Scenario } from '@nbody/protocol';
import { describe, expect, it } from 'vitest';
import { Dopri5 } from './dopri5.ts';
import { computeAccelerations, type ForceField } from './forces.ts';
import { stepLeapfrog, stepYoshida4 } from './integrators.ts';
import { RefState } from './state.ts';

/** Direct summation as a ForceField, so the integrators can be driven alone. */
function field(G: number, softening: number): ForceField {
  return {
    compute(state: RefState) {
      computeAccelerations(state, G, softening);
    },
  };
}

function load(scenario: Scenario): RefState {
  const state = new RefState();
  state.loadFrom(scenario);
  return state;
}

const V = Math.sqrt(0.5);

function circularBinary(): Scenario {
  return defineScenario({
    id: 'binary',
    name: 'Binary',
    description: '',
    units: 'natural',
    dt: 1e-2,
    forceModel: 'direct',
    timeScale: 1,
    bodies: [
      { name: 'A', mass: 1, radius: 0, position: [-0.5, 0, 0], velocity: [0, -V, 0] },
      { name: 'B', mass: 1, radius: 0, position: [0.5, 0, 0], velocity: [0, V, 0] },
    ],
  });
}

const BINARY_PERIOD = (2 * Math.PI * 0.5) / V;

/** Pythagorean three-body: masses 3, 4, 5 on a 3-4-5 triangle, at rest. */
function pythagorean(dt: number, integrator: Scenario['integrator']): Scenario {
  return defineScenario({
    id: 'pythagorean',
    name: 'Pythagorean',
    description: '',
    units: 'natural',
    dt,
    integrator,
    forceModel: 'direct',
    softening: 0,
    timeScale: 1,
    bodies: [
      { name: 'Three', mass: 3, radius: 0, position: [1, 3, 0], velocity: [0, 0, 0] },
      { name: 'Four', mass: 4, radius: 0, position: [-2, -1, 0], velocity: [0, 0, 0] },
      { name: 'Five', mass: 5, radius: 0, position: [1, -1, 0], velocity: [0, 0, 0] },
    ],
  });
}

/** Integrates to `target` with a fixed-step integrator and returns the state. */
function runFixed(scenario: Scenario, target: number, stepper: typeof stepLeapfrog): RefState {
  const state = load(scenario);
  const forces = field(scenario.G, scenario.softening);
  forces.compute(state);
  const steps = Math.round(target / scenario.dt);
  for (let i = 0; i < steps; i++) stepper(state, forces, scenario.dt);
  return state;
}

/** Integrates to `target` adaptively and returns the state plus the controller. */
function runAdaptive(
  scenario: Scenario,
  target: number,
  options?: { relativeTolerance?: number },
): { state: RefState; integrator: Dopri5; steps: number } {
  const state = load(scenario);
  const forces = field(scenario.G, scenario.softening);
  forces.compute(state);
  const integrator = new Dopri5(options);

  let t = 0;
  let steps = 0;
  while (t < target && steps < 2_000_000) {
    const remaining = target - t;
    const advanced = integrator.step(state, forces, Math.min(scenario.dt, remaining));
    if (advanced === 0) break;
    t += advanced;
    steps++;
  }
  return { state, integrator, steps };
}

function positions(state: RefState): number[][] {
  return Array.from({ length: state.count }, (_, i) => [state.x[i], state.y[i], state.z[i]]);
}

function maxSeparation(a: number[][], b: number[][]): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    worst = Math.max(
      worst,
      Math.hypot(a[i]![0]! - b[i]![0]!, a[i]![1]! - b[i]![1]!, a[i]![2]! - b[i]![2]!),
    );
  }
  return worst;
}

describe('adaptive Dormand-Prince', () => {
  it('reproduces the analytic circular orbit', () => {
    const { state } = runAdaptive(circularBinary(), BINARY_PERIOD);
    expect(state.x[0]).toBeCloseTo(-0.5, 8);
    expect(state.y[0]).toBeCloseTo(0, 8);
  });

  it('gets more accurate as the tolerance tightens', () => {
    // The error control working. A controller with a sign error or a wrong
    // order exponent still produces plausible trajectories, but it does not
    // respond to the tolerance like this.
    //
    // The dt cap has to be loose enough for the tolerance to be what binds.
    // At the scenario's own dt of 1e-2 a circular orbit is so smooth that the
    // controller is pinned at the cap for any tolerance in this range, and
    // both runs come out identical.
    const unbounded = { ...circularBinary(), dt: BINARY_PERIOD / 4 };
    const loose = runAdaptive(unbounded, BINARY_PERIOD, { relativeTolerance: 1e-5 });
    const tight = runAdaptive(unbounded, BINARY_PERIOD, { relativeTolerance: 1e-11 });

    const looseError = Math.hypot(loose.state.x[0] + 0.5, loose.state.y[0]);
    const tightError = Math.hypot(tight.state.x[0] + 0.5, tight.state.y[0]);

    expect(tightError).toBeLessThan(looseError / 100);
    // And it costs more steps to get there.
    expect(tight.steps).toBeGreaterThan(loose.steps);
  });

  it('never exceeds the step size it was given as a bound', () => {
    const scenario = { ...circularBinary(), dt: 0.01 };
    const { state, steps } = runAdaptive(scenario, 1);
    expect(steps).toBeGreaterThanOrEqual(100);
    expect(Number.isFinite(state.x[0])).toBe(true);
  });

  it('runs backwards when given a negative bound', () => {
    const scenario = circularBinary();
    const state = load(scenario);
    const forces = field(scenario.G, scenario.softening);
    forces.compute(state);
    const integrator = new Dopri5();

    let t = 0;
    while (t > -1) {
      t += integrator.step(state, forces, Math.max(-0.01, -1 - t));
    }
    expect(t).toBeCloseTo(-1, 6);
    expect(Number.isFinite(state.x[0])).toBe(true);
  });

  it('shrinks its step through the Pythagorean problem close approaches', () => {
    // The reason this integrator exists. The bodies pass close enough that the
    // local timescale collapses for a moment, and a controller that did not
    // notice would sail through with the configured step.
    const { integrator } = runAdaptive(pythagorean(1e-2, 'dopri5'), 20);
    expect(integrator.smallestStep).toBeLessThan(1e-4);
    expect(integrator.rejected).toBeGreaterThan(0);
  });

  it('agrees with a very finely stepped symplectic reference on the Pythagorean problem', () => {
    // The real test of correctness on a chaotic problem: match a reference
    // that is accurate by brute force rather than by error control.
    const target = 10;
    const reference = runFixed(pythagorean(2e-6, 'yoshida4'), target, stepYoshida4);
    const { state } = runAdaptive(pythagorean(1e-2, 'dopri5'), target);

    expect(maxSeparation(positions(state), positions(reference))).toBeLessThan(1e-5);
  });

  it('succeeds where a fixed step of the same size fails outright', () => {
    // The same nominal step, 1e-2, given to leapfrog. Chaotic amplification
    // means a wrong trajectory here is not slightly wrong, it is a different
    // outcome, which is what makes a fixed step the wrong tool.
    const target = 10;
    const reference = runFixed(pythagorean(2e-6, 'yoshida4'), target, stepYoshida4);
    const fixed = runFixed(pythagorean(1e-2, 'leapfrog'), target, stepLeapfrog);
    const { state: adaptive } = runAdaptive(pythagorean(1e-2, 'dopri5'), target);

    const fixedError = maxSeparation(positions(fixed), positions(reference));
    const adaptiveError = maxSeparation(positions(adaptive), positions(reference));

    expect(adaptiveError).toBeLessThan(fixedError / 1000);
    expect(fixedError).toBeGreaterThan(0.01);
  });

  it('leaves locked bodies untouched', () => {
    const scenario = defineScenario({
      id: 'restricted',
      name: 'Restricted',
      description: '',
      units: 'natural',
      dt: 1e-2,
      integrator: 'dopri5',
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
    });
    const { state } = runAdaptive(scenario, 5);
    expect(state.x[0]).toBe(0);
    expect(state.vx[0]).toBe(0);
    expect(Math.hypot(state.x[1], state.y[1])).toBeCloseTo(1, 6);
  });
});
