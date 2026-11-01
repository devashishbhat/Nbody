import { describe, expect, it } from 'vitest';
import { approach } from './canvas2d.ts';

describe('critically damped approach', () => {
  it('moves toward the target without ever overshooting it', () => {
    // Overshoot is what makes a camera feel springy and imprecise. The
    // exponential form cannot overshoot for any dt, which is why it is used
    // instead of a mass-spring integration that can go unstable at low frame
    // rates.
    let value = 0;
    for (let i = 0; i < 200; i++) {
      value = approach(value, 10, 14, 1 / 60);
      expect(value).toBeLessThanOrEqual(10);
    }
    expect(value).toBeCloseTo(10, 6);
  });

  it('is stable at a very large time step', () => {
    expect(approach(0, 10, 14, 10)).toBeLessThanOrEqual(10);
    expect(approach(0, 10, 14, 10)).toBeGreaterThan(9.9);
  });

  it('is frame-rate independent to first order', () => {
    // Two half steps must land close to one full step, otherwise camera motion
    // would visibly change character with frame rate.
    const one = approach(0, 1, 14, 1 / 30);
    let two = approach(0, 1, 14, 1 / 60);
    two = approach(two, 1, 14, 1 / 60);
    expect(Math.abs(one - two)).toBeLessThan(1e-12);
  });
});
