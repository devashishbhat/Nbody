import { z } from 'zod';
import { MAX_BODIES } from './scenario.ts';
import type { Scenario, Vec3 } from './scenario.ts';

/**
 * Runtime validation.
 *
 * Two places need this and both are untrusted: a scenario decoded from a
 * share link, and a preset file written by hand. A silently malformed preset
 * shows up as a blank screen or a NaN cascade, which is expensive to debug, so
 * every preset is validated in the test suite.
 */

const finite = z.number().refine(Number.isFinite, { message: 'must be finite' });
const nonNegative = finite.refine((v) => v >= 0, { message: 'must be >= 0' });

const vec3 = z.tuple([finite, finite, finite]);

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'must be a #rrggbb colour' });

export const BodySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  // 0 is legal: massless test particles are how restricted problems and
  // asteroid belts are represented.
  mass: nonNegative,
  radius: nonNegative,
  position: vec3,
  velocity: vec3,
  color: hexColor,
  locked: z.boolean().optional(),
  trail: z.boolean().optional(),
});

export const CameraStateSchema = z.object({
  mode: z.enum(['2d', '3d']),
  target: vec3,
  distance: finite.refine((v) => v > 0, { message: 'must be > 0' }),
  azimuth: finite,
  elevation: finite,
  followBodyId: z.string().optional(),
});

export const ScenarioSchema = z
  .object({
    schema: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    watchFor: z.string().optional(),

    units: z.enum(['solar', 'si', 'natural']),
    G: finite,
    softening: nonNegative,

    integrator: z.enum(['leapfrog', 'yoshida4', 'dopri5']),
    dt: finite.refine((v) => v !== 0, { message: 'dt must not be 0' }),
    forceModel: z.enum(['direct', 'barnes-hut', 'auto']),
    theta: finite.refine((v) => v > 0 && v <= 2, { message: 'theta must be in (0, 2]' }),
    collisions: z.enum(['none', 'merge', 'bounce', 'realistic']),
    restitution: finite.refine((v) => v >= 0 && v <= 1, {
      message: 'restitution must be in [0, 1]',
    }),

    timeScale: finite.refine((v) => v > 0, { message: 'timeScale must be > 0' }),
    suggestedDuration: finite.optional(),

    bodies: z.array(BodySchema).min(1).max(MAX_BODIES),
    camera: CameraStateSchema.optional(),
    tags: z.array(z.string()),
  })
  .superRefine((scenario, ctx) => {
    const seen = new Set<string>();
    for (const body of scenario.bodies) {
      if (seen.has(body.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate body id "${body.id}"`,
          path: ['bodies'],
        });
      }
      seen.add(body.id);
    }

    const follow = scenario.camera?.followBodyId;
    if (follow !== undefined && !seen.has(follow)) {
      ctx.addIssue({
        code: 'custom',
        message: `camera.followBodyId "${follow}" is not a body in this scenario`,
        path: ['camera', 'followBodyId'],
      });
    }

    // A system with no mass anywhere has no dynamics, which is almost always a
    // typo rather than an intent.
    if (!scenario.bodies.some((b) => b.mass > 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'at least one body must have mass > 0',
        path: ['bodies'],
      });
    }
  });

export function parseScenario(value: unknown): Scenario {
  return ScenarioSchema.parse(value) as Scenario;
}

export function safeParseScenario(
  value: unknown,
): { ok: true; scenario: Scenario } | { ok: false; error: string } {
  const result = ScenarioSchema.safeParse(value);
  if (result.success) return { ok: true, scenario: result.data as Scenario };
  return { ok: false, error: z.prettifyError(result.error) };
}

/** A Vec3 that is guaranteed finite. Used by generators in Lane D. */
export function assertVec3(value: readonly number[]): Vec3 {
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new TypeError(`expected 3 finite numbers, got ${JSON.stringify(value)}`);
  }
  return [value[0], value[1], value[2]] as Vec3;
}
