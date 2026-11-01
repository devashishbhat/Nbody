/**
 * Physical data for the solar system bodies.
 *
 * State vectors come from JPL Horizons at run time; masses, radii and colours
 * do not, because Horizons returns GM values per body in inconsistent units
 * and nothing about a display colour belongs in an ephemeris query.
 *
 * Masses are PLANETARY SYSTEM masses in solar masses (DE440), so the Earth
 * entry includes the Moon and the Jupiter entry includes its satellites. That
 * matches the Horizons target chosen below, which is each planet's barycentre
 * rather than the planet centre. Mixing the two would misplace the giant
 * planets by thousands of kilometres.
 *
 * Radii are equatorial, converted to AU with 1 AU = 1.495978707e8 km.
 */
export interface BodyData {
  /** Horizons target. Barycentres for the planets, 10 for the Sun. */
  command: string;
  name: string;
  /** Solar masses. */
  mass: number;
  /** Equatorial radius in AU. */
  radius: number;
  color: string;
}

const AU_IN_KM = 1.495978707e8;
const km = (value: number) => value / AU_IN_KM;

export const SOLAR_SYSTEM: readonly BodyData[] = [
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
