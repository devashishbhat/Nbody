/**
 * Regenerates the solar system ephemeris.
 *
 *   pnpm --filter @nbody/tool-horizons fetch
 *
 * Writes `packages/scenarios/src/data/solar-system.json`. That file is the
 * runtime source of truth: the app never calls an external API, so a Horizons
 * outage or a rate limit can never affect a visitor.
 *
 * Query shape, verified against a live response rather than assumed:
 *
 *   EPHEM_TYPE=VECTORS, VEC_TABLE=2, CSV_FORMAT=YES
 *   OUT_UNITS=AU-D, REF_PLANE=ECLIPTIC, REF_SYSTEM=J2000
 *   CENTER=500@0  (solar system barycentre)
 *
 * The CSV columns between the $$SOE and $$EOE markers are:
 *
 *   JDTDB, Calendar Date (TDB), X, Y, Z, VX, VY, VZ
 *
 * with positions in AU and velocities in AU/day.
 *
 * Centred on the SOLAR SYSTEM BARYCENTRE, not the Sun. Heliocentric vectors
 * put the Sun at rest at the origin, which hands the whole system a net
 * momentum and makes it drift off screen over a long run. Barycentric vectors
 * come out with the centre of mass already very nearly at rest.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOLAR_SYSTEM, type BodyData } from './bodies.ts';

const HORIZONS = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/** Epoch for the shipped data. TDB. */
const EPOCH = '2026-01-01';

export interface StateVector {
  name: string;
  jdtdb: number;
  position: [number, number, number];
  velocity: [number, number, number];
}

function query(command: string): string {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: `'${command}'`,
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@0'",
    START_TIME: `'${EPOCH}'`,
    STOP_TIME: `'2026-01-02'`,
    STEP_SIZE: "'1 d'",
    OUT_UNITS: "'AU-D'",
    REF_PLANE: "'ECLIPTIC'",
    REF_SYSTEM: "'J2000'",
    VEC_TABLE: "'2'",
    CSV_FORMAT: "'YES'",
  });
  return `${HORIZONS}?${params.toString()}`;
}

/** Pulls the first data row out of a Horizons text response. */
export function parseVectors(body: BodyData, text: string): StateVector {
  const start = text.indexOf('$$SOE');
  const end = text.indexOf('$$EOE');
  if (start < 0 || end < 0) {
    throw new Error(`${body.name}: no ephemeris block in response`);
  }

  const rows = text
    .slice(start + 5, end)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const first = rows[0];
  if (!first) throw new Error(`${body.name}: ephemeris block was empty`);

  const fields = first.split(',').map((field) => field.trim());
  // JDTDB, Calendar Date, X, Y, Z, VX, VY, VZ
  if (fields.length < 8) {
    throw new Error(`${body.name}: expected 8 CSV fields, got ${fields.length}`);
  }

  const numbers = [2, 3, 4, 5, 6, 7].map((index) => {
    const value = Number(fields[index]);
    if (!Number.isFinite(value)) {
      throw new Error(`${body.name}: field ${index} was not a number: ${fields[index]}`);
    }
    return value;
  });

  return {
    name: body.name,
    jdtdb: Number(fields[0]),
    position: [numbers[0]!, numbers[1]!, numbers[2]!],
    velocity: [numbers[3]!, numbers[4]!, numbers[5]!],
  };
}

async function fetchBody(body: BodyData): Promise<StateVector> {
  const response = await fetch(query(body.command));
  if (!response.ok) {
    throw new Error(`${body.name}: Horizons returned ${response.status}`);
  }
  return parseVectors(body, await response.text());
}

async function main(): Promise<void> {
  const vectors: StateVector[] = [];
  for (const body of SOLAR_SYSTEM) {
    // Serial and deliberately unhurried. This runs by hand, perhaps once a
    // year, and Horizons is a shared public service.
    process.stdout.write(`fetching ${body.name}... `);
    const vector = await fetchBody(body);
    vectors.push(vector);
    process.stdout.write('ok\n');
  }

  const epochs = new Set(vectors.map((v) => v.jdtdb));
  if (epochs.size !== 1) {
    throw new Error(`bodies came back at different epochs: ${[...epochs].join(', ')}`);
  }

  const bodies = SOLAR_SYSTEM.map((body, index) => {
    const vector = vectors[index]!;
    return {
      name: body.name,
      mass: body.mass,
      radius: body.radius,
      position: vector.position,
      velocity: vector.velocity,
      color: body.color,
    };
  });

  const output = {
    source: 'JPL Horizons',
    center: 'solar system barycentre (500@0)',
    frame: 'ecliptic of J2000',
    units: 'AU, days, solar masses',
    epoch: EPOCH,
    jdtdb: vectors[0]!.jdtdb,
    generatedBy: 'tools/horizons',
    bodies,
  };

  const here = dirname(fileURLToPath(import.meta.url));
  const target = resolve(here, '../../../packages/scenarios/src/data/solar-system.json');
  await writeFile(target, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nwrote ${target}\n`);

  // Report the residual centre-of-mass motion. Barycentric input should leave
  // this tiny; a large value means the mass table and the Horizons targets
  // have drifted out of agreement.
  const totalMass = bodies.reduce((sum, b) => sum + b.mass, 0);
  const momentum = [0, 1, 2].map((axis) =>
    bodies.reduce((sum, b) => sum + b.mass * b.velocity[axis]!, 0),
  );
  const speed = Math.hypot(...momentum.map((p) => p / totalMass));
  process.stdout.write(`centre-of-mass speed: ${speed.toExponential(3)} AU/day\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
