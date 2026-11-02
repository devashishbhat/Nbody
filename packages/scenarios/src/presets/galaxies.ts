import { defineScenario, type Scenario } from '@nbody/protocol';
import { disk, removeDrift } from '../generate.ts';

/**
 * Disk systems.
 *
 * Not galaxies in any serious sense: there is no dark halo, no gas, and the
 * disk is a few thousand equal particles rather than a hundred billion stars.
 * What they do reproduce is the thing worth seeing, which is that differential
 * rotation plus self-gravity makes structure, and that a passing companion
 * raises tides that become tails.
 */

const DISK_COUNT = 2200;

export const spiralDisk: Scenario = defineScenario({
  id: 'spiral-disk',
  name: 'Spiral Disk',
  description: 'A rotating disk of two thousand particles around a heavy core, started in balance.',
  watchFor:
    'Transient spiral arms appear and wind up, because the inside orbits faster than the outside.',
  units: 'natural',
  // Budgeted against measurement: Barnes-Hut at this size is about 2.5 ms a
  // step, so 150 steps a second is roughly a quarter of the worker's time and
  // leaves the frame rate alone. The inner orbit still gets some 400 steps.
  dt: 5e-3,
  integrator: 'leapfrog',
  forceModel: 'barnes-hut',
  theta: 0.7,
  // Near the mean particle spacing in the disk. Without it, chance close
  // passes between neighbouring particles would scatter the disk into a blur.
  softening: 0.06,
  timeScale: 0.75,
  suggestedDuration: 120,
  tags: ['galaxy', 'collective', 'barnes-hut'],
  bodies: removeDrift(
    disk({
      count: DISK_COUNT,
      centralMass: 1,
      diskMass: 0.25,
      innerRadius: 0.6,
      outerRadius: 6,
      seed: 31415,
      thickness: 0.03,
      centralName: 'Core',
      centralRadius: 0.12,
      color: '#9ec7f5',
    }),
  ),
  camera: { mode: '2d', distance: 8 },
});

const FLYBY_COUNT = 1300;

/**
 * A close encounter between two disks.
 *
 * The intruder is on a hyperbolic pass rather than a merger orbit, which is
 * what raises tails: the tide on the near side pulls material out ahead and
 * the far side lags behind, and both get stretched into long thin streams.
 * This is the mechanism behind the Antennae and the Mice.
 */
export const galaxyFlyby: Scenario = defineScenario({
  id: 'galaxy-flyby',
  name: 'Galaxy Flyby',
  description: 'Two rotating disks passing close enough to pull each other apart.',
  watchFor: 'Long tidal tails trail behind both, drawn out by the pass rather than thrown off.',
  units: 'natural',
  dt: 5e-3,
  integrator: 'leapfrog',
  forceModel: 'barnes-hut',
  theta: 0.7,
  softening: 0.08,
  timeScale: 0.75,
  suggestedDuration: 140,
  tags: ['galaxy', 'collective', 'collision'],
  bodies: removeDrift([
    ...disk({
      count: FLYBY_COUNT,
      centralMass: 1,
      diskMass: 0.2,
      innerRadius: 0.5,
      outerRadius: 4,
      seed: 2718,
      thickness: 0.03,
      centre: [-7, -2.5, 0],
      drift: [0.28, 0.02, 0],
      centralName: 'Core A',
      centralRadius: 0.1,
      color: '#9ec7f5',
    }),
    ...disk({
      count: FLYBY_COUNT,
      centralMass: 0.7,
      diskMass: 0.14,
      innerRadius: 0.4,
      outerRadius: 3,
      seed: 1618,
      thickness: 0.03,
      spin: -1,
      tilt: 0.5,
      centre: [7, 2.5, 0],
      drift: [-0.28, -0.02, 0],
      centralName: 'Core B',
      centralRadius: 0.09,
      color: '#f5b78f',
    }),
  ]),
  camera: { mode: '3d', distance: 13, elevation: 0.45 },
});

export const GALAXY_PRESETS: readonly Scenario[] = [spiralDisk, galaxyFlyby];
