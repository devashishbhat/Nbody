import { defineScenario, G_SOLAR, type BodyInput, type Scenario } from '@nbody/protocol';
import { makeRandom } from '../generate.ts';

/**
 * The Trojan asteroids.
 *
 * Jupiter's L4 and L5 points sit at the third corner of an equilateral
 * triangle with the Sun and Jupiter, sixty degrees ahead of and behind the
 * planet. They are the stable Lagrange points: a body nudged away from one
 * does not fall out but circles it, which is why thousands of asteroids are
 * actually there and not at L1, L2 or L3.
 *
 * This is Lagrange's equilateral solution again, with one of the three masses
 * reduced to nothing.
 */

const SUN_MASS = 1;
const JUPITER_MASS = 9.5479194e-4;
/** Jupiter's semi-major axis, AU. */
const SEPARATION = 5.2044;

const TOTAL = SUN_MASS + JUPITER_MASS;
/** Distances of each body from the barycentre. */
const SUN_RADIUS = (SEPARATION * JUPITER_MASS) / TOTAL;
const JUPITER_RADIUS = (SEPARATION * SUN_MASS) / TOTAL;

/** Rigid rotation rate of the whole configuration. */
const OMEGA = Math.sqrt((G_SOLAR * TOTAL) / SEPARATION ** 3);

export const TROJAN_PERIOD = (2 * Math.PI) / OMEGA;

/** Velocity for rigid rotation about the barycentre at the given position. */
function corotating(x: number, y: number): [number, number, number] {
  return [-OMEGA * y, OMEGA * x, 0];
}

/** A swarm librating about one of the triangular points. */
function swarm(
  sign: 1 | -1,
  count: number,
  seed: number,
  color: string,
  label: string,
): BodyInput[] {
  const random = makeRandom(seed);

  // The third vertex: equidistant from both primaries, so halfway between them
  // in x and a triangle's height away in y.
  const centreX = (JUPITER_RADIUS - SUN_RADIUS) / 2;
  const centreY = (sign * SEPARATION * Math.sqrt(3)) / 2;

  return Array.from({ length: count }, (_, i) => {
    // Spread over a region comparable to the real Trojan clouds, which are
    // enormous: they span tens of degrees along the orbit.
    const spreadAlong = (random() - 0.5) * 1.7;
    const spreadAcross = (random() - 0.5) * 0.8;
    const x = centreX + spreadAlong;
    const y = centreY + spreadAcross;
    const z = (random() - 0.5) * 0.25;

    return {
      name: `${label}-${i}`,
      // Massless. The real Trojans total far less than a thousandth of Earth,
      // and making them test particles keeps the force cost linear.
      mass: 0,
      radius: 0.01,
      position: [x, y, z] as [number, number, number],
      velocity: corotating(x, y),
      color,
    };
  });
}

export const trojans: Scenario = defineScenario({
  id: 'trojans',
  name: 'Trojan Asteroids',
  description:
    'The Sun, Jupiter, and two clouds of asteroids trapped sixty degrees ahead of and behind the planet.',
  watchFor:
    'The clouds keep pace with Jupiter, swinging slowly back and forth around their points. One full swing takes about twelve Jupiter years.',
  units: 'solar',
  dt: 0.5,
  integrator: 'leapfrog',
  forceModel: 'direct',
  softening: 0,
  timeScale: 900,
  suggestedDuration: TROJAN_PERIOD * 12,
  tags: ['solar-system', 'lagrange', 'restricted'],
  bodies: [
    {
      name: 'Sun',
      mass: SUN_MASS,
      radius: 0.00465,
      position: [-SUN_RADIUS, 0, 0],
      velocity: corotating(-SUN_RADIUS, 0),
      color: '#ffd277',
    },
    {
      name: 'Jupiter',
      mass: JUPITER_MASS,
      radius: 0.000467,
      position: [JUPITER_RADIUS, 0, 0],
      velocity: corotating(JUPITER_RADIUS, 0),
      color: '#d6a05f',
      trail: true,
    },
    ...swarm(1, 260, 606060, '#7aa2f7', 'greek'),
    ...swarm(-1, 260, 909090, '#f7768e', 'trojan'),
  ],
  camera: { mode: '2d', distance: 7.5 },
});

/**
 * A planet orbiting both stars of a binary.
 *
 * Modelled on Kepler-16b, the first circumbinary planet found, with the
 * binary's eccentricity dropped to zero so the preset is stable to look at
 * rather than faithful in every detail. The planet orbits at about three times
 * the binary's separation, which is roughly where such orbits stop being
 * disrupted by the pair underneath them.
 */
const PRIMARY_MASS = 0.6897;
const SECONDARY_MASS = 0.20255;
const BINARY_SEPARATION = 0.2243;
const PLANET_RADIUS_AU = 0.7048;

const BINARY_TOTAL = PRIMARY_MASS + SECONDARY_MASS;
const PRIMARY_OFFSET = (BINARY_SEPARATION * SECONDARY_MASS) / BINARY_TOTAL;
const SECONDARY_OFFSET = (BINARY_SEPARATION * PRIMARY_MASS) / BINARY_TOTAL;
const RELATIVE_SPEED = Math.sqrt((G_SOLAR * BINARY_TOTAL) / BINARY_SEPARATION);

export const circumbinaryPlanet: Scenario = defineScenario({
  id: 'circumbinary-planet',
  name: 'Circumbinary Planet',
  description:
    'A planet going round both stars of a close binary, after Kepler-16b. Its sky has two suns.',
  watchFor: 'The two stars whirl around each other while the planet circles the pair.',
  units: 'solar',
  dt: 0.02,
  integrator: 'yoshida4',
  forceModel: 'direct',
  softening: 0,
  timeScale: 40,
  suggestedDuration: 3000,
  tags: ['binary', 'exoplanet'],
  bodies: [
    {
      name: 'Kepler-16 A',
      mass: PRIMARY_MASS,
      radius: 0.00305,
      position: [-PRIMARY_OFFSET, 0, 0],
      velocity: [0, (-RELATIVE_SPEED * SECONDARY_MASS) / BINARY_TOTAL, 0],
      color: '#ffd277',
      trail: true,
    },
    {
      name: 'Kepler-16 B',
      mass: SECONDARY_MASS,
      radius: 0.0011,
      position: [SECONDARY_OFFSET, 0, 0],
      velocity: [0, (RELATIVE_SPEED * PRIMARY_MASS) / BINARY_TOTAL, 0],
      color: '#f08a5d',
      trail: true,
    },
    {
      name: 'Kepler-16 b',
      // A third of Jupiter.
      mass: 3.18e-4,
      radius: 0.00035,
      position: [0, PLANET_RADIUS_AU, 0],
      // Circular about the pair's combined mass, which is what a planet this
      // far out effectively orbits.
      velocity: [-Math.sqrt((G_SOLAR * BINARY_TOTAL) / PLANET_RADIUS_AU), 0, 0],
      color: '#7dcfff',
      trail: true,
    },
  ],
  camera: { mode: '2d', distance: 1 },
});

export const LAGRANGE_PRESETS: readonly Scenario[] = [trojans, circumbinaryPlanet];
