# Benchmarks

**LANE A owns this.**

Two things belong here:

1. `cargo bench` criterion benches in `crates/nbody-core`, reporting pairs per
   second and steps per second at N = 128, 512, 1k, 2k and 5k for both force
   models. Commit the baselines; CI fails on a regression worse than 15%.

2. A node harness in this package that runs the same sizes through the
   TypeScript reference engine, so the Rust speedup is measured rather than
   assumed. That number is the entire justification for the Rust core, and the
   research behind this project found published cases where a Rust/WASM port
   ran *slower* than the TypeScript it replaced because of bridge overhead. If
   the measured gain here is small, the boundary is wrong, not the language.

The budget being defended, from `docs/PHYSICS.md`:

| N      | Model       | Target at 60 Hz              |
| ------ | ----------- | ---------------------------- |
| ≤ 512  | direct      | 8 or more substeps per frame |
| 2,000  | direct      | 1 to 2 substeps per frame    |
| 5,000  | Barnes-Hut  | 1 substep per frame          |
