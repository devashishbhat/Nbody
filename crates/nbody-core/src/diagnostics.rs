//! Conserved quantities.
//!
//! These are what the accuracy readout is built from and the cheapest honest
//! signal that a run has gone wrong. Potential energy uses the SAME softening
//! as the force kernel: reporting the unsoftened potential would describe an
//! energy the integrator is not conserving, and the drift readout would show a
//! fault that does not exist.

use crate::state::State;

#[derive(Debug, Default, Clone, Copy)]
pub struct Diagnostics {
    pub kinetic: f64,
    pub potential: f64,
    pub energy: f64,
    pub momentum: f64,
    pub angular_momentum: f64,
    pub com: [f64; 3],
    /// -2T/U. Equals 1 for a virialised system, 0 when U is 0.
    pub virial_ratio: f64,
}

/// O(N^2), so callers compute this on publish rather than every step.
pub fn diagnostics(state: &State, g: f64, softening: f64) -> Diagnostics {
    let n = state.count;
    let eps2 = softening * softening;

    let mut kinetic = 0.0;
    let mut p = [0.0f64; 3];
    let mut l = [0.0f64; 3];
    let mut c = [0.0f64; 3];
    let mut total_mass = 0.0;

    for i in 0..n {
        let m = state.mass[i];
        let (ux, uy, uz) = (state.vx[i], state.vy[i], state.vz[i]);
        let (x, y, z) = (state.x[i], state.y[i], state.z[i]);

        kinetic += 0.5 * m * (ux * ux + uy * uy + uz * uz);

        p[0] += m * ux;
        p[1] += m * uy;
        p[2] += m * uz;

        l[0] += m * (y * uz - z * uy);
        l[1] += m * (z * ux - x * uz);
        l[2] += m * (x * uy - y * ux);

        c[0] += m * x;
        c[1] += m * y;
        c[2] += m * z;

        total_mass += m;
    }

    let mut potential = 0.0;
    for i in 0..n {
        let (xi, yi, zi) = (state.x[i], state.y[i], state.z[i]);
        let mi = state.mass[i];
        for j in (i + 1)..n {
            let dx = state.x[j] - xi;
            let dy = state.y[j] - yi;
            let dz = state.z[j] - zi;
            let r2 = dx * dx + dy * dy + dz * dz + eps2;
            if r2 == 0.0 {
                continue;
            }
            potential -= g * mi * state.mass[j] / r2.sqrt();
        }
    }

    let com = if total_mass > 0.0 {
        [c[0] / total_mass, c[1] / total_mass, c[2] / total_mass]
    } else {
        [0.0, 0.0, 0.0]
    };

    Diagnostics {
        kinetic,
        potential,
        energy: kinetic + potential,
        momentum: (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt(),
        angular_momentum: (l[0] * l[0] + l[1] * l[1] + l[2] * l[2]).sqrt(),
        com,
        virial_ratio: if potential == 0.0 {
            0.0
        } else {
            -2.0 * kinetic / potential
        },
    }
}
