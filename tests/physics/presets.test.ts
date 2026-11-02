import { ReferenceEngine } from '@nbody/engine';
import { type Scenario } from '@nbody/protocol';
import {
  innerSolarSystem,
  lagrangeTriangle,
  presets,
  solarSystem,
  trojans,
  LAGRANGE_PERIOD,
  THREE_BODY_PERIODS,
  THREE_BODY_PRESETS,
  TROJAN_PERIOD,
} from '@nbody/scenarios';
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
      // Deliberately short, and shorter still for the large presets: this is a
      // smoke test over every preset, not an accuracy measurement. A preset
      // with a typo in its initial conditions diverges within a few hundred
      // steps, and a few hundred steps of a two-thousand-body cluster is
      // already seconds of direct summation.
      const steps = scenario.bodies.length > 500 ? 150 : 2000;
      const engine = run(scenario, steps);
      expect(engine.diverged).toBe(false);
      expect(Number.isFinite(engine.measure().energy)).toBe(true);
      expect(drift(engine)).toBeLessThan(0.05);
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

  it(
    'keeps leapfrog energy error bounded over forty years rather than drifting',
    { timeout: 30_000 },
    () => {
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
    },
  );

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

describe('periodic orbits close', () => {
  /**
   * Integrates exactly one period and measures how far each body lands from
   * where it began.
   *
   * `dt` is chosen to divide the period exactly. Using a round step and
   * `round(period / dt)` of them stops short by up to half a step, which at
   * these speeds is a position error far larger than anything the integrator
   * contributes.
   */
  function returnError(scenario: Scenario, period: number): number {
    const steps = Math.max(2000, Math.round(period / Math.abs(scenario.dt)));
    const engine = new ReferenceEngine();
    engine.load({ ...scenario, dt: period / steps });
    const start = scenario.bodies.map((body) => [...body.position]);

    if (scenario.integrator === 'dopri5') {
      // Adaptive: run to the target time rather than for a step count.
      let elapsed = 0;
      let guard = 0;
      while (elapsed < period && guard++ < 2_000_000) {
        const advanced = engine.step();
        if (advanced === 0) break;
        elapsed += advanced;
      }
    } else {
      for (let i = 0; i < steps; i++) engine.step();
    }

    let worst = 0;
    for (let i = 0; i < start.length; i++) {
      worst = Math.max(
        worst,
        Math.hypot(
          engine.state.x[i] - start[i]![0]!,
          engine.state.y[i] - start[i]![1]!,
          engine.state.z[i] - start[i]![2]!,
        ),
      );
    }
    return worst;
  }

  it.each(
    THREE_BODY_PRESETS.filter((scenario) => scenario.id !== 'lagrange-triangle').map(
      (scenario) => [scenario.id, scenario] as const,
    ),
  )('%s returns to its starting configuration after one period', (id, scenario) => {
    // The published initial conditions carry five decimal places, which sets
    // the floor: these orbits close to between 2e-4 and 9e-4 and no tighter,
    // whatever the integrator does. A transcription error in one of those two
    // velocity components moves this to a tenth of the system's size.
    const period = THREE_BODY_PERIODS[id]!;
    expect(returnError(scenario, period)).toBeLessThan(3e-3);
  });

  it('closes the Lagrange triangle to machine precision', () => {
    // Derived rather than transcribed, so unlike the catalogue orbits there is
    // no published-precision floor underneath it.
    expect(returnError(lagrangeTriangle, LAGRANGE_PERIOD)).toBeLessThan(1e-10);
  });

  it('keeps the Lagrange triangle rigid, not merely periodic', () => {
    // The defining property: all three separations are constant for all time,
    // not just at the end of a period.
    const engine = new ReferenceEngine();
    engine.load(lagrangeTriangle);
    const separation = () =>
      Math.hypot(
        engine.state.x[0] - engine.state.x[1],
        engine.state.y[0] - engine.state.y[1],
        engine.state.z[0] - engine.state.z[1],
      );

    const initial = separation();
    for (let i = 0; i < 40_000; i++) {
      engine.step();
      if (i % 500 === 0) expect(separation()).toBeCloseTo(initial, 9);
    }
  });

  // Fourteen Jupiter orbits of a 522-body system. Slow by design: the
  // libration period is about twelve orbits, so a shorter run could not tell
  // a trapped asteroid from a slowly escaping one.
  it('keeps the Trojan clouds trapped at their Lagrange points', { timeout: 60_000 }, () => {
    // The real test of the configuration. The asteroids are massless test
    // particles sixty degrees from Jupiter, and the triangular points are
    // stable, so the clouds should LIBRATE about their points rather than
    // circulate right around the orbit.
    //
    // Libration is the thing to be careful about here. The real Jupiter
    // Trojans swing back and forth about L4 and L5 with a period near 150
    // years, which is about twelve Jupiter orbits, and amplitudes of tens of
    // degrees. So an asteroid at eighty-five degrees after twelve orbits is
    // behaving correctly, not escaping, and a test that demanded it stay near
    // sixty would be asserting the wrong physics.
    //
    // What distinguishes trapped from escaped is the bound: a librating
    // asteroid never approaches Jupiter itself or the opposite side of the
    // orbit. That is what is checked, sampled throughout the run rather than
    // only at the end.
    const engine = new ReferenceEngine();
    engine.load(trojans);

    const jupiter = engine.state.slotOf('jupiter');
    const sun = engine.state.slotOf('sun');

    const meanAngle = (prefix: string): number => {
      const jx = engine.state.x[jupiter] - engine.state.x[sun];
      const jy = engine.state.y[jupiter] - engine.state.y[sun];
      const jupiterLength = Math.hypot(jx, jy);

      let total = 0;
      let counted = 0;
      for (let i = 0; i < engine.state.count; i++) {
        if (!engine.state.ids[i]!.startsWith(prefix)) continue;
        const ax = engine.state.x[i] - engine.state.x[sun];
        const ay = engine.state.y[i] - engine.state.y[sun];
        const cos = (jx * ax + jy * ay) / (jupiterLength * Math.hypot(ax, ay));
        total += (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
        counted++;
      }
      return counted === 0 ? Number.NaN : total / counted;
    };

    expect(meanAngle('greek')).toBeGreaterThan(55);
    expect(meanAngle('greek')).toBeLessThan(65);

    const steps = Math.round((TROJAN_PERIOD * 14) / trojans.dt);
    const sampleEvery = Math.round(steps / 40);
    let widest = 0;

    for (let i = 0; i < steps; i++) {
      engine.step();
      if (i % sampleEvery !== 0) continue;
      for (const prefix of ['greek', 'trojan']) {
        const angle = meanAngle(prefix);
        widest = Math.max(widest, Math.abs(angle - 60));
        // Never near Jupiter (0) and never near the far side (180).
        expect(angle).toBeGreaterThan(20);
        expect(angle).toBeLessThan(120);
      }
    }

    // And it really does librate rather than sitting still, which is what
    // makes the bound above meaningful rather than vacuous.
    expect(widest).toBeGreaterThan(5);
  });
});
