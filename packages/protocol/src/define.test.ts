import { describe, expect, it } from 'vitest';
import { cloneScenario, defineScenario, FALLBACK_PALETTE } from './define.ts';
import { DEFAULT_THETA, type Vec3 } from './scenario.ts';
import { G_SOLAR } from './units.ts';

describe('defineScenario', () => {
  it('fills G from the unit system', () => {
    const scenario = defineScenario({
      id: 's',
      name: 'S',
      description: '',
      units: 'solar',
      dt: 0.5,
      timeScale: 10,
      bodies: [{ name: 'Sun', mass: 1, position: [0, 0, 0], velocity: [0, 0, 0] }],
    });
    expect(scenario.G).toBe(G_SOLAR);
    expect(scenario.integrator).toBe('leapfrog');
    expect(scenario.forceModel).toBe('auto');
    expect(scenario.theta).toBe(DEFAULT_THETA);
    expect(scenario.softening).toBe(0);
    expect(scenario.collisions).toBe('none');
  });

  it('slugs ids from names and disambiguates collisions', () => {
    const scenario = defineScenario({
      id: 's',
      name: 'S',
      description: '',
      units: 'natural',
      dt: 1e-3,
      timeScale: 1,
      bodies: [
        { name: 'Star A', mass: 1, position: [0, 0, 0], velocity: [0, 0, 0] },
        { name: 'Star A', mass: 1, position: [1, 0, 0], velocity: [0, 1, 0] },
        { name: 'Star A', mass: 1, position: [2, 0, 0], velocity: [0, 1, 0] },
      ],
    });
    expect(scenario.bodies.map((b) => b.id)).toEqual(['star-a', 'star-a-2', 'star-a-3']);
  });

  it('assigns fallback colours in palette order', () => {
    const scenario = defineScenario({
      id: 's',
      name: 'S',
      description: '',
      units: 'natural',
      dt: 1e-3,
      timeScale: 1,
      bodies: [
        { name: 'A', mass: 1, position: [0, 0, 0], velocity: [0, 0, 0] },
        { name: 'B', mass: 1, position: [1, 0, 0], velocity: [0, 1, 0] },
      ],
    });
    expect(scenario.bodies[0]!.color).toBe(FALLBACK_PALETTE[0]);
    expect(scenario.bodies[1]!.color).toBe(FALLBACK_PALETTE[1]);
  });

  it('frames the camera to contain the system', () => {
    const scenario = defineScenario({
      id: 's',
      name: 'S',
      description: '',
      units: 'natural',
      dt: 1e-3,
      timeScale: 1,
      bodies: [
        { name: 'A', mass: 1, position: [0, 0, 0], velocity: [0, 0, 0] },
        { name: 'B', mass: 1, position: [10, 0, 0], velocity: [0, 0.3, 0] },
      ],
    });
    expect(scenario.camera!.mode).toBe('2d');
    expect(scenario.camera!.distance).toBeCloseTo(14, 10);
  });

  it('gives a single body at the origin a usable camera distance', () => {
    const scenario = defineScenario({
      id: 's',
      name: 'S',
      description: '',
      units: 'natural',
      dt: 1e-3,
      timeScale: 1,
      bodies: [{ name: 'A', mass: 1, position: [0, 0, 0], velocity: [0, 0, 0] }],
    });
    expect(scenario.camera!.distance).toBeGreaterThan(0);
  });

  it('throws immediately on an invalid preset rather than failing at runtime', () => {
    expect(() =>
      defineScenario({
        id: 's',
        name: 'S',
        description: '',
        units: 'natural',
        dt: 0,
        timeScale: 1,
        bodies: [{ name: 'A', mass: 1, position: [0, 0, 0], velocity: [0, 0, 0] }],
      }),
    ).toThrow();
  });

  it('derives a display radius from mass when none is given', () => {
    const scenario = defineScenario({
      id: 's',
      name: 'S',
      description: '',
      units: 'solar',
      dt: 1,
      timeScale: 1,
      bodies: [{ name: 'Sun', mass: 1, position: [0, 0, 0], velocity: [0, 0, 0] }],
    });
    // One solar mass comes out as one solar radius in AU.
    expect(scenario.bodies[0]!.radius).toBeCloseTo(0.004650467, 9);
  });
});

/**
 * Writes into a readonly tuple on purpose.
 *
 * Vec3 is readonly so that nothing mutates simulation input by accident, which
 * is exactly the guarantee being tested here: the only way to prove the clone
 * does not share its tuples is to try to write through one.
 */
function poke(vec: Vec3, index: number, value: number): void {
  (vec as unknown as number[])[index] = value;
}

describe('cloneScenario', () => {
  it('produces a fully independent copy', () => {
    const original = defineScenario({
      id: 's',
      name: 'S',
      description: '',
      units: 'natural',
      dt: 1e-3,
      timeScale: 1,
      tags: ['a'],
      bodies: [{ name: 'A', mass: 1, position: [1, 2, 3], velocity: [4, 5, 6] }],
    });
    const copy = cloneScenario(original);

    copy.bodies[0]!.mass = 99;
    poke(copy.bodies[0]!.position, 0, 99);
    copy.tags.push('b');
    poke(copy.camera!.target, 0, 99);

    expect(original.bodies[0]!.mass).toBe(1);
    expect(original.bodies[0]!.position[0]).toBe(1);
    expect(original.tags).toEqual(['a']);
    expect(original.camera!.target[0]).toBe(0);
  });
});
