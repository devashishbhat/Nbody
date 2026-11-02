import type { Scenario } from '@nbody/protocol';
import { circularBinary } from './presets/binary.ts';
import { figureEight } from './presets/figure-eight.ts';
import { pythagorean } from './presets/pythagorean.ts';
import { innerSolarSystem, solarSystem } from './presets/solar-system.ts';
import { accretionDisk } from './presets/accretion.ts';
import { CLUSTER_PRESETS } from './presets/clusters.ts';
import { GALAXY_PRESETS } from './presets/galaxies.ts';
import { LAGRANGE_PRESETS } from './presets/lagrange-points.ts';
import { MOON_PRESETS } from './presets/moons.ts';
import { THREE_BODY_PRESETS } from './presets/three-body.ts';

/**
 * Preset registry.
 *
 * Every preset documents where its initial conditions came from and why its
 * settings are what they are, because a preset with unexplained numbers cannot
 * be checked or safely changed later. Each is validated by the schema and
 * integrated in the cross-package physics fixtures.
 */
/**
 * Every preset, in the order the picker and the number keys use.
 *
 * Ordered by how much explanation each needs rather than by subject: the
 * solar system first because everyone already knows what they are looking at,
 * then the periodic orbits, then the collective systems.
 */
export const presets: readonly Scenario[] = [
  solarSystem,
  innerSolarSystem,
  ...MOON_PRESETS,
  figureEight,
  ...THREE_BODY_PRESETS,
  pythagorean,
  circularBinary,
  ...LAGRANGE_PRESETS,
  accretionDisk,
  ...CLUSTER_PRESETS,
  ...GALAXY_PRESETS,
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
