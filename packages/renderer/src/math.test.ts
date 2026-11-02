import { describe, expect, it } from 'vitest';
import {
  angleDelta,
  approach,
  identity,
  invert,
  lookAt,
  mat4,
  multiply,
  orthographic,
  perspective,
  transformPoint,
} from './math.ts';

const out = new Float64Array(4);

/**
 * Tolerances here are f32-sized on purpose.
 *
 * The matrices are Float32Array because that is what WebGL takes, so results
 * carry about 1e-7 of relative error. Asserting to twelve places would be
 * asserting something the storage cannot represent.
 */
describe('projections', () => {
  it('maps the orthographic half-height to the top of the clip volume', () => {
    const projection = orthographic(mat4(), 10, 2, -100, 100);
    transformPoint(out, projection, 0, 10, 0);
    expect(out[1] / out[3]).toBeCloseTo(1, 6);
    // Aspect 2 means the horizontal half-extent is twice the vertical.
    transformPoint(out, projection, 20, 0, 0);
    expect(out[0] / out[3]).toBeCloseTo(1, 6);
  });

  it('gives perspective a w equal to the eye distance', () => {
    // The body shader relies on this: pixelsPerWorld is derived from clip.w,
    // and the same formula has to work for both projections.
    const projection = perspective(mat4(), Math.PI / 3, 1, 0.1, 1000);
    transformPoint(out, projection, 0, 0, -25);
    expect(out[3]).toBeCloseTo(25, 5);
  });

  it('gives orthographic a w of one', () => {
    const projection = orthographic(mat4(), 10, 1, -100, 100);
    transformPoint(out, projection, 3, 4, -7);
    expect(out[3]).toBeCloseTo(1, 6);
  });
});

describe('lookAt', () => {
  it('puts the target at the origin of eye space', () => {
    const view = lookAt(mat4(), 0, 0, 10, 0, 0, 0, 0, 1, 0);
    transformPoint(out, view, 0, 0, 0);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(0, 6);
    expect(out[2]).toBeCloseTo(-10, 5);
  });

  it('returns identity rather than NaN when the eye sits on the target', () => {
    // Reachable: a camera following a body it is also centred on.
    const view = lookAt(mat4(), 1, 2, 3, 1, 2, 3, 0, 0, 1);
    expect([...view].every(Number.isFinite)).toBe(true);
  });

  it('survives looking straight along the up axis', () => {
    // This is the 2D camera's exact configuration in 3D terms, so a
    // degenerate cross product here would break the default view.
    const view = lookAt(mat4(), 0, 0, 10, 0, 0, 0, 0, 0, 1);
    expect([...view].every(Number.isFinite)).toBe(true);
  });
});

describe('matrix algebra', () => {
  it('leaves a matrix unchanged when multiplied by identity', () => {
    const m = perspective(mat4(), 1, 1.5, 0.1, 100);
    const result = multiply(mat4(), identity(mat4()), m);
    for (let i = 0; i < 16; i++) expect(result[i]).toBeCloseTo(m[i]!, 6);
  });

  it('inverts a view-projection back to identity', () => {
    const viewProjection = multiply(
      mat4(),
      perspective(mat4(), Math.PI / 4, 1.6, 0.5, 500),
      lookAt(mat4(), 4, -3, 9, 0, 0, 0, 0, 0, 1),
    );
    const inverse = invert(mat4(), viewProjection);
    expect(inverse).not.toBeNull();

    const product = multiply(mat4(), viewProjection, inverse!);
    const expected = identity(mat4());
    for (let i = 0; i < 16; i++) expect(product[i]).toBeCloseTo(expected[i]!, 4);
  });

  it('reports a singular matrix instead of producing infinities', () => {
    const singular = mat4();
    expect(invert(mat4(), singular)).toBeNull();
  });
});

describe('damped approach', () => {
  it('never overshoots, at any time step', () => {
    // The property a mass-spring integration cannot guarantee, and the reason
    // the camera uses this form.
    for (const dt of [1 / 240, 1 / 60, 1 / 10, 1, 10]) {
      expect(approach(0, 10, 14, dt)).toBeLessThanOrEqual(10);
      expect(approach(10, 0, 14, dt)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is frame-rate independent', () => {
    const once = approach(0, 1, 14, 1 / 30);
    let twice = approach(0, 1, 14, 1 / 60);
    twice = approach(twice, 1, 14, 1 / 60);
    expect(Math.abs(once - twice)).toBeLessThan(1e-12);
  });

  it('converges', () => {
    let value = 0;
    for (let i = 0; i < 300; i++) value = approach(value, 5, 14, 1 / 60);
    expect(value).toBeCloseTo(5, 8);
  });
});

describe('angleDelta', () => {
  it('takes the short way round the seam', () => {
    // Without this the camera spins almost all the way round when an orbit
    // drag crosses pi.
    expect(angleDelta(3.1, -3.1)).toBeCloseTo(0.0831853, 5);
    expect(angleDelta(-3.1, 3.1)).toBeCloseTo(-0.0831853, 5);
  });

  it('is the plain difference away from the seam', () => {
    expect(angleDelta(0.2, 0.5)).toBeCloseTo(0.3, 12);
  });
});
