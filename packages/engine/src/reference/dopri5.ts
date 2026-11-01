import type { ForceField } from './forces.ts';
import type { RefState } from './state.ts';

/**
 * Dormand-Prince 5(4), adaptive step.
 *
 * The third integrator, and the only one that is not symplectic. It exists for
 * the cases where a fixed step is not merely less accurate but actually wrong:
 * close encounters, collisions, and chaotic few-body problems. The Pythagorean
 * three-body preset is the example, where bodies pass close enough that the
 * local timescale drops by orders of magnitude for a few moments and any step
 * big enough to be interactive the rest of the time produces a different
 * outcome entirely.
 *
 * Seven stages, a fifth-order solution with an embedded fourth-order estimate
 * for the error, and a standard step controller. The embedded estimate is what
 * makes it adaptive without needing to integrate anything twice.
 *
 * ## Why not Bulirsch-Stoer
 *
 * The plan called for Gragg-Bulirsch-Stoer, following REBOUND's guidance that
 * an adaptive integrator is required here. GBS reaches higher accuracy on
 * smooth problems, but its order and step control (modified midpoint plus
 * polynomial extrapolation with Deuflhard's controller) is substantially more
 * intricate to get right, and getting a step controller subtly wrong produces
 * plausible-looking trajectories that are wrong. Dormand-Prince 5(4) is in the
 * same use class, is an order of magnitude less code, and its convergence
 * order can be verified numerically, which this one is.
 *
 * ## Not symplectic
 *
 * Energy drifts here rather than oscillating, so this is the wrong choice for
 * a long well-behaved run; that is what leapfrog and yoshida4 are for. It is
 * also not time-symmetric, so reversing time under this integrator does not
 * retrace the path exactly.
 *
 * ## State
 *
 * `dt` in the scenario is treated as the MAXIMUM step. The controller works
 * below it and never above, so turning dt down still tightens accuracy and the
 * control means the same thing it does for the fixed-step integrators.
 *
 * For a smooth problem the cap is usually what binds rather than the
 * tolerance: on a circular orbit the controller would happily take a step a
 * quarter of an orbit long, so at a dt of 1e-2 the tolerance makes no
 * difference at all. The cap earns its keep anyway, because it bounds how far
 * the simulation can jump between published frames and therefore how coarse
 * the interpolated motion can get.
 */

/** Dormand-Prince stage coefficients. */
const A21 = 1 / 5;
const A31 = 3 / 40;
const A32 = 9 / 40;
const A41 = 44 / 45;
const A42 = -56 / 15;
const A43 = 32 / 9;
const A51 = 19372 / 6561;
const A52 = -25360 / 2187;
const A53 = 64448 / 6561;
const A54 = -212 / 729;
const A61 = 9017 / 3168;
const A62 = -355 / 33;
const A63 = 46732 / 5247;
const A64 = 49 / 176;
const A65 = -5103 / 18656;

/** Fifth-order solution weights. Also the final stage's a-row, so c7 = 1. */
const B1 = 35 / 384;
const B3 = 500 / 1113;
const B4 = 125 / 192;
const B5 = -2187 / 6784;
const B6 = 11 / 84;

/** Difference between the fifth and fourth order weights: the error estimate. */
const E1 = 71 / 57600;
const E3 = -71 / 16695;
const E4 = 71 / 1920;
const E5 = -17253 / 339200;
const E6 = 22 / 525;
const E7 = -1 / 40;

/**
 * Error tolerances.
 *
 * Tight enough that the Pythagorean problem's close approaches are resolved
 * correctly, loose enough to stay interactive. The absolute floor matters for
 * bodies near the origin, where a purely relative tolerance would demand
 * absurd precision from coordinates that happen to be near zero.
 */
export const DEFAULT_RELATIVE_TOLERANCE = 1e-10;
export const DEFAULT_ABSOLUTE_TOLERANCE = 1e-14;

/** Controller constants. Standard values for a 5th order method. */
const SAFETY = 0.9;
const MIN_SHRINK = 0.2;
const MAX_GROW = 5;
const ORDER_EXPONENT = 1 / 5;

/** Rejections tolerated before a step is forced through. */
const MAX_REJECTIONS = 12;

/**
 * Stage a-rows, hoisted to module scope.
 *
 * As array literals at the call site these were an allocation per stage per
 * step, which is six per step and thousands per second. The frame loop and the
 * step loop both allocate nothing; see docs/CONTRACTS.md.
 *
 * The last row is the fifth-order weight vector, which is also this method's
 * final a-row. That is what makes the sixth stage leave the accepted solution
 * in the state arrays with no further combination needed.
 */
const STAGE_ROWS: readonly Float64Array[] = [
  new Float64Array([A21]),
  new Float64Array([A31, A32]),
  new Float64Array([A41, A42, A43]),
  new Float64Array([A51, A52, A53, A54]),
  new Float64Array([A61, A62, A63, A64, A65]),
  new Float64Array([B1, 0, B3, B4, B5, B6]),
];

export interface Dopri5Options {
  relativeTolerance?: number;
  absoluteTolerance?: number;
}

export class Dopri5 {
  private readonly relativeTolerance: number;
  private readonly absoluteTolerance: number;

  constructor(options: Dopri5Options = {}) {
    this.relativeTolerance = options.relativeTolerance ?? DEFAULT_RELATIVE_TOLERANCE;
    this.absoluteTolerance = options.absoluteTolerance ?? DEFAULT_ABSOLUTE_TOLERANCE;
  }

  /** Position and velocity derivatives per stage. */
  private kx: Float64Array[] = [];
  private kv: Float64Array[] = [];

  /** Start-of-step state, kept so a rejected step can be undone exactly. */
  private x0 = new Float64Array(0);
  private y0 = new Float64Array(0);
  private z0 = new Float64Array(0);
  private vx0 = new Float64Array(0);
  private vy0 = new Float64Array(0);
  private vz0 = new Float64Array(0);

  private capacity = 0;

  /** Current working step magnitude. Carried between calls. */
  private stepMagnitude = 0;

  /** Accepted and rejected step counts, for diagnostics. */
  accepted = 0;
  rejected = 0;

  /** Smallest step accepted since the last restart. 0 means none yet. */
  smallestStep = 0;

  /** Discards the carried step size. Call on load, reset or a settings change. */
  restart(): void {
    this.stepMagnitude = 0;
    this.accepted = 0;
    this.rejected = 0;
    this.smallestStep = 0;
  }

  private reserve(n: number): void {
    if (n <= this.capacity) return;
    const capacity = Math.max(n, 64, this.capacity * 2);
    const make = () => new Float64Array(capacity);

    // Seven stages, each holding a position and a velocity derivative per axis.
    this.kx = Array.from({ length: 7 }, () => new Float64Array(capacity * 3));
    this.kv = Array.from({ length: 7 }, () => new Float64Array(capacity * 3));

    this.x0 = make();
    this.y0 = make();
    this.z0 = make();
    this.vx0 = make();
    this.vy0 = make();
    this.vz0 = make();

    this.capacity = capacity;
  }

  /**
   * Advances the state by at most `maxDt`, returning the time actually taken.
   *
   * The sign of `maxDt` sets the direction. The returned value carries the same
   * sign and has magnitude at or below `|maxDt|`.
   */
  step(state: RefState, forces: ForceField, maxDt: number): number {
    const n = state.count;
    if (n === 0 || maxDt === 0) return 0;
    this.reserve(n);

    const direction = Math.sign(maxDt);
    const limit = Math.abs(maxDt);
    if (this.stepMagnitude === 0 || this.stepMagnitude > limit) {
      this.stepMagnitude = limit;
    }

    const { x, y, z, vx, vy, vz, locked } = state;

    // Snapshot, so a rejected trial can be undone exactly.
    this.x0.set(x.subarray(0, n));
    this.y0.set(y.subarray(0, n));
    this.z0.set(z.subarray(0, n));
    this.vx0.set(vx.subarray(0, n));
    this.vy0.set(vy.subarray(0, n));
    this.vz0.set(vz.subarray(0, n));

    for (let attempt = 0; ; attempt++) {
      const h = this.stepMagnitude * direction;
      const error = this.trial(state, forces, h, n);

      if (error <= 1 || attempt >= MAX_REJECTIONS) {
        // Accept. The candidate is already in the state arrays.
        if (error > 1) {
          // Forced through after too many rejections. Better to take a step
          // that is slightly too large than to stall the simulation, which
          // from the outside looks like a freeze.
          this.rejected++;
        }
        this.accepted++;
        const magnitude = Math.abs(h);
        if (this.smallestStep === 0 || magnitude < this.smallestStep) {
          this.smallestStep = magnitude;
        }
        const growth = Math.min(
          MAX_GROW,
          Math.max(1, SAFETY * Math.pow(Math.max(error, 1e-10), -ORDER_EXPONENT)),
        );
        this.stepMagnitude = Math.min(limit, this.stepMagnitude * growth);
        return h;
      }

      // Reject: restore and shrink.
      this.rejected++;
      for (let i = 0; i < n; i++) {
        if (locked[i] !== 0) continue;
        x[i] = this.x0[i];
        y[i] = this.y0[i];
        z[i] = this.z0[i];
        vx[i] = this.vx0[i];
        vy[i] = this.vy0[i];
        vz[i] = this.vz0[i];
      }
      const shrink = Math.max(MIN_SHRINK, SAFETY * Math.pow(error, -ORDER_EXPONENT));
      this.stepMagnitude *= shrink;
    }
  }

  /**
   * Forms one intermediate state from the stages already computed, evaluates
   * the forces there, and records that stage's derivatives.
   */
  private stage(
    state: RefState,
    forces: ForceField,
    h: number,
    n: number,
    index: number,
    row: Float64Array,
  ): void {
    const { x, y, z, vx, vy, vz, ax, ay, az, locked } = state;
    const kx = this.kx;
    const kv = this.kv;

    for (let i = 0; i < n; i++) {
      if (locked[i] !== 0) continue;
      const d = i * 3;
      let dx = 0;
      let dy = 0;
      let dz = 0;
      let dvx = 0;
      let dvy = 0;
      let dvz = 0;
      for (let s = 0; s < row.length; s++) {
        const a = row[s];
        if (a === 0) continue;
        dx += a * kx[s]![d];
        dy += a * kx[s]![d + 1];
        dz += a * kx[s]![d + 2];
        dvx += a * kv[s]![d];
        dvy += a * kv[s]![d + 1];
        dvz += a * kv[s]![d + 2];
      }
      x[i] = this.x0[i] + h * dx;
      y[i] = this.y0[i] + h * dy;
      z[i] = this.z0[i] + h * dz;
      vx[i] = this.vx0[i] + h * dvx;
      vy[i] = this.vy0[i] + h * dvy;
      vz[i] = this.vz0[i] + h * dvz;
    }

    forces.compute(state);
    for (let i = 0; i < n; i++) {
      const d = i * 3;
      kx[index]![d] = vx[i];
      kx[index]![d + 1] = vy[i];
      kx[index]![d + 2] = vz[i];
      kv[index]![d] = ax[i];
      kv[index]![d + 1] = ay[i];
      kv[index]![d + 2] = az[i];
    }
  }

  /**
   * Runs all seven stages, writes the fifth-order result into the state, and
   * returns the scaled error norm. A norm at or below 1 means accept.
   */
  private trial(state: RefState, forces: ForceField, h: number, n: number): number {
    const { x, y, z, vx, vy, vz, ax, ay, az, locked } = state;
    const kx = this.kx;
    const kv = this.kv;

    // Stage 1 at the start-of-step state.
    forces.compute(state);
    for (let i = 0; i < n; i++) {
      const d = i * 3;
      kx[0]![d] = this.vx0[i];
      kx[0]![d + 1] = this.vy0[i];
      kx[0]![d + 2] = this.vz0[i];
      kv[0]![d] = ax[i];
      kv[0]![d + 1] = ay[i];
      kv[0]![d + 2] = az[i];
    }

    for (let index = 1; index <= 6; index++) {
      this.stage(state, forces, h, n, index, STAGE_ROWS[index - 1]!);
    }

    // The sixth stage's a-row is the fifth-order weight vector, so the state
    // it left behind IS the fifth-order solution. Nothing more to form.
    let sum = 0;
    let counted = 0;

    for (let i = 0; i < n; i++) {
      if (locked[i] !== 0) continue;
      const d = i * 3;
      for (let c = 0; c < 3; c++) {
        const errorX =
          h *
          (E1 * kx[0]![d + c] +
            E3 * kx[2]![d + c] +
            E4 * kx[3]![d + c] +
            E5 * kx[4]![d + c] +
            E6 * kx[5]![d + c] +
            E7 * kx[6]![d + c]);
        const errorV =
          h *
          (E1 * kv[0]![d + c] +
            E3 * kv[2]![d + c] +
            E4 * kv[3]![d + c] +
            E5 * kv[4]![d + c] +
            E6 * kv[5]![d + c] +
            E7 * kv[6]![d + c]);

        const position = c === 0 ? x[i] : c === 1 ? y[i] : z[i];
        const startPosition = c === 0 ? this.x0[i] : c === 1 ? this.y0[i] : this.z0[i];
        const velocity = c === 0 ? vx[i] : c === 1 ? vy[i] : vz[i];
        const startVelocity = c === 0 ? this.vx0[i] : c === 1 ? this.vy0[i] : this.vz0[i];

        const scaleX =
          this.absoluteTolerance +
          this.relativeTolerance * Math.max(Math.abs(position), Math.abs(startPosition));
        const scaleV =
          this.absoluteTolerance +
          this.relativeTolerance * Math.max(Math.abs(velocity), Math.abs(startVelocity));

        const rx = errorX / scaleX;
        const rv = errorV / scaleV;
        sum += rx * rx + rv * rv;
        counted += 2;
      }
    }

    if (counted === 0) return 0;
    const norm = Math.sqrt(sum / counted);
    return Number.isFinite(norm) ? norm : Number.POSITIVE_INFINITY;
  }
}
