/**
 * Unit systems.
 *
 * A scenario declares the units its numbers are expressed in, and every layer
 * above (engine, renderer, UI) reads values in that system rather than
 * converting to a canonical one. Converting would either lose precision at
 * solar-system scale or force the few-body choreographies into absurd
 * magnitudes, and neither is worth the uniformity.
 */
export type UnitSystem = 'solar' | 'si' | 'natural';

/**
 * Gravitational constant in AU^3 / (solar mass * day^2).
 *
 * This is the IAU Gaussian gravitational constant k = 0.01720209895 squared.
 * Solar system presets use this system because it keeps every coordinate,
 * velocity and mass within a few orders of magnitude of 1, which is where f64
 * has the most headroom.
 */
export const G_SOLAR = 2.959122082855911e-4;

/** Gravitational constant in m^3 / (kg * s^2). CODATA 2018. */
export const G_SI = 6.6743e-11;

/** Natural units: G is exactly 1. Used by the periodic few-body families. */
export const G_NATURAL = 1;

export function defaultG(units: UnitSystem): number {
  switch (units) {
    case 'solar':
      return G_SOLAR;
    case 'si':
      return G_SI;
    case 'natural':
      return G_NATURAL;
  }
}

/** Conversion factors, for display only. Never applied to simulation state. */
export const AU_IN_KM = 1.495978707e8;
export const AU_IN_M = 1.495978707e11;
export const DAY_IN_S = 86400;
export const YEAR_IN_DAYS = 365.25;
export const MSUN_IN_KG = 1.98892e30;
export const MEARTH_IN_MSUN = 3.0034893488507934e-6;

export interface UnitLabels {
  readonly length: string;
  readonly time: string;
  readonly mass: string;
  readonly velocity: string;
}

export const UNIT_LABELS: Readonly<Record<UnitSystem, UnitLabels>> = {
  solar: { length: 'AU', time: 'd', mass: 'M☉', velocity: 'AU/d' },
  si: { length: 'm', time: 's', mass: 'kg', velocity: 'm/s' },
  natural: { length: 'L', time: 'T', mass: 'M', velocity: 'L/T' },
};
