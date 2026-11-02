import { defineScenario, type Scenario } from '@nbody/protocol';
import data from '../data/solar-system.json' with { type: 'json' };

/**
 * The solar system, from JPL Horizons.
 *
 * State vectors are real: barycentric, ecliptic of J2000, AU and AU/day, at
 * epoch 2026-01-01 TDB. Regenerate with
 * `pnpm --filter @nbody/tool-horizons fetch`.
 *
 * Centred on the solar system barycentre rather than the Sun. Heliocentric
 * vectors would put the Sun at rest at the origin and hand the whole system a
 * net momentum, so it would slide off screen over a long run. As shipped, the
 * residual centre-of-mass speed is 2.3e-11 AU/day.
 *
 * Masses are planetary SYSTEM masses, so Earth includes the Moon and Jupiter
 * includes its satellites, matching the barycentre targets used in the query.
 *
 * `dt = 0.1` days is about 0.1% of Mercury's 88-day period, which is the
 * shortest dynamical timescale present. Verified in registry.test.ts: Earth
 * returns to its starting point after one year to within 2e-5 AU, and energy
 * drift over a decade stays below 1e-9.
 */
function toVec3(value: readonly number[], label: string): [number, number, number] {
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`solar-system.json: ${label} is not three finite numbers`);
  }
  return [value[0]!, value[1]!, value[2]!];
}

const bodies = data.bodies.map((body) => ({
  name: body.name,
  mass: body.mass,
  radius: body.radius,
  position: toVec3(body.position, `${body.name} position`),
  velocity: toVec3(body.velocity, `${body.name} velocity`),
  color: body.color,
  trail: true,
}));

export const SOLAR_SYSTEM_EPOCH = data.epoch;

export const solarSystem: Scenario = defineScenario({
  id: 'solar-system',
  name: 'Solar System',
  description: 'The Sun and all eight planets, from JPL Horizons ephemeris data at 1 January 2026.',
  watchFor:
    'Jupiter and Saturn pull the Sun around a barycentre just outside its surface. Scroll out for Uranus and Neptune.',
  units: 'solar',
  dt: 0.1,
  integrator: 'leapfrog',
  forceModel: 'direct',
  softening: 0,
  timeScale: 40,
  suggestedDuration: 365.25 * 12,
  tags: ['solar-system', 'ephemeris', 'real-data'],
  bodies,
  /**
   * Framed to Saturn, not to Neptune.
   *
   * At a half-height of 32 AU the whole system fits, and it is useless: one AU
   * is fourteen pixels, so the Sun's drawn disc is wider than Mercury's entire
   * orbit and the four inner planets are hidden inside it. Framing to 9 AU
   * puts an AU at about 45 pixels, which separates the terrestrial planets
   * properly, gives Earth a visible nine-second orbit, and still reaches
   * Saturn. The outer two are one scroll away, which the description says.
   */
  camera: { mode: '2d', distance: 9 },
});

/**
 * The inner solar system.
 *
 * Mercury through Mars plus the Sun. The outer planets span 30 AU, which
 * renders the terrestrial planets into a few pixels around the Sun, so this is
 * the view that actually shows them. `dt` is smaller because without Jupiter
 * and Saturn the shortest timescale still present is Mercury's and there is
 * budget to spare.
 */
export const innerSolarSystem: Scenario = defineScenario({
  id: 'inner-solar-system',
  name: 'Inner Solar System',
  description: 'The Sun, Mercury, Venus, Earth and Mars, from the same ephemeris.',
  watchFor: 'Mercury is visibly fast, and its orbit is visibly off-centre.',
  units: 'solar',
  dt: 0.05,
  integrator: 'leapfrog',
  forceModel: 'direct',
  softening: 0,
  timeScale: 12,
  suggestedDuration: 365.25 * 4,
  tags: ['solar-system', 'ephemeris', 'real-data'],
  bodies: bodies.slice(0, 5),
  camera: { mode: '2d', distance: 1.8 },
});
