import type { RefState } from './state.ts';

/**
 * A source of accelerations.
 *
 * Integrators take one of these rather than calling a force function
 * directly, so that the choice between direct summation and Barnes-Hut is
 * made once by the engine instead of being threaded through every integrator.
 * Implementations write into `state.ax/ay/az` and must not allocate: this is
 * called up to seven times per step and thousands of times per frame.
 */
export interface ForceField {
  compute(state: RefState): void;
}

/**
 * Direct O(N^2) summation with Plummer softening.
 *
 * The inner loop exploits pair symmetry, so each pair is visited once and its
 * acceleration applied to both bodies. Softening is `1 / (r^2 + eps^2)^(3/2)`,
 * which removes the singularity at contact. eps = 0 is legal and is required
 * by the periodic few-body families, whose orbits only close under exact
 * Newtonian gravity.
 *
 * Locked bodies exert force but do not receive it. That is what makes the
 * restricted problems (Sitnikov, Lagrange point test particles) expressible
 * without a separate code path.
 *
 * Allocates nothing.
 */
export function computeAccelerations(state: RefState, G: number, softening: number): void {
  const n = state.count;
  const { x, y, z, mass, ax, ay, az, locked } = state;
  const eps2 = softening * softening;

  ax.fill(0, 0, n);
  ay.fill(0, 0, n);
  az.fill(0, 0, n);

  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    const zi = z[i];
    const mi = mass[i];
    const freeI = locked[i] === 0;

    for (let j = i + 1; j < n; j++) {
      const dx = x[j] - xi;
      const dy = y[j] - yi;
      const dz = z[j] - zi;

      const r2 = dx * dx + dy * dy + dz * dz + eps2;
      if (r2 === 0) continue;

      const invR = 1 / Math.sqrt(r2);
      const invR3 = invR * invR * invR;
      const s = G * invR3;

      if (freeI) {
        const sj = s * mass[j];
        ax[i] += sj * dx;
        ay[i] += sj * dy;
        az[i] += sj * dz;
      }
      if (locked[j] === 0) {
        const si = s * mi;
        ax[j] -= si * dx;
        ay[j] -= si * dy;
        az[j] -= si * dz;
      }
    }
  }
}
