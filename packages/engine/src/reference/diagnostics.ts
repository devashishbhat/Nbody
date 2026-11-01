import type { RefState } from './state.ts';

export interface Diagnostics {
  kinetic: number;
  potential: number;
  energy: number;
  momentum: number;
  angularMomentum: number;
  comX: number;
  comY: number;
  comZ: number;
  /** -2T/U. Equals 1 for a virialised system. 0 when U is 0. */
  virialRatio: number;
}

/**
 * Conserved quantities.
 *
 * These are what the UI's accuracy readout is built from, and they are the
 * cheapest honest signal that a simulation has gone wrong. Potential energy
 * uses the same softening as the force kernel, otherwise the reported energy
 * would not be the one the integrator is actually conserving.
 *
 * O(N^2), so the worker computes it on publish rather than every step.
 */
export function computeDiagnostics(
  state: RefState,
  G: number,
  softening: number,
  out: Diagnostics,
): Diagnostics {
  const n = state.count;
  const { x, y, z, vx, vy, vz, mass } = state;
  const eps2 = softening * softening;

  let kinetic = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let lx = 0;
  let ly = 0;
  let lz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let totalMass = 0;

  for (let i = 0; i < n; i++) {
    const m = mass[i];
    const ux = vx[i];
    const uy = vy[i];
    const uz = vz[i];
    kinetic += 0.5 * m * (ux * ux + uy * uy + uz * uz);
    px += m * ux;
    py += m * uy;
    pz += m * uz;
    lx += m * (y[i] * uz - z[i] * uy);
    ly += m * (z[i] * ux - x[i] * uz);
    lz += m * (x[i] * uy - y[i] * ux);
    cx += m * x[i];
    cy += m * y[i];
    cz += m * z[i];
    totalMass += m;
  }

  let potential = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    const zi = z[i];
    const mi = mass[i];
    for (let j = i + 1; j < n; j++) {
      const dx = x[j] - xi;
      const dy = y[j] - yi;
      const dz = z[j] - zi;
      const r2 = dx * dx + dy * dy + dz * dz + eps2;
      if (r2 === 0) continue;
      potential -= (G * mi * mass[j]) / Math.sqrt(r2);
    }
  }

  out.kinetic = kinetic;
  out.potential = potential;
  out.energy = kinetic + potential;
  out.momentum = Math.hypot(px, py, pz);
  out.angularMomentum = Math.hypot(lx, ly, lz);
  if (totalMass > 0) {
    out.comX = cx / totalMass;
    out.comY = cy / totalMass;
    out.comZ = cz / totalMass;
  } else {
    out.comX = 0;
    out.comY = 0;
    out.comZ = 0;
  }
  out.virialRatio = potential === 0 ? 0 : (-2 * kinetic) / potential;
  return out;
}

export function emptyDiagnostics(): Diagnostics {
  return {
    kinetic: 0,
    potential: 0,
    energy: 0,
    momentum: 0,
    angularMomentum: 0,
    comX: 0,
    comY: 0,
    comZ: 0,
    virialRatio: 0,
  };
}
