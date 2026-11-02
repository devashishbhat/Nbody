/**
 * @nbody/scenarios
 *
 * The presets, and the codec that turns any scenario into a share link.
 */
export {
  buildHash,
  decodeScenario,
  encodeScenario,
  matchesPreset,
  parseHash,
  safeDecodeScenario,
  tooLargeToShare,
  MAX_SHARE_LENGTH,
  MAX_SHAREABLE_BODIES,
  type ShareTarget,
} from './codec.ts';
export { DEFAULT_PRESET_ID, defaultPreset, getPreset, presets, presetsById } from './registry.ts';
export { circularBinary, BINARY_PERIOD } from './presets/binary.ts';
export { figureEight, FIGURE_EIGHT_PERIOD } from './presets/figure-eight.ts';
export { pythagorean } from './presets/pythagorean.ts';
export { innerSolarSystem, solarSystem, SOLAR_SYSTEM_EPOCH } from './presets/solar-system.ts';
