import type { BodyInput } from '@nbody/protocol';

/**
 * Procedural body generators.
 *
 * Everything here is deterministic. A preset that reshuffled itself on every
 * load could not be shared, could not be regression tested, and would make
 * "the same simulation" an unanswerable question. The seed is part of the
 * preset.
 */

/**
 * Small deterministic generator.
 *
 * `Math.random` cannot be seeded, and nothing here needs cryptographic
 * quality: it needs to produce the same cluster on every machine, every time.
 */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32. Fast, seedable, and far better distributed than the linear
    // congruential generator it replaced, which left visible structure in the
    // sphere sampling.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/** A direction uniformly distributed over the sphere. */
function randomDirection(random: () => number): [number, number, number] {
  // Sampling the cosine of the polar angle rather than the angle itself, or
  // the points bunch at the poles.
  const cosTheta = 2 * random() - 1;
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = random() * Math.PI * 2;
  return [sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), cosTheta];
}

export interface PlummerOptions {
  count: number;
  /** Total mass, shared equally. */
  totalMass: number;
  /** Plummer scale radius. Most of the mass sits inside it. */
  scaleRadius: number;
  seed: number;
  /** 1 gives a cluster in virial equilibrium; below 1 it collapses. */
  virial?: number;
  color?: string;
  centre?: [number, number, number];
  drift?: [number, number, number];
}

/**
 * A Plummer sphere.
 *
 * The standard model of a star cluster: a smooth, finite-density, infinitely
 * extended sphere whose mass profile has a closed-form inverse, which is why
 * positions can be sampled exactly rather than by rejection.
 *
 * Velocities are drawn from the exact distribution function by von Neumann
 * rejection on the usual q^2 (1 - q^2)^{7/2} envelope, so the cluster is born
 * in equilibrium and does not visibly settle in the first few crossing times.
 * Scaling them by `virial` below 1 produces a cluster that collapses, which is
 * the cold-collapse preset.
 */
export function plummerSphere(options: PlummerOptions): BodyInput[] {
  const {
    count,
    totalMass,
    scaleRadius,
    seed,
    virial = 1,
    color = '#9fb4d8',
    centre = [0, 0, 0],
    drift = [0, 0, 0],
  } = options;

  const random = makeRandom(seed);
  const bodyMass = totalMass / count;
  // Display radius only. Real stars at cluster scale are far below a pixel.
  const radius = scaleRadius * 0.004;
  const bodies: BodyInput[] = [];

  for (let i = 0; i < count; i++) {
    // Inverting the cumulative mass profile. The cut keeps the sampled radius
    // finite: a Plummer sphere formally extends forever, and the outermost
    // fraction of a per cent would otherwise place a few stars absurdly far
    // out and ruin the framing.
    const massFraction = random() * 0.999;
    const r = scaleRadius / Math.sqrt(Math.pow(massFraction, -2 / 3) - 1);

    const direction = randomDirection(random);

    // Velocity magnitude from the distribution function, by rejection.
    let q = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = random();
      const envelope = 0.1 * random();
      if (envelope < candidate * candidate * Math.pow(1 - candidate * candidate, 3.5)) {
        q = candidate;
        break;
      }
    }

    const escapeSpeed = Math.sqrt(2) * Math.pow(1 + (r * r) / (scaleRadius * scaleRadius), -0.25);
    const speed = q * escapeSpeed * Math.sqrt(totalMass / scaleRadius) * virial;
    const velocityDirection = randomDirection(random);

    bodies.push({
      name: `star-${i}`,
      mass: bodyMass,
      radius,
      position: [
        centre[0] + direction[0] * r,
        centre[1] + direction[1] * r,
        centre[2] + direction[2] * r,
      ],
      velocity: [
        drift[0] + velocityDirection[0] * speed,
        drift[1] + velocityDirection[1] * speed,
        drift[2] + velocityDirection[2] * speed,
      ],
      color,
    });
  }

  return bodies;
}

export interface DiskOptions {
  count: number;
  /** Mass of the central body. */
  centralMass: number;
  /** Combined mass of the disk, shared equally among its particles. */
  diskMass: number;
  innerRadius: number;
  outerRadius: number;
  seed: number;
  /** Vertical thickness, as a fraction of the outer radius. */
  thickness?: number;
  /** -1 reverses the sense of rotation. */
  spin?: number;
  centre?: [number, number, number];
  drift?: [number, number, number];
  /** Tilts the disk about the x axis, in radians. */
  tilt?: number;
  color?: string;
  centralColor?: string;
  centralName?: string;
  centralRadius?: number;
}

/**
 * A rotating disk around a central mass.
 *
 * Each particle is put on a circular orbit for the mass enclosed within its
 * radius, including the disk's own contribution, so the disk starts in
 * rotational balance rather than falling inward and re-forming.
 *
 * Returns the central body first.
 */
export function disk(options: DiskOptions): BodyInput[] {
  const {
    count,
    centralMass,
    diskMass,
    innerRadius,
    outerRadius,
    seed,
    thickness = 0.02,
    spin = 1,
    centre = [0, 0, 0],
    drift = [0, 0, 0],
    tilt = 0,
    color = '#8fb8e8',
    centralColor = '#ffd9a0',
    centralName = 'Core',
    centralRadius,
  } = options;

  const random = makeRandom(seed);
  const particleMass = diskMass / count;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);

  const bodies: BodyInput[] = [
    {
      name: centralName,
      mass: centralMass,
      radius: centralRadius ?? outerRadius * 0.03,
      position: [...centre] as [number, number, number],
      velocity: [...drift] as [number, number, number],
      color: centralColor,
      trail: false,
    },
  ];

  for (let i = 0; i < count; i++) {
    // Uniform in area rather than in radius, so the disk has even surface
    // density instead of crowding the centre.
    const r = Math.sqrt(
      innerRadius * innerRadius +
        random() * (outerRadius * outerRadius - innerRadius * innerRadius),
    );
    const angle = random() * Math.PI * 2;
    const height = (random() - 0.5) * thickness * outerRadius;

    // Enclosed mass, assuming the uniform surface density the sampling above
    // produces. Without the disk's own share the outer particles orbit too
    // slowly and the disk winds up.
    const enclosedFraction =
      (r * r - innerRadius * innerRadius) / (outerRadius * outerRadius - innerRadius * innerRadius);
    const enclosed = centralMass + diskMass * Math.max(0, enclosedFraction);
    const speed = Math.sqrt(enclosed / r) * spin;

    const localX = r * Math.cos(angle);
    const localY = r * Math.sin(angle);
    const localZ = height;
    const localVx = -speed * Math.sin(angle);
    const localVy = speed * Math.cos(angle);

    bodies.push({
      name: `p${i}`,
      mass: particleMass,
      radius: outerRadius * 0.002,
      position: [
        centre[0] + localX,
        centre[1] + localY * cosTilt - localZ * sinTilt,
        centre[2] + localY * sinTilt + localZ * cosTilt,
      ],
      velocity: [drift[0] + localVx, drift[1] + localVy * cosTilt, drift[2] + localVy * sinTilt],
      color,
    });
  }

  return bodies;
}

export interface RingOptions {
  count: number;
  centralMass: number;
  radius: number;
  /** Mass of each ring member. 0 makes them test particles. */
  mass?: number;
  seed: number;
  spread?: number;
  color?: string;
}

/** A thin ring of near-massless particles on circular orbits. */
export function ring(options: RingOptions): BodyInput[] {
  const { count, centralMass, radius, mass = 0, seed, spread = 0.1, color = '#8d8d96' } = options;
  const random = makeRandom(seed);

  return Array.from({ length: count }, (_, i) => {
    const r = radius * (1 + (random() - 0.5) * spread);
    const angle = random() * Math.PI * 2;
    const speed = Math.sqrt(centralMass / r);
    return {
      name: `rock-${i}`,
      mass,
      radius: radius * 0.0015,
      position: [r * Math.cos(angle), r * Math.sin(angle), (random() - 0.5) * radius * 0.01] as [
        number,
        number,
        number,
      ],
      velocity: [-speed * Math.sin(angle), speed * Math.cos(angle), 0] as [number, number, number],
      color,
    };
  });
}

/**
 * Removes any net momentum.
 *
 * A randomly sampled cluster has a small residual drift, which over a long run
 * carries the whole system off screen. Subtracting the centre-of-mass velocity
 * costs nothing and is what makes these presets watchable.
 */
export function removeDrift(bodies: BodyInput[]): BodyInput[] {
  let totalMass = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (const body of bodies) {
    totalMass += body.mass;
    px += body.mass * body.velocity[0];
    py += body.mass * body.velocity[1];
    pz += body.mass * body.velocity[2];
  }
  if (totalMass === 0) return bodies;

  const vx = px / totalMass;
  const vy = py / totalMass;
  const vz = pz / totalMass;

  return bodies.map((body) => ({
    ...body,
    velocity: [body.velocity[0] - vx, body.velocity[1] - vy, body.velocity[2] - vz] as [
      number,
      number,
      number,
    ],
  }));
}
