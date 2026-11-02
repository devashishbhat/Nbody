import {
  parseScenario,
  safeParseScenario,
  type Body,
  type Scenario,
  type Vec3,
} from '@nbody/protocol';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

/**
 * Share links.
 *
 * A whole scenario compresses into the URL hash, which is what lets the site
 * be entirely static: sharing, permalinks, bookmarks and embedding all work
 * with no server, no database, no accounts and nothing to operate.
 *
 * Two forms:
 *
 *   #p=solar-system          an unmodified preset, by id
 *   #s=<base64url>           a scenario, compressed
 *
 * The preset form exists because it is short, readable, and survives a preset
 * being improved later. Any edit at all falls back to the full form.
 *
 * ## Why a compact intermediate shape
 *
 * Scenario JSON repeats nine property names per body. At a few hundred bodies
 * that is most of the payload and it compresses, but not as well as simply not
 * writing it. Bodies become positional arrays and settings become short keys,
 * which roughly halves the compressed size and directly extends how large a
 * scenario can still be shared as a link.
 *
 * Numbers keep full precision. Rounding coordinates to shorten a URL would
 * silently change the physics, and for the periodic families it would stop the
 * orbits closing.
 */

/** Bumped only if the compact shape changes incompatibly. */
const CODEC_VERSION = 1;

/**
 * Longest share payload worth producing.
 *
 * Measured, a body costs about 51 characters encoded, almost all of it
 * coordinate mantissas, which do not compress because they are close to
 * random. So this bound is roughly 600 bodies. Presets and anything
 * hand-edited are far below it; a procedurally generated cluster is far above,
 * and the UI offers a file download for those instead.
 *
 * Browsers handle longer URLs than this, but links get pasted into chat
 * clients, issue trackers and mail, which do not.
 */
export const MAX_SHARE_LENGTH = 32_000;

/** Roughly how many bodies still fit in a link. Derived from measurement. */
export const MAX_SHAREABLE_BODIES = 600;

const BODY_LOCKED = 1;
const BODY_TRAIL = 2;

type CompactBody = [
  id: string,
  name: string,
  mass: number,
  radius: number,
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  color: string,
  flags: number,
];

interface CompactScenario {
  v: number;
  id: string;
  n: string;
  d: string;
  w?: string;
  u: Scenario['units'];
  g: number;
  s: number;
  i: Scenario['integrator'];
  dt: number;
  f: Scenario['forceModel'];
  th: number;
  c: Scenario['collisions'];
  ts: number;
  sd?: number;
  t: string[];
  cam?: [
    mode: string,
    x: number,
    y: number,
    z: number,
    distance: number,
    azimuth: number,
    elevation: number,
    /** Body the camera follows. Empty string when it follows nothing. */
    followBodyId: string,
  ];
  b: CompactBody[];
}

function toCompact(scenario: Scenario): CompactScenario {
  const compact: CompactScenario = {
    v: CODEC_VERSION,
    id: scenario.id,
    n: scenario.name,
    d: scenario.description,
    u: scenario.units,
    g: scenario.G,
    s: scenario.softening,
    i: scenario.integrator,
    dt: scenario.dt,
    f: scenario.forceModel,
    th: scenario.theta,
    c: scenario.collisions,
    ts: scenario.timeScale,
    t: scenario.tags,
    b: scenario.bodies.map((body): CompactBody => {
      let flags = 0;
      if (body.locked) flags |= BODY_LOCKED;
      if (body.trail) flags |= BODY_TRAIL;
      return [
        body.id,
        body.name,
        body.mass,
        body.radius,
        body.position[0],
        body.position[1],
        body.position[2],
        body.velocity[0],
        body.velocity[1],
        body.velocity[2],
        body.color,
        flags,
      ];
    }),
  };
  if (scenario.watchFor !== undefined) compact.w = scenario.watchFor;
  if (scenario.suggestedDuration !== undefined) compact.sd = scenario.suggestedDuration;
  if (scenario.camera) {
    compact.cam = [
      scenario.camera.mode,
      scenario.camera.target[0],
      scenario.camera.target[1],
      scenario.camera.target[2],
      scenario.camera.distance,
      scenario.camera.azimuth,
      scenario.camera.elevation,
      scenario.camera.followBodyId ?? '',
    ];
  }
  return compact;
}

/** Rebuilds the full shape. Does not validate; callers do. */
function rebuild(compact: CompactScenario): Scenario {
  const bodies: Body[] = compact.b.map((entry) => {
    const body: Body = {
      id: entry[0],
      name: entry[1],
      mass: entry[2],
      radius: entry[3],
      position: [entry[4], entry[5], entry[6]] as Vec3,
      velocity: [entry[7], entry[8], entry[9]] as Vec3,
      color: entry[10],
    };
    if (entry[11] & BODY_LOCKED) body.locked = true;
    if (entry[11] & BODY_TRAIL) body.trail = true;
    return body;
  });

  const scenario: Scenario = {
    schema: 1,
    id: compact.id,
    name: compact.n,
    description: compact.d,
    units: compact.u,
    G: compact.g,
    softening: compact.s,
    integrator: compact.i,
    dt: compact.dt,
    forceModel: compact.f,
    theta: compact.th,
    collisions: compact.c,
    timeScale: compact.ts,
    tags: compact.t,
    bodies,
  };
  if (compact.w !== undefined) scenario.watchFor = compact.w;
  if (compact.sd !== undefined) scenario.suggestedDuration = compact.sd;
  if (compact.cam) {
    scenario.camera = {
      mode: compact.cam[0] === '3d' ? '3d' : '2d',
      target: [compact.cam[1], compact.cam[2], compact.cam[3]] as Vec3,
      distance: compact.cam[4],
      azimuth: compact.cam[5],
      elevation: compact.cam[6],
    };
    // Absent and empty mean the same thing, and only one of them is
    // representable in a positional array.
    if (compact.cam[7]) scenario.camera.followBodyId = compact.cam[7];
  }

  return scenario;
}

/** base64url, so the result is safe in a hash with no escaping. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // Chunked, because spreading a large array into String.fromCharCode
  // overflows the call stack somewhere above a hundred thousand elements.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Compresses a scenario into the value that goes after `#s=`. */
export function encodeScenario(scenario: Scenario): string {
  const json = JSON.stringify(toCompact(scenario));
  return toBase64Url(deflateSync(strToU8(json), { level: 9 }));
}

export function decodeScenario(encoded: string): Scenario {
  const json = strFromU8(inflateSync(fromBase64Url(encoded)));
  const compact = JSON.parse(json) as CompactScenario;
  if (compact.v !== CODEC_VERSION) {
    throw new Error(`unsupported share link version ${compact.v}`);
  }
  // Validated rather than trusted: this came out of a URL.
  return parseScenario(rebuild(compact));
}

export type ShareTarget = { kind: 'preset'; id: string } | { kind: 'scenario'; scenario: Scenario };

/**
 * Reads a location hash.
 *
 * Returns null for an absent or unrecognised hash rather than throwing, so a
 * stray fragment never stops the app loading. A malformed `#s=` does throw,
 * because silently ignoring a share link someone was given is worse than
 * telling them it is broken.
 */
export function parseHash(hash: string): ShareTarget | null {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  if (value.length === 0) return null;

  const parameters = new URLSearchParams(value);

  const preset = parameters.get('p');
  if (preset) return { kind: 'preset', id: preset };

  const encoded = parameters.get('s');
  if (encoded) return { kind: 'scenario', scenario: decodeScenario(encoded) };

  return null;
}

/** The hash for a scenario, preferring the short preset form when it applies. */
export function buildHash(scenario: Scenario, unmodifiedPresetId?: string): string {
  if (unmodifiedPresetId) return `#p=${encodeURIComponent(unmodifiedPresetId)}`;
  return `#s=${encodeScenario(scenario)}`;
}

/** Whether a scenario still matches the preset it came from, field for field. */
export function matchesPreset(scenario: Scenario, preset: Scenario): boolean {
  return JSON.stringify(toCompact(scenario)) === JSON.stringify(toCompact(preset));
}

/** True when a scenario is too large to be worth putting in a link. */
export function tooLargeToShare(scenario: Scenario): boolean {
  return encodeScenario(scenario).length > MAX_SHARE_LENGTH;
}

/**
 * Decodes without throwing, for friendlier errors.
 *
 * A share link is the one input that arrives from a stranger, so every failure
 * mode wants a message rather than a stack trace: bad base64, corrupt deflate
 * stream, wrong version, and a well-formed payload that is not a valid
 * scenario are all different problems.
 */
export function safeDecodeScenario(
  encoded: string,
): { ok: true; scenario: Scenario } | { ok: false; error: string } {
  let compact: CompactScenario;
  try {
    compact = JSON.parse(strFromU8(inflateSync(fromBase64Url(encoded)))) as CompactScenario;
  } catch {
    return { ok: false, error: 'this share link is damaged and could not be read' };
  }

  if (compact.v !== CODEC_VERSION) {
    return { ok: false, error: `this share link uses format version ${compact.v}` };
  }

  try {
    return safeParseScenario(rebuild(compact));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'the share link could not be read',
    };
  }
}
