import { allocateFrame, BODY_STRIDE, FrameFlags, H } from '@nbody/protocol';
import { describe, expect, it, vi } from 'vitest';
import { FrameRing, hermite, hermiteDerivative } from './ring.ts';

interface FrameSpec {
  simTime: number;
  sequence: number;
  publishDt: number;
  flags?: number;
  bodies: { p: [number, number, number]; v: [number, number, number] }[];
}

function frame(spec: FrameSpec, capacity = 4): ArrayBuffer {
  const buffer = allocateFrame(capacity);
  const header = new Float64Array(buffer, 0, 16);
  header[H.simTime] = spec.simTime;
  header[H.sequence] = spec.sequence;
  header[H.publishDt] = spec.publishDt;
  header[H.bodyCount] = spec.bodies.length;
  header[H.flags] = spec.flags ?? 0;
  header[H.energy0] = -1;
  header[H.energy] = -1;

  const bodies = new Float64Array(buffer, 128, capacity * BODY_STRIDE);
  const handles = new Uint32Array(buffer, 128 + capacity * BODY_STRIDE * 8, capacity);
  spec.bodies.forEach((b, i) => {
    const s = i * BODY_STRIDE;
    bodies[s] = b.p[0];
    bodies[s + 1] = b.p[1];
    bodies[s + 2] = b.p[2];
    bodies[s + 3] = b.v[0];
    bodies[s + 4] = b.v[1];
    bodies[s + 5] = b.v[2];
    handles[i] = i + 1;
  });
  return buffer;
}

describe('cubic Hermite basis', () => {
  it('passes exactly through both endpoints', () => {
    expect(hermite(2, 5, 9, -3, 0.25, 0)).toBe(2);
    expect(hermite(2, 5, 9, -3, 0.25, 1)).toBe(9);
  });

  it('matches the endpoint velocities exactly', () => {
    // This is the property that makes motion continuous across a frame
    // boundary: the curve leaves one frame and enters the next at precisely
    // the velocity the physics reported.
    expect(hermiteDerivative(2, 5, 9, -3, 0.25, 0)).toBeCloseTo(5, 12);
    expect(hermiteDerivative(2, 5, 9, -3, 0.25, 1)).toBeCloseTo(-3, 12);
  });

  it('reproduces constant-velocity motion exactly', () => {
    const h = 0.5;
    const v = 3;
    for (const u of [0, 0.1, 0.5, 0.9, 1]) {
      expect(hermite(0, v, v * h, v, h, u)).toBeCloseTo(v * h * u, 12);
    }
  });

  it('tracks a circular orbit far more closely than linear interpolation', () => {
    // The practical reason velocities are carried in the frame at all. At a
    // publish interval this coarse, a linear blend visibly cuts the corner.
    const h = 0.25;
    let worstHermite = 0;
    let worstLinear = 0;
    for (let u = 0; u <= 1; u += 0.01) {
      const t = u * h;
      const exact = Math.cos(t);
      const p0 = Math.cos(0);
      const v0 = -Math.sin(0);
      const p1 = Math.cos(h);
      const v1 = -Math.sin(h);
      worstHermite = Math.max(worstHermite, Math.abs(hermite(p0, v0, p1, v1, h, u) - exact));
      worstLinear = Math.max(worstLinear, Math.abs(p0 + (p1 - p0) * u - exact));
    }
    expect(worstHermite).toBeLessThan(worstLinear / 100);
  });
});

describe('FrameRing', () => {
  it('returns null until a frame arrives', () => {
    const ring = new FrameRing(() => {});
    expect(ring.sample(0)).toBeNull();
  });

  it('emits a single frame unchanged', () => {
    const ring = new FrameRing(() => {});
    ring.push(
      frame({
        simTime: 1,
        sequence: 1,
        publishDt: 1 / 60,
        bodies: [{ p: [3, 4, 5], v: [1, 0, 0] }],
      }),
    );
    const sample = ring.sample(0)!;
    expect(sample.count).toBe(1);
    expect(sample.positions[0]).toBe(3);
    expect(sample.positions[1]).toBe(4);
    expect(sample.positions[2]).toBe(5);
  });

  it('interpolates strictly inside the span the held frames cover', () => {
    const ring = new FrameRing(() => {});
    ring.timeScale = 1;
    for (let i = 0; i < 3; i++) {
      ring.push(
        frame({
          simTime: i / 60,
          sequence: i + 1,
          publishDt: 1 / 60,
          bodies: [{ p: [i / 60, 0, 0], v: [1, 0, 0] }],
        }),
      );
    }

    let now = 0;
    for (let i = 0; i < 20; i++) {
      now += 16.7;
      const sample = ring.sample(now)!;
      // Never extrapolate past the newest frame, and never fall behind the
      // oldest one that is still held.
      expect(sample.simTime).toBeGreaterThanOrEqual(0);
      expect(sample.simTime).toBeLessThanOrEqual(2 / 60 + 1e-12);
    }
  });

  it('drops a frame that arrived out of order and gives its buffer back', () => {
    const recycle = vi.fn();
    const ring = new FrameRing(recycle);
    ring.push(
      frame({
        simTime: 1,
        sequence: 5,
        publishDt: 1 / 60,
        bodies: [{ p: [1, 0, 0], v: [0, 0, 0] }],
      }),
    );
    const stale = frame({
      simTime: 0.5,
      sequence: 3,
      publishDt: 1 / 60,
      bodies: [{ p: [9, 0, 0], v: [0, 0, 0] }],
    });

    ring.push(stale);

    expect(recycle).toHaveBeenCalledWith(stale);
    expect(ring.latest!.sequence).toBe(5);
  });

  it('recycles the oldest buffer once it is holding three frames', () => {
    const recycle = vi.fn();
    const ring = new FrameRing(recycle);
    const first = frame({
      simTime: 0,
      sequence: 1,
      publishDt: 1 / 60,
      bodies: [{ p: [0, 0, 0], v: [0, 0, 0] }],
    });
    ring.push(first);
    ring.push(
      frame({ simTime: 1, sequence: 2, publishDt: 1, bodies: [{ p: [1, 0, 0], v: [0, 0, 0] }] }),
    );
    ring.push(
      frame({ simTime: 2, sequence: 3, publishDt: 1, bodies: [{ p: [2, 0, 0], v: [0, 0, 0] }] }),
    );
    expect(recycle).not.toHaveBeenCalled();

    ring.push(
      frame({ simTime: 3, sequence: 4, publishDt: 1, bodies: [{ p: [3, 0, 0], v: [0, 0, 0] }] }),
    );
    expect(recycle).toHaveBeenCalledWith(first);
  });

  it('snaps rather than interpolating across a topology change', () => {
    // Interpolating between two different sets of bodies would smear a merged
    // body across the gap, so the ring collapses to the new frame and tells
    // consumers to rebuild their per-body state.
    const recycle = vi.fn();
    const ring = new FrameRing(recycle);
    ring.push(
      frame({
        simTime: 0,
        sequence: 1,
        publishDt: 1 / 60,
        bodies: [
          { p: [0, 0, 0], v: [0, 0, 0] },
          { p: [1, 0, 0], v: [0, 0, 0] },
        ],
      }),
    );
    ring.push(
      frame({
        simTime: 1 / 60,
        sequence: 2,
        publishDt: 1 / 60,
        bodies: [
          { p: [0, 0, 0], v: [0, 0, 0] },
          { p: [1, 0, 0], v: [0, 0, 0] },
        ],
      }),
    );
    const versionBefore = ring.topologyVersion;

    ring.push(
      frame({
        simTime: 2 / 60,
        sequence: 3,
        publishDt: 1 / 60,
        flags: FrameFlags.TopologyChanged,
        bodies: [{ p: [0.5, 0, 0], v: [0, 0, 0] }],
      }),
    );

    expect(ring.topologyVersion).toBeGreaterThan(versionBefore);
    const sample = ring.sample(0)!;
    expect(sample.count).toBe(1);
    expect(sample.positions[0]).toBe(0.5);
    // The two superseded buffers went back to the worker rather than leaking.
    expect(recycle).toHaveBeenCalledTimes(2);
  });

  it('returns the same sample object every call, so sampling allocates nothing', () => {
    const ring = new FrameRing(() => {});
    ring.push(
      frame({
        simTime: 0,
        sequence: 1,
        publishDt: 1 / 60,
        bodies: [{ p: [0, 0, 0], v: [1, 0, 0] }],
      }),
    );
    ring.push(
      frame({
        simTime: 1 / 60,
        sequence: 2,
        publishDt: 1 / 60,
        bodies: [{ p: [1 / 60, 0, 0], v: [1, 0, 0] }],
      }),
    );

    const a = ring.sample(16.7)!;
    const b = ring.sample(33.4)!;
    expect(b).toBe(a);
    expect(b.positions).toBe(a.positions);
    expect(b.handles).toBe(a.handles);
  });

  it('plays backwards when the worker reports a reversed publish', () => {
    const ring = new FrameRing(() => {});
    ring.timeScale = 1;
    ring.push(
      frame({
        simTime: 0,
        sequence: 1,
        publishDt: -1 / 60,
        flags: FrameFlags.Reversed,
        bodies: [{ p: [0, 0, 0], v: [-1, 0, 0] }],
      }),
    );
    ring.push(
      frame({
        simTime: -1 / 60,
        sequence: 2,
        publishDt: -1 / 60,
        flags: FrameFlags.Reversed,
        bodies: [{ p: [-1 / 60, 0, 0], v: [-1, 0, 0] }],
      }),
    );
    ring.push(
      frame({
        simTime: -2 / 60,
        sequence: 3,
        publishDt: -1 / 60,
        flags: FrameFlags.Reversed,
        bodies: [{ p: [-2 / 60, 0, 0], v: [-1, 0, 0] }],
      }),
    );

    const first = ring.sample(16.7)!.simTime;
    const second = ring.sample(33.4)!.simTime;
    expect(second).toBeLessThanOrEqual(first);
    expect(second).toBeGreaterThanOrEqual(-2 / 60 - 1e-12);
  });

  it('gives every held buffer back on clear', () => {
    const recycle = vi.fn();
    const ring = new FrameRing(recycle);
    ring.push(
      frame({
        simTime: 0,
        sequence: 1,
        publishDt: 1 / 60,
        bodies: [{ p: [0, 0, 0], v: [0, 0, 0] }],
      }),
    );
    ring.push(
      frame({ simTime: 1, sequence: 2, publishDt: 1, bodies: [{ p: [1, 0, 0], v: [0, 0, 0] }] }),
    );
    ring.clear();
    expect(recycle).toHaveBeenCalledTimes(2);
    expect(ring.sample(0)).toBeNull();
  });
});
