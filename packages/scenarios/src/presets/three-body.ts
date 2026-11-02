import { defineScenario, type BodyInput, type Scenario } from '@nbody/protocol';

/**
 * Periodic solutions to the three-body problem.
 *
 * The general three-body problem has no closed-form solution, but it has an
 * infinity of exactly periodic ones, and a handful of them are beautiful. Most
 * of those below come from Suvakov and Dmitrasinovic's 2013 catalogue, which
 * found thirteen new classes by searching the shape sphere.
 *
 * They all share a setup: three equal masses with G = 1, two of them at
 * (-1, 0) and (1, 0) moving together, and a third at the origin moving the
 * other way twice as fast, so the centre of mass is at rest and stays there.
 * The entire family is then parameterised by two numbers, and every orbit here
 * differs from the others only in those two.
 *
 * The periods are the published ones. Every orbit in this file is checked in
 * the cross-package physics fixtures by integrating one full period and
 * measuring how far each body lands from where it began, which is the only way
 * to know a transcribed constant is right.
 */

const COLORS = ['#7aa2f7', '#e0af68', '#9ece6a'] as const;

/** The shared Suvakov-Dmitrasinovic configuration, parameterised by velocity. */
function symmetricThreeBody(vx: number, vy: number): BodyInput[] {
  return [
    {
      name: 'One',
      mass: 1,
      radius: 0.035,
      position: [-1, 0, 0],
      velocity: [vx, vy, 0],
      color: COLORS[0],
      trail: true,
    },
    {
      name: 'Two',
      mass: 1,
      radius: 0.035,
      position: [1, 0, 0],
      velocity: [vx, vy, 0],
      color: COLORS[1],
      trail: true,
    },
    {
      name: 'Three',
      mass: 1,
      radius: 0.035,
      position: [0, 0, 0],
      velocity: [-2 * vx, -2 * vy, 0],
      color: COLORS[2],
      trail: true,
    },
  ];
}

interface FamilyOptions {
  id: string;
  name: string;
  description: string;
  watchFor: string;
  vx: number;
  vy: number;
  period: number;
  distance?: number;
  /** Overrides the default fixed-step integrator. See dragonfly. */
  integrator?: Scenario['integrator'];
  dt?: number;
}

function family(options: FamilyOptions): Scenario {
  return defineScenario({
    id: options.id,
    name: options.name,
    description: options.description,
    watchFor: options.watchFor,
    units: 'natural',
    // A step this small is affordable at three bodies and keeps the orbit
    // closing over many periods rather than drifting apart after a few.
    dt: options.dt ?? 1e-4,
    integrator: options.integrator ?? 'yoshida4',
    forceModel: 'direct',
    softening: 0,
    timeScale: Math.max(1, options.period / 8),
    suggestedDuration: options.period * 3,
    tags: ['three-body', 'periodic'],
    bodies: symmetricThreeBody(options.vx, options.vy),
    camera: { mode: '2d', distance: options.distance ?? 2.2 },
  });
}

/** Published period, exposed so the fixtures can integrate exactly one. */
export const THREE_BODY_PERIODS: Record<string, number> = {
  'butterfly-i': 6.235641,
  'moth-i': 14.893867,
  dragonfly: 21.270975,
  'yin-yang-i': 17.32838,
  goggles: 10.466681,
};

export const butterfly = family({
  id: 'butterfly-i',
  name: 'Butterfly',
  description:
    'Three equal masses tracing a pair of wings, one of the periodic three-body orbits found by Suvakov and Dmitrasinovic in 2013.',
  watchFor: 'Two lobes, traced over and over without ever drifting apart.',
  vx: 0.30689,
  vy: 0.12551,
  period: THREE_BODY_PERIODS['butterfly-i']!,
});

export const moth = family({
  id: 'moth-i',
  name: 'Moth',
  description: 'A periodic three-body orbit with a broad, looping figure that closes on itself.',
  watchFor: 'The path looks tangled, then repeats exactly.',
  vx: 0.46444,
  vy: 0.39606,
  period: THREE_BODY_PERIODS['moth-i']!,
  distance: 2.6,
});

/**
 * The one orbit here that needs the adaptive integrator.
 *
 * Measured, two of the bodies pass within 7.3e-3 of each other, against
 * typical separations near 1. At a fixed step of 1e-4 that encounter is
 * crossed in a handful of steps, the relative energy error reaches 1e-4, and
 * the orbit misses its own starting point by a tenth of the system's size.
 * Reducing the step to 1e-5 fixes it, at two million steps per period.
 *
 * The adaptive integrator closes the same orbit to 7e-4, which is the
 * precision of the published initial conditions, in 22,000 steps. Ten times
 * fewer steps and a hundred times more accurate, because it spends them where
 * they are needed.
 */
export const dragonfly = family({
  id: 'dragonfly',
  name: 'Dragonfly',
  description: 'A tall, narrow periodic three-body orbit with one very close approach in it.',
  watchFor: 'Two of them nearly collide each lap, then swing apart again.',
  vx: 0.08058,
  vy: 0.58884,
  period: THREE_BODY_PERIODS['dragonfly']!,
  distance: 3.4,
  integrator: 'dopri5',
  dt: 1e-3,
});

export const yinYang = family({
  id: 'yin-yang-i',
  name: 'Yin-Yang',
  description: 'A periodic three-body orbit whose two halves mirror each other.',
  watchFor: 'The curve folds back through itself and still closes.',
  vx: 0.51394,
  vy: 0.30474,
  period: THREE_BODY_PERIODS['yin-yang-i']!,
  distance: 2.4,
});

export const goggles = family({
  id: 'goggles',
  name: 'Goggles',
  description: 'A periodic three-body orbit of two linked loops.',
  watchFor: 'Two rings joined in the middle, drawn by all three bodies.',
  vx: 0.0833,
  vy: 0.12789,
  period: THREE_BODY_PERIODS['goggles']!,
  distance: 2.6,
});

/**
 * Lagrange's equilateral solution.
 *
 * Three equal masses at the corners of an equilateral triangle, rotating
 * rigidly. Found by Lagrange in 1772, and the only three-body solution here
 * with a derivation short enough to put in a comment.
 *
 * Each mass sits at r = a / sqrt(3) from the centre. The pull of the other two
 * resolves to sqrt(3) G m^2 / a^2 toward the centre, which must equal
 * m omega^2 r, giving omega^2 = 3 G m / a^3. With G = m = a = 1 that is
 * omega = sqrt(3), an orbital speed of exactly 1, and a period of 2 pi over
 * sqrt(3).
 *
 * The same configuration with one mass made negligible is where the Trojan
 * asteroids live.
 */
const LAGRANGE_SIDE = 1;
const LAGRANGE_OMEGA = Math.sqrt(3);
export const LAGRANGE_PERIOD = (2 * Math.PI) / LAGRANGE_OMEGA;

export const lagrangeTriangle = defineScenario({
  id: 'lagrange-triangle',
  name: 'Lagrange Triangle',
  description:
    'Three equal masses at the corners of an equilateral triangle, turning together without ever changing shape.',
  watchFor: 'The triangle rotates rigidly. The distances never change.',
  units: 'natural',
  dt: 1e-4,
  integrator: 'yoshida4',
  forceModel: 'direct',
  softening: 0,
  timeScale: 1,
  suggestedDuration: LAGRANGE_PERIOD * 6,
  tags: ['three-body', 'periodic', 'lagrange'],
  bodies: [0, 1, 2].map((index) => {
    const angle = (index * 2 * Math.PI) / 3;
    const r = LAGRANGE_SIDE / Math.sqrt(3);
    const speed = LAGRANGE_OMEGA * r;
    return {
      name: `Mass ${index + 1}`,
      mass: 1,
      radius: 0.05,
      position: [r * Math.cos(angle), r * Math.sin(angle), 0] as [number, number, number],
      velocity: [-speed * Math.sin(angle), speed * Math.cos(angle), 0] as [number, number, number],
      color: COLORS[index]!,
      trail: true,
    };
  }),
  camera: { mode: '2d', distance: 1.1 },
});

export const THREE_BODY_PRESETS: readonly Scenario[] = [
  butterfly,
  moth,
  dragonfly,
  yinYang,
  goggles,
  lagrangeTriangle,
];
