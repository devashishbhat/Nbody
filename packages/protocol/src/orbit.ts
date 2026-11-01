import type { Vec3 } from './scenario.ts';

/**
 * Osculating orbital elements.
 *
 * The instantaneous two-body orbit a body would follow if every other body
 * vanished. For a planet around a dominant star that is very nearly the orbit
 * it is actually on, which makes these the most informative numbers that can
 * be shown about a body, and they cost a dozen arithmetic operations.
 *
 * "Osculating" is the important qualifier: in a real N-body system these
 * change continuously as the other bodies perturb the orbit. Watching the
 * eccentricity of an inner planet breathe while Jupiter's mass is dragged
 * upward is the point.
 */
export interface OrbitalElements {
  /** Semi-major axis. Negative for a hyperbolic orbit. */
  semiMajorAxis: number;
  eccentricity: number;
  /** Radians from the reference plane. */
  inclination: number;
  /** Closest approach distance. */
  periapsis: number;
  /** Farthest distance, or Infinity if the orbit is not closed. */
  apoapsis: number;
  /** Orbital period, or Infinity if the orbit is not closed. */
  period: number;
  /** Radians. Angle from periapsis to the body's current position. */
  trueAnomaly: number;
  /** Current separation from the primary. */
  distance: number;
  /** Current speed relative to the primary. */
  speed: number;
  /** Specific orbital energy. Negative when bound. */
  energy: number;
  /** False when the orbit is unbound, so the caller can say "escaping". */
  bound: boolean;
}

/**
 * Computes the osculating elements of `body` about `primary`.
 *
 * `G` must be in the same unit system as the positions, velocities and masses.
 * Both masses are included in the gravitational parameter, which is what makes
 * the period correct for a binary of comparable masses rather than only for a
 * test particle.
 *
 * Returns null when the two-body problem is degenerate: zero separation, or no
 * mass to orbit.
 */
export function orbitalElements(
  G: number,
  primaryMass: number,
  bodyMass: number,
  primaryPosition: Vec3,
  primaryVelocity: Vec3,
  bodyPosition: Vec3,
  bodyVelocity: Vec3,
): OrbitalElements | null {
  const mu = G * (primaryMass + bodyMass);
  if (mu <= 0) return null;

  const rx = bodyPosition[0] - primaryPosition[0];
  const ry = bodyPosition[1] - primaryPosition[1];
  const rz = bodyPosition[2] - primaryPosition[2];

  const vx = bodyVelocity[0] - primaryVelocity[0];
  const vy = bodyVelocity[1] - primaryVelocity[1];
  const vz = bodyVelocity[2] - primaryVelocity[2];

  const r = Math.hypot(rx, ry, rz);
  if (r === 0) return null;

  const v2 = vx * vx + vy * vy + vz * vz;
  const speed = Math.sqrt(v2);

  // Specific angular momentum, h = r x v.
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const h = Math.hypot(hx, hy, hz);

  const energy = v2 / 2 - mu / r;

  // Eccentricity vector, e = ((v^2 - mu/r) r - (r . v) v) / mu. Computed as a
  // vector rather than from the scalar formula because the vector form stays
  // accurate for near-circular orbits, where the scalar form is the difference
  // of two nearly equal numbers.
  const rv = rx * vx + ry * vy + rz * vz;
  const c = v2 - mu / r;
  const ex = (c * rx - rv * vx) / mu;
  const ey = (c * ry - rv * vy) / mu;
  const ez = (c * rz - rv * vz) / mu;
  const eccentricity = Math.hypot(ex, ey, ez);

  const bound = energy < 0;
  const semiMajorAxis = energy === 0 ? Number.POSITIVE_INFINITY : -mu / (2 * energy);

  const periapsis = bound ? semiMajorAxis * (1 - eccentricity) : (h * h) / mu / (1 + eccentricity);
  const apoapsis = bound ? semiMajorAxis * (1 + eccentricity) : Number.POSITIVE_INFINITY;

  const period =
    bound && semiMajorAxis > 0
      ? 2 * Math.PI * Math.sqrt((semiMajorAxis * semiMajorAxis * semiMajorAxis) / mu)
      : Number.POSITIVE_INFINITY;

  const inclination = h === 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, hz / h)));

  // True anomaly from the angle between the eccentricity vector and r, signed
  // by whether the body is moving outward.
  let trueAnomaly = 0;
  if (eccentricity > 1e-12) {
    const cosNu = (ex * rx + ey * ry + ez * rz) / (eccentricity * r);
    trueAnomaly = Math.acos(Math.min(1, Math.max(-1, cosNu)));
    if (rv < 0) trueAnomaly = 2 * Math.PI - trueAnomaly;
  }

  return {
    semiMajorAxis,
    eccentricity,
    inclination,
    periapsis,
    apoapsis,
    period,
    trueAnomaly,
    distance: r,
    speed,
    energy,
    bound,
  };
}

/**
 * Index of the most massive body, which is the sensible primary to report
 * elements against. Returns -1 for an empty list.
 */
export function dominantBody(masses: ArrayLike<number>, count: number): number {
  let best = -1;
  let bestMass = -Infinity;
  for (let i = 0; i < count; i++) {
    const mass = masses[i]!;
    if (mass > bestMass) {
      bestMass = mass;
      best = i;
    }
  }
  return best;
}
