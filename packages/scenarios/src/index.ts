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
export { accretionDisk } from './presets/accretion.ts';
export { circularBinary, BINARY_PERIOD } from './presets/binary.ts';
export { figureEight, FIGURE_EIGHT_PERIOD } from './presets/figure-eight.ts';
export { pythagorean } from './presets/pythagorean.ts';
export { innerSolarSystem, solarSystem, SOLAR_SYSTEM_EPOCH } from './presets/solar-system.ts';
export {
  butterfly,
  dragonfly,
  goggles,
  lagrangeTriangle,
  moth,
  yinYang,
  LAGRANGE_PERIOD,
  THREE_BODY_PERIODS,
  THREE_BODY_PRESETS,
} from './presets/three-body.ts';
export {
  clusterCollision,
  coldCollapse,
  starCluster,
  CLUSTER_PRESETS,
} from './presets/clusters.ts';
export { galaxyFlyby, spiralDisk, GALAXY_PRESETS } from './presets/galaxies.ts';
export { earthMoon, jovianSystem, MOON_PRESETS } from './presets/moons.ts';
export {
  circumbinaryPlanet,
  trojans,
  LAGRANGE_PRESETS,
  TROJAN_PERIOD,
} from './presets/lagrange-points.ts';
export {
  disk,
  makeRandom,
  plummerSphere,
  removeDrift,
  ring,
  type DiskOptions,
  type PlummerOptions,
  type RingOptions,
} from './generate.ts';
