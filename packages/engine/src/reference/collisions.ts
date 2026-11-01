import type { RefState } from './state.ts';

/**
 * Merge-on-contact.
 *
 * Two bodies that overlap become one, conserving mass, momentum and volume.
 * The heavier body's identity survives, so a trail being drawn for the
 * dominant object continues uninterrupted through the merge rather than
 * jumping to a different handle.
 *
 * This is O(N^2) per call and the swap-removal reindexes, so a merge storm is
 * quadratic. That is acceptable here: collisions are an interactive feature at
 * small N, and the Rust core handles the large-N case with spatial queries.
 *
 * Returns the number of merges performed.
 */
export function resolveMerges(state: RefState): number {
  const { x, y, z, vx, vy, vz, mass, radius } = state;
  let merges = 0;

  for (let i = 0; i < state.count; i++) {
    let j = i + 1;
    while (j < state.count) {
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const dz = z[j] - z[i];
      const contact = radius[i] + radius[j];

      if (dx * dx + dy * dy + dz * dz >= contact * contact) {
        j++;
        continue;
      }

      const mi = mass[i];
      const mj = mass[j];
      const total = mi + mj;

      if (total > 0) {
        x[i] = (mi * x[i] + mj * x[j]) / total;
        y[i] = (mi * y[i] + mj * y[j]) / total;
        z[i] = (mi * z[i] + mj * z[j]) / total;
        vx[i] = (mi * vx[i] + mj * vx[j]) / total;
        vy[i] = (mi * vy[i] + mj * vy[j]) / total;
        vz[i] = (mi * vz[i] + mj * vz[j]) / total;
      }
      mass[i] = total;
      radius[i] = Math.cbrt(radius[i] ** 3 + radius[j] ** 3);

      // The heavier body keeps its identity, including its handle.
      if (mj > mi) {
        state.handles[i] = state.handles[j];
        state.ids[i] = state.ids[j]!;
        state.names[i] = state.names[j]!;
        state.colors[i] = state.colors[j]!;
        state.trails[i] = state.trails[j]!;
      }
      state.trails[i] = state.trails[i] || state.trails[j]!;
      state.locked[i] = state.locked[i] | state.locked[j];

      // Swap-removal moves a previously unexamined body into slot j, so j must
      // not advance.
      state.removeAt(j);
      merges++;
    }
  }

  return merges;
}
