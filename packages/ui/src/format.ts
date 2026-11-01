/**
 * Number formatting for live readouts.
 *
 * Every formatter here returns a FIXED-WIDTH string for a given call site.
 * A readout whose text changes width sixty times a second shifts its
 * neighbours and reads as jitter, which is exactly the impression the rest of
 * the codebase works to avoid. Fixed width plus tabular figures (see the
 * `.nb-num` class in tokens.css) means only the glyphs change, never the
 * layout.
 */

/**
 * Relative energy drift, as a signed power of ten.
 *
 * Drift spans fifteen orders of magnitude across integrators and step sizes,
 * so a mantissa-and-exponent form is the only one that stays readable, and it
 * is always the same width.
 */
export function formatDrift(drift: number): string {
  if (!Number.isFinite(drift)) return 'diverged';
  if (drift === 0) return '0.0e+00';
  const exponent = Math.floor(Math.log10(Math.abs(drift)));
  const mantissa = drift / 10 ** exponent;
  const sign = exponent < 0 ? '-' : '+';
  const absExponent = Math.abs(exponent).toString().padStart(2, '0');
  return `${mantissa.toFixed(1)}e${sign}${absExponent}`;
}

/** Simulation time in a scenario's own unit, at a fixed width. */
export function formatSimTime(time: number, unit: string): string {
  const magnitude = Math.abs(time);
  const digits = magnitude >= 1e6 ? 0 : magnitude >= 1e3 ? 1 : 3;
  return `${time.toFixed(digits)} ${unit}`;
}

/** Days rendered as years and days, for solar system scenarios. */
export function formatDaysAsYears(days: number): string {
  const years = days / 365.25;
  if (Math.abs(years) < 1) return `${days.toFixed(1)} d`;
  const wholeYears = Math.trunc(years);
  const remainder = Math.abs(days - wholeYears * 365.25);
  return `${wholeYears} y ${remainder.toFixed(0).padStart(3, '0')} d`;
}

/**
 * A value spanning many orders of magnitude, such as a mass in solar masses.
 *
 * Always mantissa-plus-exponent, always the same width, so a slider dragged
 * across ten decades does not make its own label dance.
 */
export function formatScientific(value: number, mantissaDigits = 3): string {
  if (!Number.isFinite(value)) return 'NaN';
  if (value === 0) return `0.${'0'.repeat(mantissaDigits)}e+00`;
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / 10 ** exponent;
  const sign = exponent < 0 ? '-' : '+';
  const absExponent = Math.abs(exponent).toString().padStart(2, '0');
  return `${mantissa.toFixed(mantissaDigits)}e${sign}${absExponent}`;
}

/** Frames per second, always three characters wide. */
export function formatFps(fps: number): string {
  if (!Number.isFinite(fps)) return '---';
  return Math.round(Math.min(999, Math.max(0, fps)))
    .toString()
    .padStart(3, ' ');
}

/**
 * Milliseconds per step, always the same width.
 *
 * Padded to seven characters so everything from 0.001 to 999.999 occupies the
 * same space, and clamped above that rather than growing the field.
 */
export function formatMsPerStep(ms: number): string {
  if (!Number.isFinite(ms)) return '---.--- ms';
  const clamped = Math.min(999.999, Math.max(0, ms));
  return `${clamped.toFixed(3).padStart(7, ' ')} ms`;
}
