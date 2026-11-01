//! Force models.
//!
//! LANE A owns the implementations behind this trait. `Direct` below is a
//! correct, unvectorised baseline: it is what the SIMD kernel and the
//! Barnes-Hut tree are tested against, so it should stay simple enough to be
//! obviously right rather than being optimised in place.

use crate::state::{Accel, State};

pub trait ForceModel {
    /// Writes accelerations for the current positions into `accel`.
    ///
    /// Must not allocate: the stepping loop runs this up to thousands of times
    /// per published frame.
    fn accelerations(&mut self, state: &State, g: f64, softening: f64, accel: &mut Accel);

    fn name(&self) -> &'static str;
}

/// Direct O(N^2) summation with Plummer softening.
///
/// The pair loop visits each pair once and applies the acceleration to both
/// bodies, which halves the work and makes momentum conservation exact rather
/// than approximate: the two impulses are computed from the same number.
///
/// Softening is `1 / (r^2 + eps^2)^(3/2)`. `eps = 0` is legal and is required
/// by the periodic few-body families, whose orbits only close under exact
/// Newtonian gravity.
#[derive(Debug, Default, Clone, Copy)]
pub struct Direct;

impl ForceModel for Direct {
    fn accelerations(&mut self, state: &State, g: f64, softening: f64, accel: &mut Accel) {
        let n = state.count;
        accel.zero(n);
        let eps2 = softening * softening;

        for i in 0..n {
            let xi = state.x[i];
            let yi = state.y[i];
            let zi = state.z[i];
            let mi = state.mass[i];
            let free_i = state.locked[i] == 0;

            for j in (i + 1)..n {
                let dx = state.x[j] - xi;
                let dy = state.y[j] - yi;
                let dz = state.z[j] - zi;

                let r2 = dx * dx + dy * dy + dz * dz + eps2;
                if r2 == 0.0 {
                    continue;
                }

                let inv_r = 1.0 / r2.sqrt();
                let s = g * inv_r * inv_r * inv_r;

                if free_i {
                    let sj = s * state.mass[j];
                    accel.ax[i] += sj * dx;
                    accel.ay[i] += sj * dy;
                    accel.az[i] += sj * dz;
                }
                if state.locked[j] == 0 {
                    let si = s * mi;
                    accel.ax[j] -= si * dx;
                    accel.ay[j] -= si * dy;
                    accel.az[j] -= si * dz;
                }
            }
        }
    }

    fn name(&self) -> &'static str {
        "direct"
    }
}
