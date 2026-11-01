import { computeAccelerations } from './forces.ts';
import type { RefState } from './state.ts';

/**
 * Symplectic integrators, written on a shared kick/drift pair.
 *
 * Both are time-symmetric, which is what makes time reversal free: run with a
 * negative dt and the trajectory retraces itself to within round-off.
 *
 * Both assume `state.ax/ay/az` are valid for the current positions on entry,
 * and both leave them valid on exit. That invariant is why leapfrog costs one
 * force evaluation per step rather than two.
 */

function kick(state: RefState, dt: number): void {
  const n = state.count;
  const { vx, vy, vz, ax, ay, az, locked } = state;
  for (let i = 0; i < n; i++) {
    if (locked[i]) continue;
    vx[i] += ax[i] * dt;
    vy[i] += ay[i] * dt;
    vz[i] += az[i] * dt;
  }
}

function drift(state: RefState, dt: number): void {
  const n = state.count;
  const { x, y, z, vx, vy, vz, locked } = state;
  for (let i = 0; i < n; i++) {
    if (locked[i]) continue;
    x[i] += vx[i] * dt;
    y[i] += vy[i] * dt;
    z[i] += vz[i] * dt;
  }
}

/** Kick-drift-kick velocity Verlet. One force evaluation per step. */
export function stepLeapfrog(state: RefState, G: number, softening: number, dt: number): void {
  const half = dt * 0.5;
  kick(state, half);
  drift(state, dt);
  computeAccelerations(state, G, softening);
  kick(state, half);
}

/**
 * Yoshida's 4th order symplectic composition.
 *
 * Three leapfrog steps with weights w1, w0, w1, where the negative middle
 * weight is what cancels the 3rd order error term. Three force evaluations per
 * step, and roughly two extra orders of accuracy for that cost.
 */
const CBRT2 = Math.cbrt(2);
const YOSHIDA_W1 = 1 / (2 - CBRT2);
const YOSHIDA_W0 = -CBRT2 / (2 - CBRT2);

export function stepYoshida4(state: RefState, G: number, softening: number, dt: number): void {
  stepLeapfrog(state, G, softening, dt * YOSHIDA_W1);
  stepLeapfrog(state, G, softening, dt * YOSHIDA_W0);
  stepLeapfrog(state, G, softening, dt * YOSHIDA_W1);
}

export { computeAccelerations };
