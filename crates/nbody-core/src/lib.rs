//! # nbody-core
//!
//! Gravitational N-body physics. No WebAssembly, no JavaScript, no I/O: this
//! crate is plain Rust so that it can be tested, benchmarked and profiled with
//! ordinary tooling, and so that a disagreement with the TypeScript reference
//! engine can be localised without a browser in the loop.
//!
//! LANE A owns this crate. What is here in Phase 0 is the part Lane B needs in
//! order to build the WASM boundary in parallel: the trait shapes, the state
//! layout, and a correct unvectorised baseline for each of them.
//!
//! Still to build, in Lane A:
//!
//!   - `forces::BarnesHut`, an octree built from Morton-sorted indices, with
//!     the `theta` opening-angle criterion. Needed above roughly 2000 bodies,
//!     where direct summation stops fitting in a 60 Hz frame.
//!   - a SIMD direct kernel using 128-bit lanes via the `wide` crate, tested
//!     against `forces::Direct` rather than replacing it.
//!   - `integrators::BulirschStoer`, adaptive. The Pythagorean three-body
//!     preset and every close-encounter scenario depend on it; a fixed step
//!     large enough to be interactive gets those visibly wrong.
//!   - `collisions`, merge-on-contact conserving mass, momentum and volume.
//!
//! The invariants that cross module boundaries are documented on
//! `integrators::Integrator`. Read that before changing anything here.

pub mod diagnostics;
pub mod forces;
pub mod integrators;
pub mod state;
pub mod units;

pub use diagnostics::{diagnostics, Diagnostics};
pub use forces::{Direct, ForceModel};
pub use integrators::{Integrator, Leapfrog, StepParams, Yoshida4};
pub use state::{Accel, State};

#[cfg(test)]
mod tests {
    use super::*;

    /// A circular equal-mass binary, separation 1, in natural units.
    ///
    /// Each body orbits the centre of mass at r = 1/2, so the centripetal
    /// requirement v^2/r must equal the mutual attraction G m / d^2 = 1,
    /// giving v = sqrt(1/2).
    fn circular_binary() -> (State, Accel) {
        let v = 0.5f64.sqrt();
        let mut state = State::default();
        state.resize(2);
        state.count = 2;
        state.x[0] = -0.5;
        state.x[1] = 0.5;
        state.vy[0] = -v;
        state.vy[1] = v;
        state.mass[0] = 1.0;
        state.mass[1] = 1.0;
        state.handles[0] = 1;
        state.handles[1] = 2;
        let accel = Accel::with_capacity(2);
        (state, accel)
    }

    fn period() -> f64 {
        std::f64::consts::TAU * 0.5 / 0.5f64.sqrt()
    }

    #[test]
    fn direct_summation_matches_the_closed_form_energy() {
        let (state, _) = circular_binary();
        let d = diagnostics(&state, units::G_NATURAL, 0.0);
        assert!((d.kinetic - 0.5).abs() < 1e-12);
        assert!((d.potential + 1.0).abs() < 1e-12);
        assert!((d.energy + 0.5).abs() < 1e-12);
    }

    #[test]
    fn leapfrog_closes_the_circular_orbit() {
        let (mut state, mut accel) = circular_binary();
        let mut forces = Direct;
        let mut integrator = Leapfrog;
        forces.accelerations(&state, units::G_NATURAL, 0.0, &mut accel);

        let steps = 100_000;
        let params = StepParams {
            g: units::G_NATURAL,
            softening: 0.0,
            dt: period() / steps as f64,
        };
        for _ in 0..steps {
            integrator.step(&mut state, &mut accel, &mut forces, &params);
        }

        assert!((state.x[0] + 0.5).abs() < 1e-8, "x was {}", state.x[0]);
        assert!(state.y[0].abs() < 1e-8, "y was {}", state.y[0]);
    }

    #[test]
    fn leapfrog_conserves_momentum_exactly() {
        // Exact rather than approximate: the pair loop computes one force per
        // pair and applies equal and opposite impulses.
        let (mut state, mut accel) = circular_binary();
        let mut forces = Direct;
        let mut integrator = Leapfrog;
        forces.accelerations(&state, units::G_NATURAL, 0.0, &mut accel);
        let params = StepParams {
            g: units::G_NATURAL,
            softening: 0.0,
            dt: 1e-2,
        };
        for _ in 0..10_000 {
            integrator.step(&mut state, &mut accel, &mut forces, &params);
        }
        let d = diagnostics(&state, units::G_NATURAL, 0.0);
        assert!(d.momentum < 1e-14, "momentum was {}", d.momentum);
    }

    #[test]
    fn yoshida4_is_far_more_accurate_than_leapfrog_at_equal_step() {
        fn error(mut integrator: Box<dyn Integrator>, dt_target: f64) -> f64 {
            let (mut state, mut accel) = circular_binary();
            let mut forces = Direct;
            forces.accelerations(&state, units::G_NATURAL, 0.0, &mut accel);
            let steps = (period() / dt_target).round() as usize;
            let params = StepParams {
                g: units::G_NATURAL,
                softening: 0.0,
                dt: period() / steps as f64,
            };
            for _ in 0..steps {
                integrator.step(&mut state, &mut accel, &mut forces, &params);
            }
            ((state.x[0] + 0.5).powi(2) + state.y[0].powi(2)).sqrt()
        }

        let leap = error(Box::new(Leapfrog), 2e-3);
        let yosh = error(Box::new(Yoshida4), 2e-3);
        assert!(yosh < leap / 100.0, "leapfrog {leap}, yoshida4 {yosh}");
    }

    #[test]
    fn time_symmetry_retraces_the_path() {
        let (mut state, mut accel) = circular_binary();
        let mut forces = Direct;
        let mut integrator = Leapfrog;
        forces.accelerations(&state, units::G_NATURAL, 0.0, &mut accel);

        let forward = StepParams {
            g: units::G_NATURAL,
            softening: 0.0,
            dt: 1e-3,
        };
        for _ in 0..5000 {
            integrator.step(&mut state, &mut accel, &mut forces, &forward);
        }
        assert!((state.x[0] + 0.5).abs() > 0.1);

        let backward = StepParams { dt: -1e-3, ..forward };
        for _ in 0..5000 {
            integrator.step(&mut state, &mut accel, &mut forces, &backward);
        }
        assert!((state.x[0] + 0.5).abs() < 1e-11, "x was {}", state.x[0]);
        assert!(state.y[0].abs() < 1e-11, "y was {}", state.y[0]);
    }

    #[test]
    fn locked_bodies_exert_force_but_do_not_move() {
        let mut state = State::default();
        state.resize(2);
        state.count = 2;
        state.mass[0] = 1.0;
        state.locked[0] = 1;
        state.x[1] = 1.0;
        state.vy[1] = 1.0;
        state.mass[1] = 0.0;

        let mut accel = Accel::with_capacity(2);
        let mut forces = Direct;
        let mut integrator = Leapfrog;
        forces.accelerations(&state, units::G_NATURAL, 0.0, &mut accel);
        let params = StepParams {
            g: units::G_NATURAL,
            softening: 0.0,
            dt: 1e-3,
        };
        for _ in 0..2000 {
            integrator.step(&mut state, &mut accel, &mut forces, &params);
        }

        assert_eq!(state.x[0], 0.0);
        assert_eq!(state.vy[0], 0.0);
        let r = (state.x[1] * state.x[1] + state.y[1] * state.y[1]).sqrt();
        assert!((r - 1.0).abs() < 1e-2, "radius drifted to {r}");
    }

    #[test]
    fn swap_remove_keeps_the_surviving_bodies() {
        let mut state = State::default();
        state.resize(3);
        state.count = 3;
        for i in 0..3 {
            state.mass[i] = (i + 1) as f64;
            state.handles[i] = (i + 1) as u32;
        }
        state.swap_remove(0);
        assert_eq!(state.count, 2);
        assert_eq!(state.handles[0], 3);
        assert_eq!(state.mass[0], 3.0);
    }
}
