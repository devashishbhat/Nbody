import type { Scenario } from '@nbody/protocol';
import { circularBinary } from './presets/binary.ts';
import { figureEight } from './presets/figure-eight.ts';
import { pythagorean } from './presets/pythagorean.ts';
import { innerSolarSystem, solarSystem } from './presets/solar-system.ts';

/**
 * Preset registry.
 *
 * Every preset documents where its initial conditions came from and why its
 * settings are what they are, because a preset with unexplained numbers cannot
 * be checked or safely changed later. Each is validated by the schema and
 * integrated in the cross-package physics fixtures.
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
