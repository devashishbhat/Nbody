/**
 * @nbody/scenarios
 *
 * LANE D owns this package: all presets, the procedural generators, the share
 * link codec, and the JPL Horizons tooling under tools/horizons.
 */
export { DEFAULT_PRESET_ID, defaultPreset, getPreset, presets, presetsById } from './registry.ts';
export { circularBinary, BINARY_PERIOD } from './presets/binary.ts';
export { figureEight, FIGURE_EIGHT_PERIOD } from './presets/figure-eight.ts';
export { pythagorean } from './presets/pythagorean.ts';
export { innerSolarSystem, solarSystem, SOLAR_SYSTEM_EPOCH } from './presets/solar-system.ts';
