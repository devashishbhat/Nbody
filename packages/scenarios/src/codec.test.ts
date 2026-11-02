import { defineScenario, type Scenario } from '@nbody/protocol';
import { describe, expect, it } from 'vitest';
import {
  buildHash,
  decodeScenario,
  MAX_SHAREABLE_BODIES,
  encodeScenario,
  matchesPreset,
  parseHash,
  safeDecodeScenario,
  tooLargeToShare,
} from './codec.ts';
import { figureEight, presets, solarSystem } from './index.ts';

describe('share link round trip', () => {
  it.each(presets.map((p) => [p.id, p] as const))('round-trips %s losslessly', (_id, scenario) => {
    // Lossless matters more here than anywhere else: a share link that rounds
    // coordinates would silently change the physics, and for the periodic
    // families it would stop the orbits closing.
    const decoded = decodeScenario(encodeScenario(scenario));
    expect(decoded).toEqual(scenario);
  });

  it('preserves full floating point precision', () => {
    const scenario = decodeScenario(encodeScenario(figureEight));
    expect(scenario.bodies[0]!.position[0]).toBe(0.97000436);
    expect(scenario.bodies[2]!.velocity[1]).toBe(figureEight.bodies[2]!.velocity[1]);
  });

  it('preserves the lock and trail flags', () => {
    const scenario = defineScenario({
      id: 'flags',
      name: 'Flags',
      description: 'x',
      units: 'natural',
      dt: 1e-3,
      timeScale: 1,
      bodies: [
        { name: 'A', mass: 1, position: [0, 0, 0], velocity: [0, 0, 0], locked: true },
        { name: 'B', mass: 1, position: [1, 0, 0], velocity: [0, 1, 0], trail: true },
      ],
    });
    const decoded = decodeScenario(encodeScenario(scenario));
    expect(decoded.bodies[0]!.locked).toBe(true);
    expect(decoded.bodies[0]!.trail).toBeUndefined();
    expect(decoded.bodies[1]!.trail).toBe(true);
    expect(decoded.bodies[1]!.locked).toBeUndefined();
  });

  it('produces a URL-safe payload', () => {
    const encoded = encodeScenario(solarSystem);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('keeps the solar system comfortably inside a practical URL', () => {
    expect(encodeScenario(solarSystem).length).toBeLessThan(4000);
    expect(tooLargeToShare(solarSystem)).toBe(false);
  });
});

describe('hash parsing', () => {
  it('reads the short preset form', () => {
    expect(parseHash('#p=figure-eight')).toEqual({ kind: 'preset', id: 'figure-eight' });
  });

  it('reads the full scenario form', () => {
    const result = parseHash(buildHash(figureEight));
    expect(result?.kind).toBe('scenario');
    if (result?.kind === 'scenario') expect(result.scenario).toEqual(figureEight);
  });

  it('uses the short form only for an unmodified preset', () => {
    expect(buildHash(figureEight, 'figure-eight')).toBe('#p=figure-eight');
    expect(buildHash(figureEight)).toMatch(/^#s=/);
  });

  it('returns null for an absent or unrecognised hash', () => {
    expect(parseHash('')).toBeNull();
    expect(parseHash('#')).toBeNull();
    expect(parseHash('#something-else')).toBeNull();
  });
});

describe('matchesPreset', () => {
  it('recognises an untouched preset', () => {
    expect(matchesPreset(figureEight, figureEight)).toBe(true);
  });

  it('notices any edit', () => {
    const edited: Scenario = {
      ...figureEight,
      bodies: figureEight.bodies.map((b, i) => (i === 0 ? { ...b, mass: 1.5 } : b)),
    };
    expect(matchesPreset(edited, figureEight)).toBe(false);

    expect(matchesPreset({ ...figureEight, G: 1.0001 }, figureEight)).toBe(false);
    expect(matchesPreset({ ...figureEight, dt: 2e-4 }, figureEight)).toBe(false);
  });
});

describe('malformed links', () => {
  it('reports damaged base64 rather than throwing', () => {
    const result = safeDecodeScenario('!!!not-base64!!!');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/damaged/);
  });

  it('reports a corrupt compressed payload', () => {
    const result = safeDecodeScenario('AAAAAAAAAAAA');
    expect(result.ok).toBe(false);
  });

  it('reports a well-formed payload that is not a valid scenario', () => {
    // A link that decodes cleanly but describes something impossible, which is
    // a different fault from a damaged link and deserves a different message.
    const broken: Scenario = {
      ...figureEight,
      bodies: figureEight.bodies.map((b) => ({ ...b, mass: 0 })),
    };
    const result = safeDecodeScenario(encodeScenario(broken));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/mass/);
  });

  it('throws from the strict decoder so a bad link is never silently ignored', () => {
    expect(() => decodeScenario('!!!')).toThrow();
  });
});

describe('compression', () => {
  it('shrinks a large scenario to about a quarter of its JSON', () => {
    // The compact shape exists because scenario JSON repeats nine property
    // names per body, so the win grows with body count: measured at 27% for a
    // few hundred bodies against 53% for the nine-body solar system, where the
    // fixed header still dominates.
    const many = cloud(500);
    const raw = JSON.stringify(many).length;
    expect(encodeScenario(many).length).toBeLessThan(raw * 0.32);
  });

  it('keeps a preset-sized scenario tiny', () => {
    expect(encodeScenario(solarSystem).length).toBeLessThan(2000);
  });

  it('costs about fifty characters per body', () => {
    // Coordinate mantissas are close to random, so they do not compress. This
    // is what sets the practical limit on what a link can carry, and it is
    // worth pinning: a regression here would quietly shrink what can be
    // shared.
    const encoded = encodeScenario(cloud(500));
    expect(encoded.length / 500).toBeGreaterThan(40);
    expect(encoded.length / 500).toBeLessThan(65);
  });

  it('still round-trips at the edge of what a link can hold', () => {
    const many = cloud(MAX_SHAREABLE_BODIES);
    expect(tooLargeToShare(many)).toBe(false);
    expect(decodeScenario(encodeScenario(many)).bodies).toHaveLength(MAX_SHAREABLE_BODIES);
  });

  it('reports a procedurally sized scenario as too large to link', () => {
    // Not a failure. A few thousand bodies is beyond what any link should
    // carry, and the UI offers a file download instead.
    expect(tooLargeToShare(cloud(2000))).toBe(true);
  });
});

/** A deterministic scenario of `n` bodies, for the size measurements. */
function cloud(n: number): Scenario {
  return defineScenario({
    id: 'cloud',
    name: 'Cloud',
    description: 'x',
    units: 'natural',
    dt: 1e-3,
    timeScale: 1,
    bodies: Array.from({ length: n }, (_, i) => ({
      name: `b${i}`,
      mass: 1e-3,
      radius: 0.01,
      position: [Math.sin(i), Math.cos(i), i * 1e-3] as [number, number, number],
      velocity: [Math.cos(i) * 0.1, Math.sin(i) * 0.1, 0] as [number, number, number],
    })),
  });
}
