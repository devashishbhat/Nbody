/**
 * Physical data for the bodies fetched from JPL Horizons.
 *
 * State vectors come from Horizons at run time; masses, radii and colours do
 * not. Horizons reports GM per body in inconsistent units and has no opinion
 * at all about what colour Neptune should be.
 *
 * Masses are in solar masses, radii in AU, using 1 AU = 1.495978707e8 km and
 * 1 solar mass = 1.98892e30 kg.
 */

const AU_IN_KM = 1.495978707e8;
const SOLAR_MASS_KG = 1.98892e30;

const km = (value: number) => value / AU_IN_KM;
const kg = (value: number) => value / SOLAR_MASS_KG;

export interface BodyData {
  /** Horizons target id. */
  command: string;
  name: string;
  /** Solar masses. */
  mass: number;
  /** Equatorial radius in AU. */
  radius: number;
  color: string;
}

export interface SystemSpec {
  /** Output file name, without the extension. */
  id: string;
  /** Horizons coordinate centre. */
  center: string;
  centerLabel: string;
  bodies: readonly BodyData[];
}

/**
 * The planets, as SYSTEM masses.
 *
 * Earth includes the Moon and Jupiter includes its satellites, which matches
 * the Horizons targets below: those are each planet's barycentre, not the
 * planet's centre. Mixing the two misplaces the giant planets by thousands of
 * kilometres.
 */
const SOLAR_SYSTEM_BODIES: readonly BodyData[] = [
  { command: '10', name: 'Sun', mass: 1, radius: km(696000), color: '#ffd277' },
  { command: '1', name: 'Mercury', mass: 1.6601e-7, radius: km(2439.7), color: '#9c8f85' },
  { command: '2', name: 'Venus', mass: 2.4478383e-6, radius: km(6051.8), color: '#e0c48a' },
  { command: '3', name: 'Earth', mass: 3.0404326e-6, radius: km(6371), color: '#6b9bd8' },
  { command: '4', name: 'Mars', mass: 3.2271514e-7, radius: km(3389.5), color: '#d1654a' },
  { command: '5', name: 'Jupiter', mass: 9.5479194e-4, radius: km(69911), color: '#d6a05f' },
  { command: '6', name: 'Saturn', mass: 2.8588567e-4, radius: km(58232), color: '#e3cb94' },
  { command: '7', name: 'Uranus', mass: 4.366244e-5, radius: km(25362), color: '#9fd8e0' },
  { command: '8', name: 'Neptune', mass: 5.151389e-5, radius: km(24622), color: '#6f8fe0' },
];

/**
 * The Sun, Earth and Moon individually.
 *
 * Note the targets: 399 and 301 are the Earth and the Moon themselves, not the
 * Earth-Moon barycentre, so the masses here are the individual ones rather
 * than the system mass used above.
 */
const EARTH_MOON_BODIES: readonly BodyData[] = [
  { command: '10', name: 'Sun', mass: 1, radius: km(696000), color: '#ffd277' },
  { command: '399', name: 'Earth', mass: 3.0034896e-6, radius: km(6371), color: '#6b9bd8' },
  { command: '301', name: 'Moon', mass: kg(7.342e22), radius: km(1737.4), color: '#b9b6ae' },
];

/** Jupiter and the four moons Galileo saw in 1610. */
const JOVIAN_BODIES: readonly BodyData[] = [
  { command: '599', name: 'Jupiter', mass: 9.54594e-4, radius: km(69911), color: '#d6a05f' },
  { command: '501', name: 'Io', mass: kg(8.931938e22), radius: km(1821.6), color: '#e8d98a' },
  { command: '502', name: 'Europa', mass: kg(4.799844e22), radius: km(1560.8), color: '#d8cdb8' },
  { command: '503', name: 'Ganymede', mass: kg(1.4819e23), radius: km(2634.1), color: '#a89a86' },
  { command: '504', name: 'Callisto', mass: kg(1.075938e23), radius: km(2410.3), color: '#7e7364' },
];

export const SYSTEMS: readonly SystemSpec[] = [
  {
    id: 'solar-system',
    // The solar system barycentre. Heliocentric vectors would put the Sun at
    // rest at the origin and hand the whole system a net momentum, so it
    // would slide off screen over a long run.
    center: '500@0',
    centerLabel: 'solar system barycentre (500@0)',
    bodies: SOLAR_SYSTEM_BODIES,
  },
  {
    id: 'earth-moon',
    center: '500@0',
    centerLabel: 'solar system barycentre (500@0)',
    bodies: EARTH_MOON_BODIES,
  },
  {
    id: 'jovian',
    // Jupiter's barycentre, so the system is self-contained and the moons are
    // not dominated by a shared orbital velocity about the Sun.
    center: '500@5',
    centerLabel: 'Jupiter system barycentre (500@5)',
    bodies: JOVIAN_BODIES,
  },
];
