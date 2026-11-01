//! Integrators.
//!
//! LANE A owns this module. `Leapfrog` and `Yoshida4` below are complete;
//! `BulirschStoer` is the remaining one and is the reason the adaptive slot
//! exists at all, because the Pythagorean three-body preset and any
//! close-encounter scenario cannot be integrated correctly at a fixed step.
//!
//! Both implemented integrators are symplectic and time-symmetric. The
//! symmetry is what makes the UI's reverse control exact: negate `dt` and the
//! trajectory retraces itself to round-off.
//!
//! ENTRY INVARIANT: `accel` must hold the accelerations for the state's
//! current positions on entry, and every integrator leaves it that way on
//! exit. This is what lets leapfrog cost one force evaluation per step instead
//! of two. A caller that mutates positions, masses or lock flags must
//! recompute accelerations before stepping again.

use crate::forces::ForceModel;
use crate::state::{Accel, State};

#[derive(Debug, Clone, Copy)]
pub struct StepParams {
    pub g: f64,
    pub softening: f64,
    /// Negative runs the simulation backwards.
    pub dt: f64,
}

pub trait Integrator {
    fn step(
        &mut self,
        state: &mut State,
        accel: &mut Accel,
        forces: &mut dyn ForceModel,
        params: &StepParams,
    );

    fn name(&self) -> &'static str;

    /// Force evaluations per step, for the cost readout in the UI.
    fn force_evaluations(&self) -> u32;
}

fn kick(state: &mut State, accel: &Accel, dt: f64) {
    for i in 0..state.count {
        if state.locked[i] != 0 {
            continue;
        }
        state.vx[i] += accel.ax[i] * dt;
        state.vy[i] += accel.ay[i] * dt;
        state.vz[i] += accel.az[i] * dt;
    }
}

fn drift(state: &mut State, dt: f64) {
    for i in 0..state.count {
        if state.locked[i] != 0 {
            continue;
        }
        state.x[i] += state.vx[i] * dt;
        state.y[i] += state.vy[i] * dt;
        state.z[i] += state.vz[i] * dt;
    }
}

/// Kick-drift-kick velocity Verlet. One force evaluation per step.
///
/// Energy error oscillates with the orbit rather than accumulating, which is
/// the property that matters for a tool meant to be left running.
#[derive(Debug, Default, Clone, Copy)]
pub struct Leapfrog;

impl Integrator for Leapfrog {
    fn step(
        &mut self,
        state: &mut State,
        accel: &mut Accel,
        forces: &mut dyn ForceModel,
        params: &StepParams,
    ) {
        let half = params.dt * 0.5;
        kick(state, accel, half);
        drift(state, params.dt);
        forces.accelerations(state, params.g, params.softening, accel);
        kick(state, accel, half);
    }

    fn name(&self) -> &'static str {
        "leapfrog"
    }

    fn force_evaluations(&self) -> u32 {
        1
    }
}

/// Yoshida's 4th order symplectic composition.
///
/// Three leapfrog steps with weights w1, w0, w1. The negative middle weight is
/// what cancels the third order error term.
#[derive(Debug, Default, Clone, Copy)]
pub struct Yoshida4;

/// 2^(1/3), as a constant because `cbrt` is not const.
const CBRT2: f64 = 1.259_921_049_894_873_2;
const W1: f64 = 1.0 / (2.0 - CBRT2);
const W0: f64 = -CBRT2 / (2.0 - CBRT2);

impl Integrator for Yoshida4 {
    fn step(
        &mut self,
        state: &mut State,
        accel: &mut Accel,
        forces: &mut dyn ForceModel,
        params: &StepParams,
    ) {
        let mut leapfrog = Leapfrog;
        for weight in [W1, W0, W1] {
            let sub = StepParams {
                dt: params.dt * weight,
                ..*params
            };
            leapfrog.step(state, accel, &mut *forces, &sub);
        }
    }

    fn name(&self) -> &'static str {
        "yoshida4"
    }

    fn force_evaluations(&self) -> u32 {
        3
    }
}
