//! WebAssembly boundary for `nbody-core`.
//!
//! LANE B owns this crate.
//!
//! The one rule that determines whether using Rust here is worth anything at
//! all: SIMULATION STATE NEVER CROSSES THIS BOUNDARY. Bodies live in WASM
//! linear memory for the lifetime of a run, and the only thing that crosses
//! per published frame is a single frame buffer written in the layout defined
//! by `packages/protocol/src/frame.ts`.
//!
//! This is not a micro-optimisation. Published measurements have Rust/WASM
//! running slower than a plain TypeScript rewrite for workloads that cross the
//! boundary often, because the bridge cost swamps the compute win. An
//! implementation that returned a JS array of positions per frame would be a
//! regression against the reference engine it is replacing.
//!
//! What Lane B builds here:
//!
//!   1. `Simulation`, holding `State`, `Accel`, the active `ForceModel` and
//!      `Integrator`, plus the handle-to-slot map.
//!   2. `load_scenario`, taking the scenario as JSON and parsing it with serde
//!      into the same shape `packages/protocol` defines. Agreement between the
//!      two is checked by the parity tests, not by inspection.
//!   3. `step_many(count)`, which must not allocate.
//!   4. `write_frame(ptr, capacity, publish_dt, ms_per_step, paused)`, writing
//!      the frame layout directly into a buffer the JS side owns, so there is
//!      no copy and no serialisation.
//!   5. The live-edit entry points mirroring the worker protocol: `patch_body`,
//!      `add_body`, `remove_body`, `set_g`, `set_dt` and the rest.
//!
//! The header slot indices and block offsets in `frame` below MUST match
//! `packages/protocol/src/frame.ts` exactly. They are duplicated rather than
//! generated because a build-time codegen step for sixteen integers would cost
//! more than the parity test that pins them.

use wasm_bindgen::prelude::*;

/// Frame buffer layout. Mirrors `packages/protocol/src/frame.ts`.
pub mod frame {
    pub const HEADER_SLOTS: usize = 16;
    pub const HEADER_BYTES: usize = HEADER_SLOTS * 8;
    pub const BODY_STRIDE: usize = 6;
    pub const BODY_BYTES: usize = BODY_STRIDE * 8;
    pub const HANDLE_BYTES: usize = 4;

    pub const H_SIM_TIME: usize = 0;
    pub const H_STEP_COUNT: usize = 1;
    pub const H_BODY_COUNT: usize = 2;
    pub const H_ENERGY: usize = 3;
    pub const H_ENERGY0: usize = 4;
    pub const H_ANGULAR_MOMENTUM: usize = 5;
    pub const H_MOMENTUM: usize = 6;
    pub const H_COM_DRIFT: usize = 7;
    pub const H_VIRIAL_RATIO: usize = 8;
    pub const H_MS_PER_STEP: usize = 9;
    pub const H_PUBLISH_DT: usize = 10;
    pub const H_FLAGS: usize = 11;
    pub const H_SEQUENCE: usize = 12;
    pub const H_CAPACITY: usize = 13;

    pub const FLAG_PAUSED: u32 = 1 << 0;
    pub const FLAG_TOPOLOGY_CHANGED: u32 = 1 << 1;
    pub const FLAG_COLLIDED: u32 = 1 << 2;
    pub const FLAG_REVERSED: u32 = 1 << 3;
    pub const FLAG_DIVERGED: u32 = 1 << 4;

    pub fn byte_length(capacity: usize) -> usize {
        HEADER_BYTES + capacity * BODY_BYTES + capacity * HANDLE_BYTES
    }

    pub fn handle_block_offset(capacity: usize) -> usize {
        HEADER_BYTES + capacity * BODY_BYTES
    }
}

/// Reports which engine answered, for the worker handshake.
#[wasm_bindgen]
pub fn engine_kind() -> String {
    "wasm".to_string()
}

/// Whether this build has 128-bit SIMD compiled in.
///
/// The worker surfaces this so a performance report can say which kernel
/// actually ran, rather than assuming the build flags took effect.
#[wasm_bindgen]
pub fn has_simd() -> bool {
    cfg!(target_feature = "simd128")
}

#[cfg(test)]
mod tests {
    use super::frame;

    #[test]
    fn frame_layout_matches_the_protocol() {
        // These numbers are asserted on the TypeScript side too, in
        // packages/protocol/src/frame.test.ts. If one side changes, both
        // suites must.
        assert_eq!(frame::HEADER_BYTES, 128);
        assert_eq!(frame::byte_length(0), 128);
        assert_eq!(frame::byte_length(5000), 128 + 5000 * 52);
        assert_eq!(frame::handle_block_offset(10) % 8, 0);
    }
}
