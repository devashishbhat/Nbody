//! Unit systems.
//!
//! A scenario declares the units its numbers are in and nothing converts them.
//! See `packages/protocol/src/units.ts`, which must agree with this file
//! exactly.

/// Gravitational constant in AU^3 / (solar mass * day^2).
///
/// The IAU Gaussian gravitational constant k = 0.01720209895, squared. Solar
/// system scenarios use this system because it keeps positions, velocities and
/// masses all within a few orders of magnitude of 1, which is where f64 has
/// the most headroom.
pub const G_SOLAR: f64 = 2.959_122_082_855_911e-4;

/// Gravitational constant in m^3 / (kg * s^2). CODATA 2018.
pub const G_SI: f64 = 6.674_3e-11;

/// Natural units: G is exactly 1.
pub const G_NATURAL: f64 = 1.0;
