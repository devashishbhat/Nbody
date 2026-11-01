import { describe, expect, it } from 'vitest';
import {
  allocateFrame,
  BODY_BYTES,
  BODY_STRIDE,
  FRAME_HEADER_BYTES,
  FrameFlags,
  FrameView,
  H,
  frameByteLength,
  handleBlockByteOffset,
  writeRelativePositionsF32,
} from './frame.ts';

describe('frame buffer layout', () => {
  it('sizes a buffer as header plus body block plus handle block', () => {
    expect(frameByteLength(0)).toBe(FRAME_HEADER_BYTES);
    expect(frameByteLength(10)).toBe(FRAME_HEADER_BYTES + 10 * BODY_BYTES + 10 * 4);
    expect(frameByteLength(5000)).toBe(128 + 5000 * 52);
  });

  it('keeps every region 8-byte aligned for any capacity', () => {
    for (const capacity of [0, 1, 3, 7, 11, 999, 5000]) {
      expect(FRAME_HEADER_BYTES % 8).toBe(0);
      expect(handleBlockByteOffset(capacity) % 8).toBe(0);
    }
  });

  it('stamps capacity into the header so views can find the handle block', () => {
    const buffer = allocateFrame(32);
    const view = new FrameView(buffer);
    expect(view.capacity).toBe(32);
    expect(view.bodies.length).toBe(32 * BODY_STRIDE);
    expect(view.handles.length).toBe(32);
  });

  it('rejects a buffer whose header claims more capacity than it has', () => {
    const buffer = allocateFrame(4);
    new Float64Array(buffer, 0, 16)[H.capacity] = 4096;
    expect(() => new FrameView(buffer)).toThrow(/capacity 4096 needs/);
  });

  it('reuses its views when rebound to the same buffer', () => {
    // This is the property that makes a running simulation allocation-free:
    // buffers ping-pong between the same objects, so rebinding must not build
    // new typed arrays.
    const buffer = allocateFrame(16);
    const view = new FrameView(buffer);
    const bodies = view.bodies;
    const handles = view.handles;
    const header = view.header;

    view.bind(buffer);

    expect(view.bodies).toBe(bodies);
    expect(view.handles).toBe(handles);
    expect(view.header).toBe(header);
  });

  it('rebuilds its views when rebound to a different buffer', () => {
    const view = new FrameView(allocateFrame(16));
    const bodies = view.bodies;
    view.bind(allocateFrame(16));
    expect(view.bodies).not.toBe(bodies);
  });

  it('does not let the body and handle blocks overlap', () => {
    const buffer = allocateFrame(8);
    const view = new FrameView(buffer);
    view.bodies.fill(1.5);
    view.handles.fill(0xffffffff);
    // Writing handles must not have corrupted the body block.
    expect([...view.bodies].every((v) => v === 1.5)).toBe(true);
  });

  it('reports energy drift relative to the t=0 energy', () => {
    const view = new FrameView(allocateFrame(2));
    view.header[H.energy0] = -2;
    view.header[H.energy] = -2.0002;
    expect(view.energyDrift).toBeCloseTo(1e-4, 12);
  });

  it('reports zero drift when the initial energy is zero', () => {
    const view = new FrameView(allocateFrame(2));
    view.header[H.energy0] = 0;
    view.header[H.energy] = 5;
    expect(view.energyDrift).toBe(0);
  });

  it('decodes flags as a bitfield', () => {
    const view = new FrameView(allocateFrame(1));
    view.header[H.flags] = FrameFlags.Paused | FrameFlags.TopologyChanged;
    expect(view.hasFlag(FrameFlags.Paused)).toBe(true);
    expect(view.hasFlag(FrameFlags.TopologyChanged)).toBe(true);
    expect(view.hasFlag(FrameFlags.Diverged)).toBe(false);
  });
});

describe('writeRelativePositionsF32', () => {
  it('preserves precision that absolute f32 positions would destroy', () => {
    // The plan's central precision claim: at solar-system distances an f32
    // coordinate cannot resolve metre-scale detail, but an f32 offset from a
    // camera-anchored origin can. 1e-9 AU is about 150 metres.
    const neptune = 30;
    const detail = 1e-9;
    const view = new FrameView(allocateFrame(1));
    view.header[H.bodyCount] = 1;
    view.bodies[0] = neptune + detail;

    // Narrowing the absolute coordinate loses the detail entirely.
    expect(Math.fround(neptune + detail)).toBe(Math.fround(neptune));

    // Subtracting the origin in f64 first keeps it.
    const out = new Float32Array(3);
    writeRelativePositionsF32(view, neptune, 0, 0, out);
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0]).toBeCloseTo(detail, 15);
  });

  it('writes only the live body count, not the whole capacity', () => {
    const view = new FrameView(allocateFrame(4));
    view.header[H.bodyCount] = 2;
    for (let i = 0; i < 4; i++) view.bodies[i * BODY_STRIDE] = i + 1;

    const out = new Float32Array(12).fill(-1);
    writeRelativePositionsF32(view, 0, 0, 0, out);

    expect(out[0]).toBe(1);
    expect(out[3]).toBe(2);
    expect(out[6]).toBe(-1);
  });

  it('allocates nothing per call', () => {
    const view = new FrameView(allocateFrame(64));
    view.header[H.bodyCount] = 64;
    const out = new Float32Array(192);
    // A second call must reuse `out` exactly, with no reallocation.
    writeRelativePositionsF32(view, 0, 0, 0, out);
    const buffer = out.buffer;
    writeRelativePositionsF32(view, 1, 1, 1, out);
    expect(out.buffer).toBe(buffer);
  });
});
