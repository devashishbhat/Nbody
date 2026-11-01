# Lanes

Phase 0 is complete. Five lanes can now run in parallel.

Read [CONTRACTS.md](./CONTRACTS.md) first. It contains the interfaces every
lane builds against and eleven rules that are not open for reinterpretation.

---

## Ownership

A lane writes **only** inside the directories it owns. No exceptions.

| Lane                | Owns                                                  |
| ------------------- | ----------------------------------------------------- |
| **A: Physics**      | `crates/nbody-core`                                   |
| **B: Engine host**  | `crates/nbody-wasm`, `packages/engine`                |
| **C: Renderer**     | `packages/renderer`                                   |
| **D: Scenarios**    | `packages/scenarios`, `tools/horizons`                |
| **E: UI and shell** | `packages/ui`, `apps/web`                             |

Shared, and therefore not owned by any lane:

- `packages/protocol` changes only through a protocol change, below.
- `pnpm-lock.yaml` and `Cargo.lock` are edited by **Lane E only**. Other lanes
  ask Lane E for a dependency rather than adding it.
- `docs/` is appended to by any lane; `CONTRACTS.md` follows the protocol
  change process.

## Working rules

1. **One worktree and branch per lane.** `git worktree add ../nbody-lane-c -b lane-c`.
   Working trees never interfere, and a lane can rebase without disturbing
   anyone.
2. **Keep your package independently buildable and testable.**
   `pnpm --filter @nbody/<pkg> typecheck` and `pnpm vitest run packages/<pkg>`
   must pass on their own. CI runs each package separately so a lane is told
   the truth about its own work and never blocked by someone else's red build.
3. **Do not reach across a boundary to make something work.** If Lane C needs
   something from Lane B, that is a protocol change, not an edit to
   `packages/engine`.
4. **Leave a `LANE X:` comment** where you deliberately stop short, so the next
   lane finds the seam instead of guessing.

## Making a protocol change

1. Open a small PR that touches only `packages/protocol`.
2. Add a row to the amendment log at the bottom of `CONTRACTS.md`.
3. Say which lanes are affected in the PR description.
4. Keep it additive wherever possible. The frame header has three spare f64
   slots (indices 14 and 15 plus the reserved tail) precisely so that adding a
   diagnostic does not require a coordinated change.

## What each lane starts with

Phase 0 deliberately left each lane a working baseline rather than an empty
directory, so the first task is replacement rather than invention.

### Lane A: Physics, `crates/nbody-core`

You have: `State` and `Accel` in SoA layout, the `ForceModel` and `Integrator`
traits, a correct unvectorised `Direct` kernel, `Leapfrog`, `Yoshida4`,
`diagnostics`, and seven unit tests covering the closed-form binary, momentum
conservation, convergence, time symmetry and locked bodies.

**The Rust workspace has not been compiled.** No toolchain was installed in the
environment where Phase 0 was written. Your first command is:

```
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
cargo test --workspace
```

Expect to fix small compile errors before anything else.

To build:

1. **`forces::BarnesHut` first.** Octree from Morton-sorted indices, `theta`
   opening angle, default 0.5. Test against `Direct` within a theta-dependent
   tolerance; do not replace `Direct`, which is the oracle.

   This is ahead of SIMD on purpose. The measured baseline in
   `docs/PHYSICS.md` shows plain TypeScript already meeting the frame budget at
   N <= 2048, and missing N = 5000 by a factor of five. SIMD cannot close a
   five-times gap; only reducing the work can. Barnes-Hut is what unblocks a
   preset, SIMD only buys headroom.
2. A SIMD direct kernel using 128-bit lanes via the `wide` crate. WASM SIMD is
   128-bit, so f64 gives two lanes. Test against `Direct`.
3. `integrators::BulirschStoer`, adaptive. This is the gap that matters most:
   the Pythagorean preset ships declaring `bulirsch-stoer` and the reference
   engine currently approximates it with yoshida4 and emits a warning saying
   so. Close encounters are wrong until this exists.
4. `collisions`, merge-on-contact conserving mass, momentum and volume. Port
   the semantics from `packages/engine/src/reference/collisions.ts`, including
   the rule that the heavier body keeps its handle so a trail survives a merge.
5. `criterion` benches at N = 128, 512, 1k, 2k, 5k for both force models.
   Commit the baselines; CI fails on a regression worse than 15%.

### Lane B: Engine host, `crates/nbody-wasm` + `packages/engine`

You have: the full worker, the client, the playback ring with Hermite
interpolation, and a complete TypeScript reference engine. 43 tests pass.

The worker is engine-agnostic on purpose. Swapping in WASM should touch the
`engine` binding and the `ready` handshake and nothing else.

To build:

1. The `Simulation` type in `nbody-wasm`, per the plan in that crate's module
   docs. Honour contract rule 5: state stays in WASM memory, one buffer crosses
   per frame.
2. `pnpm build:wasm` wired into the dev flow, and a Vite plugin or import that
   loads `crates/nbody-wasm/pkg` from the worker.
3. **Parity tests.** The reference engine is not scaffolding to delete, it is
   the oracle. Run both engines over every preset for 10,000 steps and assert
   agreement within tolerance. This is the only mechanism that will catch a
   mis-transcribed force kernel.
4. Delete the `bulirsch-stoer` fallback warning in `ReferenceEngine.step` once
   Lane A ships the adaptive integrator, and keep the reference honest about
   what it does not implement.
5. Revisit the step budget in `worker.ts` (`STEP_BUDGET_MS`, currently 10 ms)
   once real throughput numbers exist.

### Lane C: Renderer, `packages/renderer`

You have: the `Renderer` and `CameraController` contracts, and a provisional
Canvas2D implementation that satisfies them honestly, including the
camera-anchored f32 conversion and the damped springs.

**Replace the Canvas2D renderer wholesale. Do not grow it.** It exists so the
shell had something to draw with on day one.

Develop against `createMockEngineClient()` from `@nbody/engine`: bodies on
exact circular orbits, smooth by construction. If motion looks uneven against
that source, the fault is in your camera or your draw path, not in the physics.

To build, per the plan:

1. Instanced bodies in one draw call, circle from a signed distance function in
   the fragment shader so they stay crisp at any zoom. Three radius modes: true
   scale, log-compressed, uniform dots.
2. Trails as per-body GPU ring buffers, `bufferSubData` per published frame,
   alpha faded by sample age. WebGL2 has no primitive restart, so cap tracked
   bodies at 64, which covers every few-body preset. Watch
   `FrameSample.topologyVersion` and rebuild on change.
3. Shader-drawn reference grid that snaps to the nearest power-of-ten decade,
   plus a scale bar.
4. Overlays: velocity vectors, acceleration vectors, and the predicted-orbit
   ghost for the selected body.
5. Optional subtle bloom, quarter-resolution bright pass plus separable blur,
   off by default.
6. The 3D orbit camera. Physics is already 3D; only the camera is 2D-locked by
   default.
7. Honour `prefers-reduced-motion`: no bloom, instant trail fade, instant
   camera springs.

### Lane D: Scenarios, `packages/scenarios` + `tools/horizons`

You have: three presets whose initial conditions are verified against
closed-form or published results (circular binary, figure-eight, Pythagorean),
a registry, and a validation suite that every new preset passes automatically.

Use the three seeds as the template. Note how each one documents its source,
its period, and why its settings are what they are.

To build:

1. `tools/horizons`: fetch state vectors from
   `https://ssd.jpl.nasa.gov/api/horizons.api` with `TABLE_TYPE=VECTORS`,
   `OUT_UNITS=AU-D`, `REF_PLANE=ECLIPTIC`, `REF_SYSTEM=J2000`,
   `CENTER=500@10`, epoch 2026-01-01 TDB. Commit the resulting JSON: the app
   must never call an external API at runtime. Verify the column order against
   a sample response rather than assuming it.
2. The solar system family: full system, inner system, Sun/Earth/Moon, Jupiter
   with the Galilean moons, Saturn's major moons, Pluto/Charon, a procedural
   asteroid belt of ~1500 particles where the Kirkwood gaps emerge on their
   own, and the Jupiter Trojans at L4/L5.
3. The remaining periodic families: Lagrange equilateral triangle, Euler
   collinear, Broucke-Hénon samples, the Šuvakov/Dmitrašinović classes
   (butterfly, yin-yang, dragonfly, moth), Sitnikov, restricted three-body with
   L1 to L5 and a halo orbit, a hierarchical triple, a binary with a
   circumbinary planet, and TRAPPIST-1. Take initial conditions from the
   published tables, not approximations, and add a period-return test for each.
4. Procedural 3D: virialised Plummer sphere, two-cluster collision, cold
   collapse, disk galaxy, galaxy flyby with tidal tails, URL-seeded random
   cluster.
5. The share-link codec: serialise, deflate (`fflate` is already a dependency),
   base64url, into the URL hash. Round-trip every preset losslessly in tests.
   Presets share as an id plus a diff so links stay short; offer a JSON
   download for large custom scenarios.

### Lane E: UI and shell, `packages/ui` + `apps/web`

You have: the design tokens, the `LiveText` primitive that keeps per-frame
values out of React, fixed-width numeric formatters with tests pinning their
width stability, and a provisional shell that proves the slice works.

**The shell in `apps/web/src/App.tsx` is a harness, not a foundation.** The
wiring in `useSimulation.ts` is the part worth keeping: copy its pattern.

To build, per the plan:

1. The real layout: preset switcher and command palette top left, transport bar
   bottom centre, collapsible inspector right, diagnostics bottom right.
   Panels dim after inactivity and return on pointer movement.
2. Inspector per body: name, mass on a log slider plus a numeric field, radius,
   position, velocity as components and as magnitude plus direction, colour,
   lock, trail. Plus osculating orbital elements (a, e, i, period) against the
   dominant mass.
3. Inspector global: G, integrator, dt, softening, force model and theta,
   collision mode, time scale.
4. Interactions: click to select, drag to move, drag the velocity handle to set
   velocity, drag empty space to pan, wheel to zoom, shift-drag to orbit,
   click-drag-release on empty space to spawn a body slingshot style.
5. Keyboard: space, arrows, `R`, `F`, `1`-`9`, `/`, undo and redo.
6. A command pattern over scenario edits so undo and redo are uniform.
7. Touch: pan, pinch, panels as a bottom sheet.
8. Vitest needs a DOM project for component tests. Add one under
   `test.projects` in `vitest.config.ts` rather than switching the existing
   project to jsdom, because the numeric suites must stay on node.

## Integration, Phase 2

Serial, after the lanes converge. Swap the reference engine for WASM behind the
same interface, wire the real renderer, then a dedicated pass over profiling
and the allocation audit, per-preset tuning of `dt` and integrator,
accessibility, mobile, and deployment.
