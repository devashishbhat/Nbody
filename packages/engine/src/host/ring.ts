import { BODY_STRIDE, FrameFlags, FrameView, H, type FrameSample } from '@nbody/protocol';

/**
 * Playback buffer and interpolator.
 *
 * This is the single highest-leverage piece of the smoothness requirement.
 *
 * The worker publishes frames on its own schedule, which jitters: a publish
 * may land 14 ms after the last one or 23 ms after it, and a heavy step budget
 * can stretch that further. Rendering whatever the latest frame happens to be
 * would show that jitter directly as uneven motion, which reads as stutter
 * even at a nominal 60 fps.
 *
 * Instead the main thread renders at a fixed lag behind the newest frame and
 * interpolates. Because the frame carries velocities as well as positions, the
 * interpolation is cubic Hermite rather than linear, so the rendered path has
 * the right curvature through the whole interval. A body on a circular orbit
 * does not visibly flatten into a polygon even at a low publish rate.
 *
 * Three slots is the minimum that always holds a bracketing pair plus the
 * frame currently arriving. After warmup the slots and their views are reused
 * forever, so steady-state sampling allocates nothing.
 */

const RING_CAPACITY = 3;

/**
 * Render lag, in multiples of the publish interval.
 *
 * Below 1.0 the renderer runs out of future frames whenever the worker is
 * slightly late and has to extrapolate, which looks worse than the lag. 1.5
 * absorbs normal jitter at a cost of roughly 25 ms, which is imperceptible for
 * a simulation but comfortably covers a missed publish.
 */
const LAG_INTERVALS = 1.5;

/** Per-sample fraction of the timing error corrected. Keeps drift invisible. */
const CLOCK_CORRECTION = 0.1;

/**
 * Cubic Hermite basis.
 *
 * p(u) = h00*p0 + h10*h*v0 + h01*p1 + h11*h*v1, with h the signed time span.
 * Exported for testing: the property that matters is that the result matches
 * the endpoints exactly and their velocities exactly, which is what keeps
 * motion continuous across a frame boundary.
 */
export function hermite(
  p0: number,
  v0: number,
  p1: number,
  v1: number,
  h: number,
  u: number,
): number {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1;
}

/** Derivative of {@link hermite} with respect to time. */
export function hermiteDerivative(
  p0: number,
  v0: number,
  p1: number,
  v1: number,
  h: number,
  u: number,
): number {
  const u2 = u * u;
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  if (h === 0) return v0;
  return (d00 * p0 + d10 * h * v0 + d01 * p1 + d11 * h * v1) / h;
}

/** Mutable backing store for the sample returned each frame. */
interface MutableFrameSample {
  count: number;
  simTime: number;
  positions: Float64Array;
  velocities: Float64Array;
  handles: Uint32Array;
  topologyVersion: number;
  latest: FrameView;
}

export class FrameRing {
  /** Oldest to newest. Grows to RING_CAPACITY during warmup, then rotates. */
  private views: FrameView[] = [];

  private positions = new Float64Array(0);
  private velocities = new Float64Array(0);
  private handles = new Uint32Array(0);
  private sampleOut: MutableFrameSample;

  private renderSimTime = 0;
  private lastSampleMs = 0;
  private started = false;

  topologyVersion = 0;
  timeScale = 1;

  private readonly recycle: (buffer: ArrayBuffer) => void;

  constructor(recycle: (buffer: ArrayBuffer) => void) {
    this.recycle = recycle;
    this.sampleOut = {
      count: 0,
      simTime: 0,
      positions: this.positions,
      velocities: this.velocities,
      handles: this.handles,
      topologyVersion: 0,
      latest: null as unknown as FrameView,
    };
  }

  get latest(): FrameView | null {
    return this.views.length > 0 ? this.views[this.views.length - 1]! : null;
  }

  /** Playback direction. Negative while the simulation runs backwards. */
  private get direction(): number {
    const newest = this.latest;
    if (!newest) return 1;
    const publishDt = newest.header[H.publishDt];
    if (publishDt > 0) return 1;
    if (publishDt < 0) return -1;
    return newest.hasFlag(FrameFlags.Reversed) ? -1 : 1;
  }

  push(buffer: ArrayBuffer): void {
    const newest = this.latest;

    // Drop a frame that overtook a newer one in the message queue.
    if (newest) {
      const probe = new Float64Array(buffer, 0, 16);
      if (probe[H.sequence] <= newest.sequence) {
        this.recycle(buffer);
        return;
      }
    }

    let view: FrameView;
    if (this.views.length < RING_CAPACITY) {
      view = new FrameView(buffer);
      this.views.push(view);
    } else {
      // Rotate in place: the oldest slot's buffer goes back to the worker and
      // its view object is reused for the incoming frame.
      view = this.views[0]!;
      const stale = view.buffer;
      this.views[0] = this.views[1]!;
      this.views[1] = this.views[2]!;
      this.views[2] = view;
      this.recycle(stale);
      view.bind(buffer);
    }

    this.ensureCapacity(view.capacity);

    if (view.hasFlag(FrameFlags.TopologyChanged)) {
      // The set of bodies changed, so there is nothing coherent to interpolate
      // from. Collapse to this frame and tell consumers to rebuild.
      this.topologyVersion++;
      for (const other of this.views) {
        if (other !== view) this.recycle(other.buffer);
      }
      this.views.length = 0;
      this.views.push(view);
      this.renderSimTime = view.simTime;
      this.started = true;
    }

    if (!this.started) {
      this.renderSimTime = view.simTime;
      this.started = true;
    }
  }

  /** Drops every held frame, returning their buffers. For load and dispose. */
  clear(): void {
    for (const view of this.views) this.recycle(view.buffer);
    this.views.length = 0;
    this.started = false;
    this.renderSimTime = 0;
    this.topologyVersion++;
  }

  private ensureCapacity(capacity: number): void {
    if (this.positions.length >= capacity * 3 && this.handles.length >= capacity) return;
    this.positions = new Float64Array(capacity * 3);
    this.velocities = new Float64Array(capacity * 3);
    this.handles = new Uint32Array(capacity);
    // Mutated rather than replaced, so the sample object identity is stable.
    this.sampleOut.positions = this.positions;
    this.sampleOut.velocities = this.velocities;
    this.sampleOut.handles = this.handles;
  }

  /**
   * Interpolated state for this instant.
   *
   * Returns null until the first frame arrives. The returned object is reused
   * between calls and must not be retained past the current animation frame.
   */
  sample(nowMs: number): FrameSample | null {
    const newest = this.latest;
    if (!newest) return null;

    const dir = this.direction;
    const wallDelta = this.lastSampleMs === 0 ? 0 : (nowMs - this.lastSampleMs) / 1000;
    this.lastSampleMs = nowMs;

    // Advance the playback clock by wall time, then nudge it toward the target
    // lag. Correcting gradually rather than snapping is what keeps a late
    // publish from producing a visible jump.
    this.renderSimTime += dir * wallDelta * this.timeScale;

    const publishDt = Math.abs(newest.header[H.publishDt]) || this.timeScale / 60;
    const target = newest.simTime - dir * LAG_INTERVALS * publishDt;
    this.renderSimTime += (target - this.renderSimTime) * CLOCK_CORRECTION;

    const oldest = this.views[0]!;
    // Never extrapolate: outside the held span, hold the nearest endpoint.
    if (dir * (this.renderSimTime - newest.simTime) > 0) this.renderSimTime = newest.simTime;
    if (dir * (this.renderSimTime - oldest.simTime) < 0) this.renderSimTime = oldest.simTime;

    const pair = this.bracket(this.renderSimTime, dir);
    if (!pair) return this.emit(newest, newest.simTime);

    const [a, b] = pair;
    const h = b.simTime - a.simTime;
    const u = h === 0 ? 0 : Math.min(1, Math.max(0, (this.renderSimTime - a.simTime) / h));

    const n = Math.min(a.count, b.count);
    const src0 = a.bodies;
    const src1 = b.bodies;
    const pos = this.positions;
    const vel = this.velocities;

    for (let i = 0; i < n; i++) {
      const s = i * BODY_STRIDE;
      const d = i * 3;
      for (let c = 0; c < 3; c++) {
        const p0 = src0[s + c];
        const v0 = src0[s + 3 + c];
        const p1 = src1[s + c];
        const v1 = src1[s + 3 + c];
        pos[d + c] = hermite(p0, v0, p1, v1, h, u);
        vel[d + c] = hermiteDerivative(p0, v0, p1, v1, h, u);
      }
      this.handles[i] = b.handles[i];
    }

    const out = this.sampleOut;
    out.count = n;
    out.simTime = this.renderSimTime;
    out.topologyVersion = this.topologyVersion;
    out.latest = newest;
    return out;
  }

  private bracket(t: number, dir: number): [FrameView, FrameView] | null {
    for (let i = 0; i + 1 < this.views.length; i++) {
      const a = this.views[i]!;
      const b = this.views[i + 1]!;
      if (dir * (t - a.simTime) >= 0 && dir * (b.simTime - t) >= 0) return [a, b];
    }
    return null;
  }

  /** Copies a single frame through unchanged, for the pre-warmup case. */
  private emit(view: FrameView, simTime: number): FrameSample {
    const n = view.count;
    const src = view.bodies;
    for (let i = 0; i < n; i++) {
      const s = i * BODY_STRIDE;
      const d = i * 3;
      this.positions[d] = src[s];
      this.positions[d + 1] = src[s + 1];
      this.positions[d + 2] = src[s + 2];
      this.velocities[d] = src[s + 3];
      this.velocities[d + 1] = src[s + 4];
      this.velocities[d + 2] = src[s + 5];
      this.handles[i] = view.handles[i];
    }
    const out = this.sampleOut;
    out.count = n;
    out.simTime = simTime;
    out.topologyVersion = this.topologyVersion;
    out.latest = view;
    return out;
  }
}
