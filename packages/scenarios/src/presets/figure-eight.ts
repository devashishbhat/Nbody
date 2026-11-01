import { defineScenario } from '@nbody/protocol';

/**
 * The Chenciner-Montgomery figure-eight choreography.
 *
 * Three equal masses chase each other around a single figure-eight curve.
 * Found numerically by Moore in 1993 and proved to exist by Chenciner and
 * Montgomery in 2000. Simo later showed numerically that it is KAM stable,
 * which is why it survives being integrated for thousands of periods.
 *
 * Initial conditions are the standard published set, in natural units with
 * G = 1 and unit masses. Total momentum and the centre of mass are both
 * exactly zero, which is required for the orbit to close.
 *
 * Period: 6.32591398. Refining it to 6.32591403 lowers the return error
 * further, which shows the published figures rather than the integrator are
 * the accuracy floor here. Verified in
 * packages/engine/src/reference/physics.test.ts: every body returns to its
 * starting point within 4e-8 after one period.
 *
 * Softening MUST stay at 0. Any softening at all perturbs the potential and
 * the orbit stops closing.
 */
const VX = 0.466203685;
const VY = 0.43236573;

export const FIGURE_EIGHT_PERIOD = 6.32591398;

export const figureEight = defineScenario({
  id: 'figure-eight',
  name: 'Figure Eight',
  description:
    'Three equal masses chasing each other around a single figure-eight curve, a periodic solution to the three-body problem.',
  watchFor: 'The three paths are one curve. Every body traces the same line.',
  units: 'natural',
  dt: 1e-4,
  integrator: 'yoshida4',
  forceModel: 'direct',
  softening: 0,
  timeScale: 1.5,
  suggestedDuration: FIGURE_EIGHT_PERIOD * 4,
  tags: ['three-body', 'periodic', 'choreography'],
  bodies: [
    {
      name: 'One',
      mass: 1,
      radius: 0.03,
      position: [0.97000436, -0.24308753, 0],
      velocity: [VX, VY, 0],
      color: '#7aa2f7',
      trail: true,
    },
    {
      name: 'Two',
      mass: 1,
      radius: 0.03,
      position: [-0.97000436, 0.24308753, 0],
      velocity: [VX, VY, 0],
      color: '#e0af68',
      trail: true,
    },
    {
      name: 'Three',
      mass: 1,
      radius: 0.03,
      position: [0, 0, 0],
      velocity: [-2 * VX, -2 * VY, 0],
      color: '#9ece6a',
      trail: true,
    },
  ],
  camera: { mode: '2d', distance: 1.5 },
});
