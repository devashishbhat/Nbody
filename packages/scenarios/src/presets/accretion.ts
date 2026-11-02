import { defineScenario, type BodyInput, type Scenario } from '@nbody/protocol';
import { makeRandom } from '../generate.ts';

/**
 * Planet formation, by accretion.
 *
 * A ring of three hundred planetesimals around a star, with contact resolved
 * realistically: a pair closing slower than its mutual escape velocity cannot
 * separate again, so it accretes, and a pair arriving faster scatters.
 *
 * Left running, the count falls and the survivors grow. That is not a trick of
 * the preset, it is the mechanism: the solar system was assembled this way,
 * from a disc of bodies on nearly circular orbits whose slight differences in
 * radius made them drift past one another slowly enough to stick.
 *
 * ## Why these numbers
 *
 * The three parameters that decide whether anything happens at all are the
 * body radius, the mass, and the velocity dispersion, and they have to be set
 * against each other.
 *
 * The radius has to be large enough that bodies actually meet. At true
 * planetesimal scale, a disc this wide would take millions of orbits to
 * produce a single contact, which is accurate and unwatchable. These are
 * drawn and collided at a thousand times life size, which is the one
 * deliberate exaggeration here.
 *
 * The mass sets the escape velocity, sqrt(2 G (m1 + m2) / (r1 + r2)), which
 * for this pairing is about 0.22. The velocity dispersion has to sit below
 * that or encounters scatter instead of sticking, and well below the orbital
 * speed of 0.8 or the ring is not a ring. A few per cent of circular velocity
 * puts it comfortably between the two, which is also roughly where a real
 * protoplanetary disc sits.
 */

const COUNT = 300;
const INNER = 1.15;
const OUTER = 2.1;
const STAR_MASS = 1;
const BODY_MASS = 3e-4;
const BODY_RADIUS = 0.012;

/** Fraction of circular speed added as random dispersion. */
const DISPERSION = 0.03;

function planetesimals(): BodyInput[] {
  const random = makeRandom(880317);
  const bodies: BodyInput[] = [
    {
      name: 'Star',
      mass: STAR_MASS,
      radius: 0.05,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      color: '#ffd277',
    },
  ];

  for (let i = 0; i < COUNT; i++) {
    // Uniform in area, so the disc has even surface density rather than
    // crowding the inner edge.
    const r = Math.sqrt(INNER * INNER + random() * (OUTER * OUTER - INNER * INNER));
    const angle = random() * Math.PI * 2;
    const circular = Math.sqrt(STAR_MASS / r);

    bodies.push({
      name: `pl-${i}`,
      mass: BODY_MASS,
      radius: BODY_RADIUS,
      position: [r * Math.cos(angle), r * Math.sin(angle), (random() - 0.5) * 0.01],
      velocity: [
        -circular * Math.sin(angle) + (random() - 0.5) * circular * DISPERSION,
        circular * Math.cos(angle) + (random() - 0.5) * circular * DISPERSION,
        (random() - 0.5) * circular * DISPERSION * 0.2,
      ],
      color: '#c3b49a',
    });
  }

  return bodies;
}

export const accretionDisk: Scenario = defineScenario({
  id: 'accretion',
  name: 'Planet Formation',
  description:
    'Three hundred planetesimals orbiting a star, sticking together when they meet slowly enough.',
  watchFor:
    'The body count falls as they merge, and a few survivors grow large enough to sweep their own lanes clear.',
  units: 'natural',
  dt: 2e-3,
  integrator: 'leapfrog',
  forceModel: 'direct',
  // Just under the body radius, so a near miss is smoothed rather than
  // producing a slingshot the contact test never gets to see.
  softening: 0.01,
  collisions: 'realistic',
  // Rock on rock. Only matters for the encounters too fast to stick.
  restitution: 0.25,
  timeScale: 1.5,
  suggestedDuration: 400,
  tags: ['accretion', 'collisions', 'collective'],
  bodies: planetesimals(),
  camera: { mode: '2d', distance: 2.6 },
});
