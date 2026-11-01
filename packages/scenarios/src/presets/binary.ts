import { defineScenario } from '@nbody/protocol';

/**
 * A circular equal-mass binary, separation 1, in natural units.
 *
 * The simplest system with an exact closed-form solution, which makes it the
 * calibration case for everything else: each body orbits the centre of mass at
 * r = 1/2, so the centripetal requirement v^2 / r must equal the mutual
 * attraction G m / d^2 = 1, giving v = sqrt(1/2) and a period of
 * 2 pi r / v = 4.4429.
 *
 * Energy is exactly -1/2: kinetic 1/2, potential -1. Verified against the
 * closed form in packages/engine/src/reference/physics.test.ts.
 */
export const BINARY_PERIOD = (2 * Math.PI * 0.5) / Math.sqrt(0.5);

const V = Math.sqrt(0.5);

export const circularBinary = defineScenario({
  id: 'circular-binary',
  name: 'Circular Binary',
  description: 'Two equal masses on a perfectly circular mutual orbit.',
  watchFor: 'The energy readout should not move at all.',
  units: 'natural',
  dt: 1e-3,
  integrator: 'leapfrog',
  forceModel: 'direct',
  softening: 0,
  timeScale: 1,
  suggestedDuration: BINARY_PERIOD * 10,
  tags: ['two-body', 'periodic', 'calibration'],
  bodies: [
    {
      name: 'A',
      mass: 1,
      radius: 0.04,
      position: [-0.5, 0, 0],
      velocity: [0, -V, 0],
      color: '#e8e6e3',
      trail: true,
    },
    {
      name: 'B',
      mass: 1,
      radius: 0.04,
      position: [0.5, 0, 0],
      velocity: [0, V, 0],
      color: '#7dcfff',
      trail: true,
    },
  ],
  camera: { mode: '2d', distance: 0.9 },
});
