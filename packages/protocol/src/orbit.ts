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

/**
 * Samples the osculating conic through a body, as absolute world positions.
 *
 * Built directly from the state vectors in the perifocal basis rather than
 * from Euler angles: the orbit normal and the eccentricity vector already
 * define the plane and the periapsis direction, so there is no need to extract
 * inclination, node and argument of periapsis only to rebuild a rotation from
 * them. Fewer trigonometric round trips and no gimbal special cases.
 *
 * Writes `samples` interleaved xyz triples into `out`, which must hold at
 * least `samples * 3` values. Returns the number of samples written, or 0 if
 * the orbit is degenerate.
 *
 * For an unbound orbit the sampled arc is truncated short of the asymptotes,
 * since the conic runs to infinity and drawing all of it is meaningless.
 */
export function sampleOrbit(
  G: number,
  primaryMass: number,
  bodyMass: number,
  primaryPosition: Vec3,
  primaryVelocity: Vec3,
  bodyPosition: Vec3,
  bodyVelocity: Vec3,
  out: Float64Array,
  samples: number,
): number {
  const mu = G * (primaryMass + bodyMass);
  if (mu <= 0 || samples < 2 || out.length < samples * 3) return 0;

  const rx = bodyPosition[0] - primaryPosition[0];
  const ry = bodyPosition[1] - primaryPosition[1];
  const rz = bodyPosition[2] - primaryPosition[2];
  const vx = bodyVelocity[0] - primaryVelocity[0];
  const vy = bodyVelocity[1] - primaryVelocity[1];
  const vz = bodyVelocity[2] - primaryVelocity[2];

  const r = Math.hypot(rx, ry, rz);
  if (r === 0) return 0;

  // Orbit normal.
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const h = Math.hypot(hx, hy, hz);
  // Zero angular momentum is a radial fall, which has no conic to draw.
  if (h === 0) return 0;

  const v2 = vx * vx + vy * vy + vz * vz;
  const rv = rx * vx + ry * vy + rz * vz;
  const c = v2 - mu / r;
  let ex = (c * rx - rv * vx) / mu;
  let ey = (c * ry - rv * vy) / mu;
  let ez = (c * rz - rv * vz) / mu;
  const e = Math.hypot(ex, ey, ez);

  // Periapsis direction. For a circular orbit the eccentricity vector is zero,
  // so any direction in the plane will do; the current position is the
  // convenient one.
  if (e > 1e-12) {
    ex /= e;
    ey /= e;
    ez /= e;
  } else {
    ex = rx / r;
    ey = ry / r;
    ez = rz / r;
  }

  // Completing the perifocal basis: q = (h / |h|) x e.
  const nx = hx / h;
  const ny = hy / h;
  const nz = hz / h;
  const qx = ny * ez - nz * ey;
  const qy = nz * ex - nx * ez;
  const qz = nx * ey - ny * ex;

  const semiLatusRectum = (h * h) / mu;

  // A bound orbit closes, so sweep the full turn. An unbound one is cut off
  // before the asymptote, where the radius runs away to infinity.
  let span = Math.PI * 2;
  if (e >= 1) {
    const asymptote = Math.acos(Math.min(1, Math.max(-1, -1 / e)));
    span = 2 * asymptote * 0.94;
  }

  for (let i = 0; i < samples; i++) {
    const nu = e >= 1 ? -span / 2 + (span * i) / (samples - 1) : (span * i) / (samples - 1);
    const denominator = 1 + e * Math.cos(nu);
    // Guard the asymptote: a denominator at zero is the point at infinity.
    const radius = denominator <= 1e-9 ? 0 : semiLatusRectum / denominator;
    const cosNu = Math.cos(nu);
    const sinNu = Math.sin(nu);
    const d = i * 3;
    out[d] = primaryPosition[0] + radius * (cosNu * ex + sinNu * qx);
    out[d + 1] = primaryPosition[1] + radius * (cosNu * ey + sinNu * qy);
    out[d + 2] = primaryPosition[2] + radius * (cosNu * ez + sinNu * qz);
  }

  return samples;
}
