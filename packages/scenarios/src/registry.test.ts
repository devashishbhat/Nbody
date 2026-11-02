import { safeParseScenario } from '@nbody/protocol';
import { describe, expect, it } from 'vitest';
import { presets, presetsById, defaultPreset } from './registry.ts';

/**
 * Every preset is validated here.
 *
 * Every preset is validated here, and the suite is written so that adding one
 * extends it automatically. A preset that fails validation would otherwise
 * surface as a blank screen or a NaN cascade at load, which is far more
 * expensive to debug than a failing assertion.
 */
describe('preset registry', () => {
  it('has a default preset', () => {
    expect(defaultPreset()).toBeDefined();
  });

  it('gives every preset a unique id', () => {
    expect(presetsById.size).toBe(presets.length);
  });

  it.each(presets.map((p) => [p.id, p] as const))('validates %s', (_id, scenario) => {
    const result = safeParseScenario(scenario);
    if (!result.ok) throw new Error(result.error);
    expect(result.ok).toBe(true);
  });

  it.each(presets.map((p) => [p.id, p] as const))(
    'gives %s a description and a non-zero time scale',
    (_id, scenario) => {
      expect(scenario.description.length).toBeGreaterThan(10);
      expect(scenario.timeScale).toBeGreaterThan(0);
    },
  );

  it('keeps softening at zero for the periodic families', () => {
    // Any softening perturbs the potential and the orbits stop closing, so
    // this is a correctness constraint rather than a style preference.
    for (const scenario of presets) {
      if (scenario.tags.includes('periodic')) {
        expect(scenario.softening).toBe(0);
      }
    }
  });
});
