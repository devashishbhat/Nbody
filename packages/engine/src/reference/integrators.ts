import type { ForceField } from './forces.ts';
import type { RefState } from './state.ts';

/**
 * Symplectic integrators, built on a shared kick/drift pair.
 *
 * Both are time-symmetric, which is what makes time reversal free: run with a
 * negative dt and the trajectory retraces itself to round-off.
 *
 * ENTRY INVARIANT: `state.ax/ay/az` must hold the accelerations for the
 * state's current positions on entry, and both leave them valid on exit. This
 * is what makes leapfrog cost one force evaluation per step rather than two.
 * Code that mutates positions, masses or lock flags must recompute before
 * stepping again; see `ReferenceEngine.refreshForces`.
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
export function stepLeapfrog(state: RefState, forces: ForceField, dt: number): void {
  const half = dt * 0.5;
  kick(state, half);
  drift(state, dt);
  forces.compute(state);
  kick(state, half);
}

/**
 * Yoshida's 4th order symplectic composition.
 *
 * Three leapfrog steps with weights w1, w0, w1. The negative middle weight is
 * what cancels the third order error term. Three force evaluations per step,
 * and measured roughly a thousandfold more accurate than leapfrog at the same
 * step size.
 */
const CBRT2 = Math.cbrt(2);
const YOSHIDA_W1 = 1 / (2 - CBRT2);
const YOSHIDA_W0 = -CBRT2 / (2 - CBRT2);

export function stepYoshida4(state: RefState, forces: ForceField, dt: number): void {
  stepLeapfrog(state, forces, dt * YOSHIDA_W1);
  stepLeapfrog(state, forces, dt * YOSHIDA_W0);
  stepLeapfrog(state, forces, dt * YOSHIDA_W1);
}
