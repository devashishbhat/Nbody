/**
 * Frame buffer layout.
 *
 * One ArrayBuffer carries a complete simulation snapshot from the worker to
 * the main thread. It is transferred, not copied, and the main thread
 * transfers the consumed buffer back with a `recycle` message, so a steady
 * state run allocates nothing at all.
 *
 * Byte layout, for a buffer allocated with capacity C:
 *
 *   [0, 128)                     header,  16 x f64
 *   [128, 128 + 48C)             bodies,  6C x f64   (x,y,z,vx,vy,vz per body)
 *   [128 + 48C, 128 + 52C)       handles, C  x u32
 *
 * All three regions stay 8-byte aligned because 128 and 48 are both multiples
 * of 8.
 *
 * Positions are f64 on the wire, not f32. At 30+ AU an f32 coordinate has
 * roughly 2 metre resolution, which is visible as jitter the moment the camera
 * zooms in near a planet. The renderer converts to f32 only after subtracting
 * a camera-anchored origin, which restores full precision at any zoom level.
 * At C = 5000 and 60 Hz the whole buffer is about 16 MB/s through a
 * transferable, which costs nothing.
 *
 * The body block is interleaved rather than split into separate position and
 * velocity arrays because Hermite interpolation, the single hottest loop on
 * the main thread, reads all six components of one body together.
 *
 * Velocities ride along because interpolation needs them and because the
 * velocity-vector overlay would otherwise require a second channel.
 */

/** f64 slots reserved for the header. Padded so new fields need no bump. */
export const FRAME_HEADER_SLOTS = 16;
export const FRAME_HEADER_BYTES = FRAME_HEADER_SLOTS * 8;

/** f64 values per body: x, y, z, vx, vy, vz. */
export const BODY_STRIDE = 6;
export const BODY_BYTES = BODY_STRIDE * 8;
export const HANDLE_BYTES = 4;

/** Header slot indices. Both sides of the worker boundary use these names. */
export const H = {
  /** Simulation time of this snapshot, in the scenario's time unit. */
  simTime: 0,
  /** Integrator steps taken since the last load or reset. */
  stepCount: 1,
  /** Live body count. Never exceeds `capacity`. Shrinks when bodies merge. */
  bodyCount: 2,
  /** Total energy now. */
  energy: 3,
  /** Total energy at t=0, for the drift readout. */
  energy0: 4,
  /** Magnitude of total angular momentum. */
  angularMomentum: 5,
  /** Magnitude of total linear momentum. */
  momentum: 6,
  /** Distance the centre of mass has drifted from its starting point. */
  comDrift: 7,
  /** -2T/U. Equals 1 for a virialised system. */
  virialRatio: 8,
  /** Wall-clock milliseconds per integrator step, smoothed. */
  msPerStep: 9,
  /** Sim time between this frame and the previous one. Drives interpolation. */
  publishDt: 10,
  /** Bitfield, see FrameFlags. */
  flags: 11,
  /** Monotonic counter. Lets the main thread drop out-of-order frames. */
  sequence: 12,
  /** Bodies this buffer was allocated for. Fixes the handle block offset. */
  capacity: 13,
} as const;

export const FrameFlags = {
  Paused: 1 << 0,
  /** Bodies were added, removed or merged. Consumers must rebuild any
   *  per-body GPU state and must not interpolate against the previous frame. */
  TopologyChanged: 1 << 1,
  /** A merge happened on this step. */
  Collided: 1 << 2,
  /** dt is negative, so the simulation is running backwards. */
  Reversed: 1 << 3,
  /** A non-finite value appeared. The run has blown up and is halted. */
  Diverged: 1 << 4,
} as const;

export function frameByteLength(capacity: number): number {
  return FRAME_HEADER_BYTES + capacity * BODY_BYTES + capacity * HANDLE_BYTES;
}

export function bodyBlockByteOffset(): number {
  return FRAME_HEADER_BYTES;
}

export function handleBlockByteOffset(capacity: number): number {
  return FRAME_HEADER_BYTES + capacity * BODY_BYTES;
}

/** Allocates a frame buffer and stamps its capacity into the header. */
export function allocateFrame(capacity: number): ArrayBuffer {
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw new RangeError(`frame capacity must be a non-negative integer, got ${capacity}`);
  }
  const buffer = new ArrayBuffer(frameByteLength(capacity));
  new Float64Array(buffer, 0, FRAME_HEADER_SLOTS)[H.capacity] = capacity;
  return buffer;
}

/**
 * A reusable set of typed-array views over a frame buffer.
 *
 * `bind` recreates its views only when the underlying buffer actually changes
 * identity. Because buffers ping-pong between the same two or three objects,
 * a running simulation rebinds to an already-seen buffer and allocates
 * nothing. Do not construct a FrameView per frame.
 */
export class FrameView {
  buffer: ArrayBuffer;
  header: Float64Array;
  /** Length 6 * capacity. Index body i component c at i * BODY_STRIDE + c. */
  bodies: Float64Array;
  /** Length capacity. Stable per-body handles, parallel to the body block. */
  handles: Uint32Array;

  constructor(buffer: ArrayBuffer) {
    // Assigned properly by bind; these satisfy definite assignment.
    this.buffer = buffer;
    this.header = new Float64Array(0);
    this.bodies = new Float64Array(0);
    this.handles = new Uint32Array(0);
    this.rebuild(buffer);
  }

  /** Points this view at `buffer`, reusing existing views where possible. */
  bind(buffer: ArrayBuffer): void {
    if (buffer === this.buffer && this.header.length === FRAME_HEADER_SLOTS) return;
    this.rebuild(buffer);
  }

  private rebuild(buffer: ArrayBuffer): void {
    if (buffer.byteLength < FRAME_HEADER_BYTES) {
      throw new RangeError(`frame buffer too small: ${buffer.byteLength} bytes`);
    }
    const header = new Float64Array(buffer, 0, FRAME_HEADER_SLOTS);
    const capacity = header[H.capacity];
    if (!Number.isInteger(capacity) || capacity < 0) {
      throw new RangeError(`frame buffer header has invalid capacity ${capacity}`);
    }
    if (buffer.byteLength < frameByteLength(capacity)) {
      throw new RangeError(
        `frame buffer is ${buffer.byteLength} bytes but capacity ${capacity} needs ` +
          `${frameByteLength(capacity)}`,
      );
    }
    this.buffer = buffer;
    this.header = header;
    this.bodies = new Float64Array(buffer, bodyBlockByteOffset(), capacity * BODY_STRIDE);
    this.handles = new Uint32Array(buffer, handleBlockByteOffset(capacity), capacity);
  }

  get capacity(): number {
    return this.header[H.capacity];
  }

  get count(): number {
    return this.header[H.bodyCount];
  }

  get simTime(): number {
    return this.header[H.simTime];
  }

  get sequence(): number {
    return this.header[H.sequence];
  }

  get flags(): number {
    return this.header[H.flags];
  }

  hasFlag(flag: number): boolean {
    return (this.header[H.flags] & flag) !== 0;
  }

  /** Relative energy drift, the headline accuracy number shown in the UI. */
  get energyDrift(): number {
    const e0 = this.header[H.energy0];
    if (e0 === 0) return 0;
    return Math.abs((this.header[H.energy] - e0) / e0);
  }
}

/**
 * Converts positions to f32 relative to a world-space origin.
 *
 * This is the precision-preserving step described at the top of this file.
 * Subtracting a camera-anchored origin in f64 before narrowing to f32 keeps
 * sub-metre accuracy at any zoom level, which plain f32 positions cannot do at
 * solar-system scale.
 *
 * `out` must hold at least 3 * view.count floats and is written in place.
 * Allocates nothing.
 */
export function writeRelativePositionsF32(
  view: FrameView,
  originX: number,
  originY: number,
  originZ: number,
  out: Float32Array,
): void {
  const n = view.count;
  const src = view.bodies;
  for (let i = 0; i < n; i++) {
    const s = i * BODY_STRIDE;
    const d = i * 3;
    out[d] = src[s] - originX;
    out[d + 1] = src[s + 1] - originY;
    out[d + 2] = src[s + 2] - originZ;
  }
}
