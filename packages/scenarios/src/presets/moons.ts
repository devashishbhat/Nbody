import { defineScenario, type Scenario } from '@nbody/protocol';
import earthMoonData from '../data/earth-moon.json' with { type: 'json' };
import jovianData from '../data/jovian.json' with { type: 'json' };

/**
 * Satellite systems, from JPL Horizons.
 *
 * Both are real state vectors at 2026-01-01, regenerated with
 * `pnpm --filter @nbody/tool-horizons fetch`.
 *
 * The scale problem is the interesting part of presenting these. The Moon
 * orbits 0.00257 AU from Earth while Earth orbits 0.98 AU from the Sun, a
 * ratio of 380, so a view that shows one cannot show the other. Both presets
 * therefore open with the camera following the primary, which is what makes
 * the satellite orbits visible at all.
 */

function toVec3(value: readonly number[], label: string): [number, number, number] {
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new Error(`${label} is not three finite numbers`);
  }
  return [value[0]!, value[1]!, value[2]!];
}

function bodiesFrom(data: typeof earthMoonData) {
  return data.bodies.map((body) => ({
    name: body.name,
    mass: body.mass,
    radius: body.radius,
    position: toVec3(body.position, `${body.name} position`),
    velocity: toVec3(body.velocity, `${body.name} velocity`),
    color: body.color,
    trail: true,
  }));
}

/**
 * The Sun, the Earth and the Moon, each as itself.
 *
 * Note that the solar system preset uses Earth's SYSTEM mass and the
 * Earth-Moon barycentre; here the two are separate bodies with their own
 * masses and their own Horizons targets.
 *
 * `dt` of 0.01 days puts about 2,700 steps in the Moon's 27.3-day orbit,
 * which is what the shortest timescale in a system sets.
 */
export const earthMoon: Scenario = defineScenario({
  id: 'earth-moon',
  name: 'Earth and Moon',
  description: 'The Sun, the Earth and the Moon as three separate bodies, from JPL ephemeris data.',
  watchFor:
    'The camera follows Earth, so you see the Moon going round it while both go round the Sun.',
  units: 'solar',
  dt: 0.01,
  integrator: 'leapfrog',
  forceModel: 'direct',
  softening: 0,
  timeScale: 3,
  suggestedDuration: 365.25 * 2,
  tags: ['solar-system', 'ephemeris', 'real-data', 'satellites'],
  bodies: bodiesFrom(earthMoonData),
  camera: {
    mode: '2d',
    // About three times the Moon's distance, so its whole orbit is in frame.
    distance: 0.008,
    followBodyId: 'earth',
  },
});

/**
 * Jupiter and the four moons Galileo saw in 1610.
 *
 * Centred on Jupiter's barycentre rather than the Sun's, so the system is
 * self-contained: the Sun is not present, and over the few months this preset
 * is meant to be watched its tidal influence changes nothing visible.
 *
 * Io, Europa and Ganymede are in a 1:2:4 Laplace resonance, which is the
 * thing to watch for and the reason Io is volcanic.
 */
export const jovianSystem: Scenario = defineScenario({
  id: 'jovian-system',
  name: 'Jupiter and the Galilean Moons',
  description:
    'Jupiter with Io, Europa, Ganymede and Callisto, from JPL ephemeris data at 1 January 2026.',
  watchFor:
    'Io goes round twice for each Europa orbit and four times for each Ganymede orbit, exactly.',
  units: 'solar',
  // Io's orbit is 1.77 days, the shortest timescale here, so this puts about
  // 900 steps in it.
  dt: 0.002,
  integrator: 'leapfrog',
  forceModel: 'direct',
  softening: 0,
  timeScale: 2,
  suggestedDuration: 60,
  tags: ['ephemeris', 'real-data', 'satellites', 'resonance'],
  bodies: bodiesFrom(jovianData),
  camera: { mode: '2d', distance: 0.016 },
});

export const MOON_PRESETS: readonly Scenario[] = [earthMoon, jovianSystem];
