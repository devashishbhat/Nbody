import { defineScenario, type Scenario } from '@nbody/protocol';
import { plummerSphere, removeDrift } from '../generate.ts';

/**
 * Collective systems: many bodies, no individual worth naming.
 *
 * These are where the octree earns its place. They also need softening, which
 * the few-body presets must not have: in a cluster, two stars passing close
 * would otherwise be flung apart by a numerically enormous force that in
 * reality would be a rare encounter between objects a light-year across. The
 * softening length is set near the mean inter-particle spacing, which is the
 * resolution the simulation actually has.
 */

/** Softening at roughly the mean particle spacing in the core. */
function softeningFor(count: number, scaleRadius: number): number {
  return (scaleRadius * 2) / Math.cbrt(count);
}

const CLUSTER_COUNT = 1200;
const CLUSTER_RADIUS = 1;

export const starCluster: Scenario = defineScenario({
  id: 'star-cluster',
  name: 'Star Cluster',
  description:
    'Twelve hundred stars in a Plummer sphere, the standard model of a globular cluster, born in equilibrium.',
  watchFor:
    'It breathes slightly but holds together. Stars near the edge wander far out and come back.',
  units: 'natural',
  // Budgeted. Barnes-Hut at this size costs about 1.5 ms a step, and 125
  // steps a second leaves most of the machine to the renderer. Chosen
  // explicitly rather than left to `auto`, which would pick direct summation
  // below two thousand bodies and cost twice as much here for accuracy this
  // preset does not need.
  dt: 4e-3,
  integrator: 'leapfrog',
  forceModel: 'barnes-hut',
  theta: 0.6,
  softening: softeningFor(CLUSTER_COUNT, CLUSTER_RADIUS),
  timeScale: 0.5,
  suggestedDuration: 60,
  tags: ['cluster', 'collective', 'barnes-hut'],
  bodies: removeDrift(
    plummerSphere({
      count: CLUSTER_COUNT,
      totalMass: 1,
      scaleRadius: CLUSTER_RADIUS,
      seed: 20260101,
      color: '#cfd8ea',
    }),
  ),
  camera: { mode: '3d', distance: 4.5, elevation: 0.4 },
});

/**
 * The same sphere, born far too cold.
 *
 * Velocities are a fifth of what equilibrium requires, so gravity wins and the
 * whole cluster falls inward. It collapses, overshoots, and bounces back out
 * into a much larger, puffier system. This is violent relaxation, and it is
 * how a cluster forgets its initial conditions.
 */
export const coldCollapse: Scenario = defineScenario({
  id: 'cold-collapse',
  name: 'Cold Collapse',
  description:
    'A cluster with almost no motion in it, so gravity pulls the whole thing inward at once.',
  watchFor: 'It falls together, overshoots, and bounces back out much larger than it started.',
  units: 'natural',
  // Smaller step than the equilibrium cluster: everything ends up in one
  // place at the moment of collapse, which is where the dynamics is fastest.
  dt: 2e-3,
  integrator: 'leapfrog',
  forceModel: 'barnes-hut',
  theta: 0.6,
  softening: softeningFor(CLUSTER_COUNT, CLUSTER_RADIUS),
  timeScale: 0.3,
  suggestedDuration: 30,
  tags: ['cluster', 'collective', 'collapse'],
  bodies: removeDrift(
    plummerSphere({
      count: CLUSTER_COUNT,
      totalMass: 1,
      scaleRadius: CLUSTER_RADIUS,
      seed: 7781,
      virial: 0.2,
      color: '#b9c6de',
    }),
  ),
  camera: { mode: '3d', distance: 3, elevation: 0.35 },
});

const PAIR_COUNT = 900;

/**
 * Two clusters on a collision course.
 *
 * Offset along x and given just enough closing speed to meet near the origin.
 * They pass through each other, which stars very nearly always do, and the
 * encounter strips the outskirts of both.
 */
export const clusterCollision: Scenario = defineScenario({
  id: 'cluster-collision',
  name: 'Cluster Collision',
  description: 'Two star clusters of nine hundred stars each, falling toward one another.',
  watchFor: 'They pass through each other rather than bouncing, and leave with far looser edges.',
  units: 'natural',
  dt: 4e-3,
  integrator: 'leapfrog',
  forceModel: 'barnes-hut',
  theta: 0.6,
  softening: softeningFor(PAIR_COUNT, 0.8),
  timeScale: 0.5,
  suggestedDuration: 50,
  tags: ['cluster', 'collective', 'collision'],
  bodies: removeDrift([
    ...plummerSphere({
      count: PAIR_COUNT,
      totalMass: 1,
      scaleRadius: 0.8,
      seed: 4242,
      centre: [-5, -1.2, 0],
      drift: [0.32, 0.03, 0],
      color: '#8fb8e8',
    }),
    ...plummerSphere({
      count: PAIR_COUNT,
      totalMass: 1,
      scaleRadius: 0.8,
      seed: 9119,
      centre: [5, 1.2, 0],
      drift: [-0.32, -0.03, 0],
      color: '#e8b98f',
    }),
  ]),
  camera: { mode: '3d', distance: 9, elevation: 0.5 },
});

export const CLUSTER_PRESETS: readonly Scenario[] = [starCluster, coldCollapse, clusterCollision];
