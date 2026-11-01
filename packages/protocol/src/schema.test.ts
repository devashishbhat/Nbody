import { describe, expect, it } from 'vitest';
import { defineScenario } from './define.ts';
import { safeParseScenario } from './schema.ts';
import type { Scenario } from './scenario.ts';

function base(): Scenario {
  return defineScenario({
    id: 'two-body',
    name: 'Two Body',
    description: 'A circular binary.',
    units: 'natural',
    dt: 1e-3,
    timeScale: 1,
    bodies: [
      { name: 'A', mass: 1, position: [-0.5, 0, 0], velocity: [0, -0.5, 0] },
      { name: 'B', mass: 1, position: [0.5, 0, 0], velocity: [0, 0.5, 0] },
    ],
  });
}

describe('ScenarioSchema', () => {
  it('accepts a well-formed scenario', () => {
    const result = safeParseScenario(base());
    expect(result.ok).toBe(true);
  });

  it('rejects duplicate body ids', () => {
    const scenario = base();
    scenario.bodies[1]!.id = scenario.bodies[0]!.id;
    const result = safeParseScenario(scenario);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicate body id/);
  });

  it('rejects dt of zero, which would freeze the simulation silently', () => {
    const result = safeParseScenario({ ...base(), dt: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/dt must not be 0/);
  });

  it('accepts negative dt, which is how time reversal is expressed', () => {
    expect(safeParseScenario({ ...base(), dt: -1e-3 }).ok).toBe(true);
  });

  it('rejects a system with no mass anywhere', () => {
    const scenario = base();
    for (const body of scenario.bodies) body.mass = 0;
    const result = safeParseScenario(scenario);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one body must have mass/);
  });

  it('accepts individual massless test particles', () => {
    const scenario = base();
    scenario.bodies[1]!.mass = 0;
    expect(safeParseScenario(scenario).ok).toBe(true);
  });

  it('rejects non-finite state, which is how a blown-up run would be saved', () => {
    const scenario = base();
    scenario.bodies[0]!.position = [Number.POSITIVE_INFINITY, 0, 0];
    expect(safeParseScenario(scenario).ok).toBe(false);

    const nan = base();
    nan.bodies[0]!.velocity = [Number.NaN, 0, 0];
    expect(safeParseScenario(nan).ok).toBe(false);
  });

  it('rejects theta outside (0, 2]', () => {
    expect(safeParseScenario({ ...base(), theta: 0 }).ok).toBe(false);
    expect(safeParseScenario({ ...base(), theta: -1 }).ok).toBe(false);
    expect(safeParseScenario({ ...base(), theta: 2.5 }).ok).toBe(false);
    expect(safeParseScenario({ ...base(), theta: 0.5 }).ok).toBe(true);
  });

  it('rejects negative softening', () => {
    expect(safeParseScenario({ ...base(), softening: -1 }).ok).toBe(false);
  });

  it('rejects a malformed colour', () => {
    const scenario = base();
    scenario.bodies[0]!.color = 'red';
    expect(safeParseScenario(scenario).ok).toBe(false);
  });

  it('rejects a camera that follows a body which does not exist', () => {
    const scenario = base();
    scenario.camera = { ...scenario.camera!, followBodyId: 'nope' };
    const result = safeParseScenario(scenario);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/followBodyId/);
  });

  it('rejects an unknown integrator', () => {
    expect(safeParseScenario({ ...base(), integrator: 'rk4' }).ok).toBe(false);
  });

  it('rejects an empty body list', () => {
    expect(safeParseScenario({ ...base(), bodies: [] }).ok).toBe(false);
  });
});
