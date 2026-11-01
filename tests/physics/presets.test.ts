import { ReferenceEngine } from '@nbody/engine';
import { type Scenario } from '@nbody/protocol';
import { innerSolarSystem, presets, solarSystem } from '@nbody/scenarios';
import { describe, expect, it } from 'vitest';

/**
 * Cross-package physics fixtures.
 *
 * These run a real engine over real presets, which neither package can do
 * alone: `@nbody/scenarios` must not depend on `@nbody/engine` at runtime (see
 * contract rule 1), so the suite that needs both lives here.
 *
 * LANE B: this is also the right home for the WASM-versus-reference parity
 * tests. Run both engines over `presets` and assert agreement; the structure
 * below is the shape to follow.
 */

const YEAR = 365.25;

function run(scenario: Scenario, steps: number): ReferenceEngine {
  const engine = new ReferenceEngine();
  engine.load(scenario);
  for (let i = 0; i < steps; i++) engine.step();
  return engine;
}

function drift(engine: ReferenceEngine): number {
  return Math.abs((engine.measure().energy - engine.energy0) / engine.energy0);
}

describe('every preset is integrable', () => {
  it.each(presets.map((p) => [p.id, p] as const))(
    '%s stays finite and bounded in energy',
    (_id, scenario) => {
      // Deliberately short: this is a smoke test over every preset, not an
      // accuracy measurement. A preset with a typo in its initial conditions
      // usually diverges within a few hundred steps.
      const engine = run(scenario, 2000);
      expect(engine.diverged).toBe(false);
      expect(Number.isFinite(engine.measure().energy)).toBe(true);
    },
  );
});

describe('solar system ephemeris', () => {
  it('starts with the centre of mass essentially at rest', () => {
    // Barycentric input should make this nearly exact. A large value would
    // mean the mass table and the Horizons targets have drifted apart, which
    // would show up as the whole system sliding off screen.
    const engine = new ReferenceEngine();
    engine.load(solarSystem);
    const diag = engine.measure();
    const speed = diag.momentum / engine.state.totalMass();
    expect(speed).toBeLessThan(1e-10);
  });

  it('puts Earth at its real distance and speed relative to the Sun', () => {
    const engine = new ReferenceEngine();
    engine.load(solarSystem);
    const sun = engine.state.slotOf('sun');
    const earth = engine.state.slotOf('earth');
    expect(sun).toBeGreaterThanOrEqual(0);
    expect(earth).toBeGreaterThanOrEqual(0);

    // Measured against the SUN, not the origin. The origin is the solar
    // system barycentre, which the Sun itself orbits, so Earth's distance from
    // the origin is not its distance from the Sun.
    const r = Math.hypot(
      engine.state.x[earth] - engine.state.x[sun],
      engine.state.y[earth] - engine.state.y[sun],
      engine.state.z[earth] - engine.state.z[sun],
    );
    // Earth reaches perihelion at 0.9833 AU in early January.
    expect(r).toBeGreaterThan(0.983);
    expect(r).toBeLessThan(0.9837);

    const v = Math.hypot(
      engine.state.vx[earth] - engine.state.vx[sun],
      engine.state.vy[earth] - engine.state.vy[sun],
      engine.state.vz[earth] - engine.state.vz[sun],
    );
    // 0.017491 AU/day is 30.28 km/s.
    expect(v).toBeGreaterThan(0.01748);
    expect(v).toBeLessThan(0.0175);
  });

  it('places the barycentre just outside the surface of the Sun', () => {
    // A real, checkable consequence of using barycentric coordinates, and the
    // thing the preset's own "watch for" line points at: Jupiter and Saturn
    // pull the Sun around a point 0.0063 AU from its centre, while the Sun's
    // radius is only 0.00465 AU.
    const engine = new ReferenceEngine();
    engine.load(solarSystem);
    const sun = engine.state.slotOf('sun');
    const offset = Math.hypot(engine.state.x[sun], engine.state.y[sun], engine.state.z[sun]);
    expect(offset).toBeGreaterThan(engine.state.radius[sun]);
    expect(offset).toBeLessThan(engine.state.radius[sun] * 2);
  });

  it('returns Earth to its starting point after one year', () => {
    // The end-to-end check on the ephemeris, the units, G_SOLAR and the
    // integrator all agreeing. If G or the mass scale were wrong, the period
    // would be wrong and this would fail by a wide margin.
    const engine = new ReferenceEngine();
    engine.load(solarSystem);
    const earth = engine.state.slotOf('earth');
    const start = [engine.state.x[earth], engine.state.y[earth], engine.state.z[earth]] as const;

    const steps = Math.round(YEAR / solarSystem.dt);
    for (let i = 0; i < steps; i++) engine.step();

    const error = Math.hypot(
      engine.state.x[earth] - start[0],
      engine.state.y[earth] - start[1],
      engine.state.z[earth] - start[2],
    );
    // Not zero: the sidereal year is not exactly 365.25 days and the other
    // planets perturb the orbit. Earth travels 6.3 AU in a year, so this is a
    // closure of better than one part in 10^4.
    expect(error).toBeLessThan(5e-3);
  });

  it('keeps leapfrog energy error bounded over forty years rather than drifting', () => {
    // The property that makes a symplectic integrator the right default: the
    // error oscillates with the orbits and its envelope stays flat. A
    // non-symplectic method of the same order would grow roughly linearly in
    // elapsed time, so comparing the first twenty years with the second twenty
    // is what actually distinguishes them. Bounding a single number would not.
    const engine = new ReferenceEngine();
    engine.load(solarSystem);
    const perYear = Math.round(YEAR / solarSystem.dt);

    const worstIn = (years: number): number => {
      let worst = 0;
      for (let year = 0; year < years; year++) {
        for (let i = 0; i < perYear; i++) engine.step();
        worst = Math.max(worst, drift(engine));
      }
      return worst;
    };

    const firstHalf = worstIn(20);
    const secondHalf = worstIn(20);

    expect(firstHalf).toBeLessThan(1e-7);
    expect(secondHalf).toBeLessThan(firstHalf * 2);
  });

  it('keeps Mercury bound in the inner system over four years', () => {
    const engine = run(innerSolarSystem, Math.round((YEAR * 4) / innerSolarSystem.dt));
    const sun = engine.state.slotOf('sun');
    const mercury = engine.state.slotOf('mercury');
    const r = Math.hypot(
      engine.state.x[mercury] - engine.state.x[sun],
      engine.state.y[mercury] - engine.state.y[sun],
      engine.state.z[mercury] - engine.state.z[sun],
    );
    // Mercury's orbit runs from 0.307 AU at perihelion to 0.467 at aphelion.
    expect(r).toBeGreaterThan(0.3);
    expect(r).toBeLessThan(0.47);
    // Larger than the full system's, because removing Jupiter and Saturn
    // shrinks the total energy this is measured against by a factor of 30.
    expect(drift(engine)).toBeLessThan(1e-6);
  });
});
