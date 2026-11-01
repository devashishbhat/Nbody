import { describe, expect, it } from 'vitest';
import { dominantBody, orbitalElements } from './orbit.ts';
import type { Vec3 } from './scenario.ts';
import { G_SOLAR } from './units.ts';

const ORIGIN: Vec3 = [0, 0, 0];

describe('osculating orbital elements', () => {
  it('describes a circular orbit as circular', () => {
    // Unit circular orbit about a unit mass with G = 1: v = sqrt(mu / r) = 1.
    const elements = orbitalElements(1, 1, 0, ORIGIN, ORIGIN, [1, 0, 0], [0, 1, 0])!;
    expect(elements.eccentricity).toBeCloseTo(0, 12);
    expect(elements.semiMajorAxis).toBeCloseTo(1, 12);
    expect(elements.periapsis).toBeCloseTo(1, 12);
    expect(elements.apoapsis).toBeCloseTo(1, 12);
    expect(elements.period).toBeCloseTo(2 * Math.PI, 12);
    expect(elements.inclination).toBeCloseTo(0, 12);
    expect(elements.bound).toBe(true);
  });

  it('stays accurate for a nearly circular orbit', () => {
    // The reason the eccentricity vector is computed as a vector. The scalar
    // formula is a difference of two nearly equal numbers here and loses most
    // of its significant digits.
    const elements = orbitalElements(1, 1, 0, ORIGIN, ORIGIN, [1, 0, 0], [0, 1 + 1e-7, 0])!;
    expect(elements.eccentricity).toBeGreaterThan(1e-8);
    expect(elements.eccentricity).toBeLessThan(1e-6);
  });

  it('recovers the eccentricity of an elliptical orbit', () => {
    // At periapsis of an orbit with a = 1, e = 0.5: r = 0.5 and
    // v = sqrt(mu (1 + e) / (a (1 - e))) = sqrt(3).
    const elements = orbitalElements(1, 1, 0, ORIGIN, ORIGIN, [0.5, 0, 0], [0, Math.sqrt(3), 0])!;
    expect(elements.eccentricity).toBeCloseTo(0.5, 10);
    expect(elements.semiMajorAxis).toBeCloseTo(1, 10);
    expect(elements.periapsis).toBeCloseTo(0.5, 10);
    expect(elements.apoapsis).toBeCloseTo(1.5, 10);
    // At periapsis the true anomaly is zero.
    expect(elements.trueAnomaly).toBeCloseTo(0, 8);
  });

  it('reports a half orbit as being at apoapsis', () => {
    const elements = orbitalElements(
      1,
      1,
      0,
      ORIGIN,
      ORIGIN,
      [-1.5, 0, 0],
      [0, -Math.sqrt(1 / 3), 0],
    )!;
    expect(elements.eccentricity).toBeCloseTo(0.5, 8);
    expect(elements.trueAnomaly).toBeCloseTo(Math.PI, 6);
  });

  it('marks an escaping body as unbound', () => {
    // Escape velocity at r = 1 about a unit mass is sqrt(2).
    const elements = orbitalElements(1, 1, 0, ORIGIN, ORIGIN, [1, 0, 0], [0, 2, 0])!;
    expect(elements.bound).toBe(false);
    expect(elements.eccentricity).toBeGreaterThan(1);
    expect(elements.apoapsis).toBe(Number.POSITIVE_INFINITY);
    expect(elements.period).toBe(Number.POSITIVE_INFINITY);
  });

  it('measures inclination from the reference plane', () => {
    const polar = orbitalElements(1, 1, 0, ORIGIN, ORIGIN, [1, 0, 0], [0, 0, 1])!;
    expect(polar.inclination).toBeCloseTo(Math.PI / 2, 12);

    const retrograde = orbitalElements(1, 1, 0, ORIGIN, ORIGIN, [1, 0, 0], [0, -1, 0])!;
    expect(retrograde.inclination).toBeCloseTo(Math.PI, 12);
  });

  it('gets Earth right from real ephemeris values', () => {
    // Earth about the Sun in AU and days: a should come out at 1 AU and the
    // period at a sidereal year. This is the end-to-end check that G_SOLAR,
    // the unit system and the formulae all agree.
    const elements = orbitalElements(
      G_SOLAR,
      1,
      3.0404326e-6,
      ORIGIN,
      ORIGIN,
      [-0.1773, 0.9684, -0.00006],
      [-0.01720454, -0.0031166, 0.00000024],
    )!;
    expect(elements.semiMajorAxis).toBeGreaterThan(0.99);
    expect(elements.semiMajorAxis).toBeLessThan(1.01);
    expect(elements.period).toBeGreaterThan(360);
    expect(elements.period).toBeLessThan(370);
    expect(elements.eccentricity).toBeLessThan(0.03);
  });

  it('includes both masses in the gravitational parameter', () => {
    // An equal-mass binary at unit separation has mu = G(M + m) = 2, so its
    // circular speed is sqrt(2) and its period is 2*pi*sqrt(1/2) = 4.4429.
    //
    // This is a sharp test rather than a ratio comparison: had only the
    // primary's mass been used, mu would be 1, the same speed would give
    // exactly zero orbital energy, and the orbit would be reported as
    // parabolic and unbound instead of circular.
    const elements = orbitalElements(1, 1, 1, ORIGIN, ORIGIN, [1, 0, 0], [0, Math.SQRT2, 0])!;
    expect(elements.bound).toBe(true);
    expect(elements.eccentricity).toBeCloseTo(0, 12);
    expect(elements.semiMajorAxis).toBeCloseTo(1, 12);
    expect(elements.period).toBeCloseTo(2 * Math.PI * Math.SQRT1_2, 10);
  });

  it('returns null for a degenerate pair rather than NaN', () => {
    expect(orbitalElements(1, 1, 0, ORIGIN, ORIGIN, ORIGIN, [0, 1, 0])).toBeNull();
    expect(orbitalElements(1, 0, 0, ORIGIN, ORIGIN, [1, 0, 0], [0, 1, 0])).toBeNull();
  });
});

describe('dominantBody', () => {
  it('finds the most massive body', () => {
    expect(dominantBody([1, 5, 3], 3)).toBe(1);
    expect(dominantBody([0, 0, 0], 3)).toBe(0);
  });

  it('ignores slots past the live count', () => {
    expect(dominantBody([1, 2, 999], 2)).toBe(1);
  });

  it('returns -1 when there are no bodies', () => {
    expect(dominantBody([], 0)).toBe(-1);
  });
});
