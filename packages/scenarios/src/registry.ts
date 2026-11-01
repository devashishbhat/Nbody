import type { Scenario } from '@nbody/protocol';
import { circularBinary } from './presets/binary.ts';
import { figureEight } from './presets/figure-eight.ts';
import { pythagorean } from './presets/pythagorean.ts';
import { innerSolarSystem, solarSystem } from './presets/solar-system.ts';

/**
 * Preset registry.
 *
 * LANE D owns this package and is expected to grow this list to the full set
 * in the plan: the JPL-derived solar system family, the remaining periodic
 * three-body families, and the procedural collective scenarios.
 *
 * The three seeds here are the ones whose initial conditions are already
 * verified against closed-form or published results, so they double as the
 * template for how a preset should be documented and tested.
 */
export const presets: readonly Scenario[] = [
  solarSystem,
  innerSolarSystem,
  figureEight,
  pythagorean,
  circularBinary,
];

export const presetsById: ReadonlyMap<string, Scenario> = new Map(
  presets.map((scenario) => [scenario.id, scenario]),
);

export const DEFAULT_PRESET_ID = 'solar-system';

export function getPreset(id: string): Scenario | undefined {
  return presetsById.get(id);
}

export function defaultPreset(): Scenario {
  const scenario = presetsById.get(DEFAULT_PRESET_ID);
  if (!scenario) throw new Error(`default preset "${DEFAULT_PRESET_ID}" is missing`);
  return scenario;
}
