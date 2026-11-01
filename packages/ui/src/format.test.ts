import { describe, expect, it } from 'vitest';
import {
  formatDaysAsYears,
  formatDrift,
  formatFps,
  formatMsPerStep,
  formatScientific,
} from './format.ts';

/**
 * The property under test throughout is WIDTH STABILITY.
 *
 * A readout that changes length as its value changes shifts its neighbours
 * every frame, which is perceived as jitter regardless of how smooth the
 * canvas is. These tests are the mechanical guard on that.
 */
describe('fixed-width formatting', () => {
  it('keeps energy drift the same width across fifteen decades', () => {
    const widths = new Set(
      [1e-16, 1e-12, 3.4e-9, 1e-6, 2.5e-3, 0.1, 1].map((v) => formatDrift(v).length),
    );
    expect(widths.size).toBe(1);
  });

  it('formats drift as a readable mantissa and exponent', () => {
    expect(formatDrift(0)).toBe('0.0e+00');
    expect(formatDrift(1e-12)).toBe('1.0e-12');
    expect(formatDrift(3.46e-7)).toBe('3.5e-07');
  });

  it('reports a diverged run rather than printing NaN', () => {
    expect(formatDrift(Number.NaN)).toBe('diverged');
    expect(formatDrift(Number.POSITIVE_INFINITY)).toBe('diverged');
  });

  it('keeps scientific values the same width across decades', () => {
    const widths = new Set(
      [1e-7, 3.0034e-6, 1, 317.8, 1.989e30].map((v) => formatScientific(v).length),
    );
    expect(widths.size).toBe(1);
  });

  it('keeps fps three characters wide and clamped', () => {
    expect(formatFps(60).length).toBe(3);
    expect(formatFps(7).length).toBe(3);
    expect(formatFps(1234)).toBe('999');
    expect(formatFps(-5)).toBe('  0');
  });

  it('keeps step timing the same width from microseconds to seconds', () => {
    const widths = new Set([0.001, 0.42, 9.5, 123.456].map((v) => formatMsPerStep(v).length));
    expect(widths.size).toBe(1);
  });

  it('renders solar system time as years and days', () => {
    expect(formatDaysAsYears(10)).toBe('10.0 d');
    expect(formatDaysAsYears(365.25)).toBe('1 y 000 d');
    expect(formatDaysAsYears(365.25 * 2 + 100)).toBe('2 y 100 d');
  });
});
