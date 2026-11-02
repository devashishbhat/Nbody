import type { CollisionMode } from '@nbody/protocol';
import type { RefState } from './state.ts';

/**
 * Contact between bodies.
 *
 * Two outcomes are physically available when bodies touch, and which one
 * happens is decided by one number: the closing speed against the mutual
 * escape velocity,
 *
 *     v_esc = sqrt( 2 G (m1 + m2) / (r1 + r2) )
 *
 * Below it, the pair cannot separate again whatever they do, so they accrete.
 * This is not an approximation for convenience; it is how planets were built.
 * Above it, they arrive with more than enough energy to leave, so they
 * scatter. The `realistic` mode applies exactly that test, and `merge` and
 * `bounce` force one answer or the other.
 *
 * ## What this does not model
 *
 * A fast impact between real bodies shatters them. Fragmentation needs a
 * strength model, a size distribution for the debris and a way to create
 * bodies mid-step, and nearly all of it would be invented rather than derived.
 * So a super-escape impact here scatters the bodies intact, which is honest
 * about the dynamics and silent about the geology.
 *
 * ## Tunnelling
 *
 * Contact is detected by overlap, so a pair that crosses the whole contact
 * distance within a single step passes through undetected. The step needed to
 * avoid that is roughly the contact radius divided by the closing speed. The
 * adaptive integrator does not help here, since it is watching the smoothness
 * of the gravitational field rather than the geometry.
 *
 * ## Cost
 *
 * O(N^2) per call, and merging reindexes, so a merge storm is quadratic.
 * Acceptable: collisions are an interactive feature at small N, and the
 * collective presets run with them off.
 */

export interface CollisionResult {
  /** Pairs that merged. Reduces the body count. */
  merges: number;
  /** Pairs that rebounded. Leaves the body count alone. */
  bounces: number;
}

/**
 * Overlap to leave after separating a rebounded pair.
 *
 * Pushing them to exactly touching leaves them in contact, so the next step
 * detects the same collision again and the pair buzzes. A small gap costs
 * nothing physically and ends the chatter.
 */
const SEPARATION_MARGIN = 1.001;

export function resolveCollisions(
  state: RefState,
  mode: CollisionMode,
  G: number,
  restitution: number,
): CollisionResult {
  const result: CollisionResult = { merges: 0, bounces: 0 };
  if (mode === 'none') return result;

  const { x, y, z, mass, radius } = state;

  for (let i = 0; i < state.count; i++) {
    let j = i + 1;
    while (j < state.count) {
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const dz = z[j] - z[i];
      const contact = radius[i] + radius[j];
      const distanceSq = dx * dx + dy * dy + dz * dz;

      if (distanceSq >= contact * contact || contact === 0) {
        j++;
        continue;
      }

      // Two bodies that cannot move each other have nothing to resolve.
      if (mass[i] === 0 && mass[j] === 0) {
        j++;
        continue;
      }

      if (shouldMerge(state, i, j, mode, G, dx, dy, dz, distanceSq)) {
        mergeInto(state, i, j);
        result.merges++;
        // Swap-removal moved a previously unexamined body into slot j, so j
        // must not advance.
        continue;
      }

      if (bounce(state, i, j, restitution, dx, dy, dz, distanceSq, contact)) {
        result.bounces++;
      }
      j++;
    }
  }

  return result;
}

function shouldMerge(
  state: RefState,
  i: number,
  j: number,
  mode: CollisionMode,
  G: number,
  dx: number,
  dy: number,
  dz: number,
  distanceSq: number,
): boolean {
  if (mode === 'merge') return true;
  if (mode === 'bounce') return false;

  // A pinned body is immovable, so it cannot be absorbed and cannot absorb.
  if (state.locked[i] !== 0 || state.locked[j] !== 0) return false;

  const total = state.mass[i] + state.mass[j];
  const contact = state.radius[i] + state.radius[j];
  if (total <= 0 || contact <= 0) return false;

  // Closing speed along the line of centres. Only the component that brings
  // them together matters; a glancing pass at high tangential speed is not an
  // impact at that speed.
  const distance = Math.sqrt(distanceSq);
  if (distance === 0) return true;

  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;
  const closing =
    (state.vx[i] - state.vx[j]) * nx +
    (state.vy[i] - state.vy[j]) * ny +
    (state.vz[i] - state.vz[j]) * nz;

  // Already separating: nothing is arriving.
  if (closing <= 0) return false;

  const escape = Math.sqrt((2 * G * total) / contact);
  return closing < escape;
}

/** Combines j into i, conserving mass, momentum and volume. */
function mergeInto(state: RefState, i: number, j: number): void {
  const { x, y, z, vx, vy, vz, mass, radius } = state;

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

  // The heavier body keeps its identity, including its handle, so a trail
  // being drawn for the dominant object continues through the merge rather
  // than jumping to a different one.
  if (mj > mi) {
    state.handles[i] = state.handles[j];
    state.ids[i] = state.ids[j]!;
    state.names[i] = state.names[j]!;
    state.colors[i] = state.colors[j]!;
  }
  state.trails[i] = state.trails[i] || state.trails[j]!;
  state.locked[i] = state.locked[i] | state.locked[j];

  state.removeAt(j);
}

/**
 * Rebounds a pair as hard spheres.
 *
 * The impulse acts along the line of centres and is split by inverse mass, so
 * momentum is conserved exactly however unequal the masses are. Returns false
 * when the pair was already separating, which happens on the step after a
 * bounce and must not be resolved twice.
 *
 * A pinned body and a massless one are the two edge cases, and both reduce to
 * the same thing: one side does not respond, so the other takes the whole
 * velocity change. Treating either as a finite mass would have a pinned planet
 * recoil from a dust grain.
 */
function bounce(
  state: RefState,
  i: number,
  j: number,
  restitution: number,
  dx: number,
  dy: number,
  dz: number,
  distanceSq: number,
  contact: number,
): boolean {
  const { x, y, z, vx, vy, vz, mass, locked } = state;

  let distance = Math.sqrt(distanceSq);
  let nx: number;
  let ny: number;
  let nz: number;

  if (distance === 0) {
    // Exactly coincident, so there is no line of centres. Any axis will do and
    // picking one is better than dividing by zero.
    nx = 1;
    ny = 0;
    nz = 0;
    distance = 0;
  } else {
    nx = dx / distance;
    ny = dy / distance;
    nz = dz / distance;
  }

  const relative = (vx[j] - vx[i]) * nx + (vy[j] - vy[i]) * ny + (vz[j] - vz[i]) * nz;

  // Positive means they are moving apart already.
  if (relative > 0) return false;

  // A body that does not respond has, in effect, infinite mass: zero inverse
  // mass. Pinned bodies and massless test particles are the two cases.
  const fixedI = locked[i] !== 0 || mass[i] === 0;
  const fixedJ = locked[j] !== 0 || mass[j] === 0;
  const invI = locked[i] !== 0 ? 0 : mass[i] > 0 ? 1 / mass[i] : Number.POSITIVE_INFINITY;
  const invJ = locked[j] !== 0 ? 0 : mass[j] > 0 ? 1 / mass[j] : Number.POSITIVE_INFINITY;

  if (fixedI && fixedJ && invI === 0 && invJ === 0) return false;

  const change = -(1 + restitution) * relative;

  if (!Number.isFinite(invI) || !Number.isFinite(invJ)) {
    // One side is massless. It absorbs the entire velocity change and the
    // other is untouched, which is what a dust grain hitting a planet does.
    const massless = !Number.isFinite(invI) ? i : j;
    const sign = massless === i ? -1 : 1;
    vx[massless] += sign * change * nx;
    vy[massless] += sign * change * ny;
    vz[massless] += sign * change * nz;
  } else {
    const totalInverse = invI + invJ;
    if (totalInverse === 0) return false;
    const impulse = change / totalInverse;
    vx[i] -= impulse * invI * nx;
    vy[i] -= impulse * invI * ny;
    vz[i] -= impulse * invI * nz;
    vx[j] += impulse * invJ * nx;
    vy[j] += impulse * invJ * ny;
    vz[j] += impulse * invJ * nz;
  }

  // Separate them, or the same overlap is detected next step and the pair
  // buzzes instead of bouncing. Shared out by inverse mass so the lighter
  // body does the moving.
  const overlap = contact * SEPARATION_MARGIN - distance;
  if (overlap > 0) {
    const shareI = Number.isFinite(invI) ? invI : 1;
    const shareJ = Number.isFinite(invJ) ? invJ : 1;
    const total = shareI + shareJ;
    if (total > 0) {
      const moveI = (overlap * shareI) / total;
      const moveJ = (overlap * shareJ) / total;
      x[i] -= nx * moveI;
      y[i] -= ny * moveI;
      z[i] -= nz * moveI;
      x[j] += nx * moveJ;
      y[j] += ny * moveJ;
      z[j] += nz * moveJ;
    }
  }

  return true;
}

/** Kept for the tests that predate the other modes. */
export function resolveMerges(state: RefState): number {
  return resolveCollisions(state, 'merge', 1, 0).merges;
}
