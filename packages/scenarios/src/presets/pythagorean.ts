import { defineScenario } from '@nbody/protocol';

/**
 * The Pythagorean three-body problem, also called the Burrau problem (1913).
 *
 * Masses 3, 4 and 5 are placed at the vertices of a 3-4-5 right triangle and
 * released from rest. The system is chaotic: it goes through a long sequence
 * of close encounters before ejecting one body and leaving a binary behind.
 *
 * This is the preset that justifies having an adaptive integrator at all. The
 * close approaches are severe enough that a fixed step large enough to be
 * interactive gives a visibly wrong outcome, so it ships with bulirsch-stoer
 * and zero softening.
 *
 * LANE A: until the adaptive integrator exists, the reference engine
 * approximates this with yoshida4 and says so through a non-fatal warning.
 */
export const pythagorean = defineScenario({
  id: 'pythagorean',
  name: 'Pythagorean Three-Body',
  description:
    'Masses 3, 4 and 5 at the corners of a 3-4-5 triangle, released from rest. Chaotic, and it ends in an ejection.',
  watchFor: 'After a long scramble, one body is thrown out and the other two pair off.',
  units: 'natural',
  dt: 1e-4,
  integrator: 'bulirsch-stoer',
  forceModel: 'direct',
  softening: 0,
  timeScale: 2,
  suggestedDuration: 70,
  tags: ['three-body', 'chaotic', 'ejection'],
  bodies: [
    {
      name: 'Three',
      mass: 3,
      radius: 0.08,
      position: [1, 3, 0],
      velocity: [0, 0, 0],
      color: '#7aa2f7',
      trail: true,
    },
    {
      name: 'Four',
      mass: 4,
      radius: 0.09,
      position: [-2, -1, 0],
      velocity: [0, 0, 0],
      color: '#e0af68',
      trail: true,
    },
    {
      name: 'Five',
      mass: 5,
      radius: 0.1,
      position: [1, -1, 0],
      velocity: [0, 0, 0],
      color: '#f7768e',
      trail: true,
    },
  ],
  camera: { mode: '2d', distance: 5 },
});
