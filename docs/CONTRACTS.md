# Contracts

Frozen interfaces and non-negotiable rules. Everything in this file was settled
in Phase 0 so that five lanes could work at once without talking to each other.

Changing anything here is a **protocol change**. See [AGENTS.md](./AGENTS.md)
for how to make one, and add it to the amendment log at the bottom.

---

## 1. `@nbody/protocol` is the only shared package

Every package depends on `@nbody/protocol` and on no other `@nbody` package.
`protocol` itself imports nothing from the project.

```
protocol  <--  engine
          <--  renderer
          <--  scenarios
          <--  ui
          <--  web  (also depends on all of the above)
```

If you find yourself wanting `@nbody/renderer` to import `@nbody/engine`, the
thing you actually need belongs in `protocol`.

## 2. Internal packages are consumed as TypeScript source

Library packages have no build step. Their `package.json` points `main`,
`types` and `exports` straight at `./src/index.ts`. Vite, Vitest and `tsc` all
read the source directly.

This is deliberate: a build graph between packages would mean lanes waiting on
each other's compile output, which is exactly the coupling the structure exists
to avoid. Only `apps/web` builds.

Relative imports inside a package carry an explicit `.ts` extension
(`allowImportingTsExtensions` is on), so resolution is unambiguous.

## 3. React never renders at frame rate

**React owns the static shell. The render loop owns the canvas and every value
that changes per frame.**

Per-frame numbers (sim clock, energy drift, fps, ms/step, live body readouts)
are written straight to their text nodes from inside the animation frame, using
`LiveText` from `@nbody/ui`. They never pass through component state, context,
or a store subscription.

Routing a sixty-hertz readout through React would re-render a subtree sixty
times a second and make the frame budget hostage to reconciliation. The pattern
to copy is `apps/web/src/useSimulation.ts`.

## 4. The frame loop allocates nothing

No object literals, array literals, closures, spreads or string concatenation
in any function reached from `requestAnimationFrame` or from the worker's step
loop. Pre-allocated scratch buffers only, grown on scenario load.

This is the difference between smooth and intermittently hitchy: a GC pause
does not care that your average frame time was fine.

Enforced by review, and by these properties in the test suites:

- `FrameView.bind` returns its existing views when rebound to the same buffer
  (`packages/protocol/src/frame.test.ts`).
- `FrameRing.sample` returns the same object every call
  (`packages/engine/src/host/ring.test.ts`).

## 5. Simulation state never crosses the WASM boundary

Bodies live in WASM linear memory for the lifetime of a run. Exactly one frame
buffer crosses per published frame, written by Rust directly into memory the JS
side owns.

Published benchmarks show Rust/WASM running *slower* than plain TypeScript for
workloads that cross the bridge often. An implementation that returned a JS
array of positions per frame would be a regression against the reference engine
it replaces, not an optimisation.

## 6. Frame buffer layout

Defined in `packages/protocol/src/frame.ts` and mirrored in
`crates/nbody-wasm/src/lib.rs`. Both sides assert the same numbers; if one
changes, both test suites must.

For a buffer allocated with capacity `C`:

| Region  | Bytes                   | Type         | Length |
| ------- | ----------------------- | ------------ | ------ |
| header  | `[0, 128)`              | `f64`        | 16     |
| bodies  | `[128, 128 + 48C)`      | `f64`        | `6C`   |
| handles | `[128 + 48C, +4C)`      | `u32`        | `C`    |

Total: `128 + 52C` bytes. At `C = 5000` and 60 Hz that is about 16 MB/s through
a transferable, which is free.

**Positions are f64 on the wire, not f32.** At 30 AU an f32 coordinate resolves
to about two metres, which is visible as jitter the moment the camera zooms in
near a planet. The renderer narrows to f32 only *after* subtracting a
camera-anchored origin in f64, which restores full precision at any zoom.
`writeRelativePositionsF32` does this, and
`packages/protocol/src/frame.test.ts` pins the property.

The body block is interleaved (`x,y,z,vx,vy,vz` per body) rather than split,
because Hermite interpolation reads all six components of one body together and
it is the hottest loop on the main thread.

Velocities are carried because interpolation needs them and because the
velocity-vector overlay would otherwise need a second channel.

### Buffer ownership

Buffers ping-pong. The worker transfers a frame to the main thread; the main
thread transfers the consumed buffer back with a `recycle` message. A client
that stops recycling silently forces the worker to allocate every frame, so
recycling lives inside `FrameRing` rather than being left to callers.

Transferables, not `SharedArrayBuffer`. This is why the site needs no COOP/COEP
headers and stays embeddable.

## 7. Worker protocol

`MainToWorker` and `WorkerToMain` in `packages/protocol/src/messages.ts`.

Every live setting is its own message, so the worker never diffs state and so a
lane adding a setting has to decide whether it can apply without a reset.

**Only `load` and `reset` restart anything.** Mass, velocity, position, G,
softening, dt, integrator, force model, theta and collision mode all apply to
the *live* state. Raising Jupiter's mass mid-flight has to work; that is the
product.

`reset` restores the loaded scenario at t=0 but **keeps live setting edits**.
Resetting means "put the bodies back", not "undo my control panel".

## 8. Integrator entry invariant

Documented on `integrators::Integrator` in Rust and in
`packages/engine/src/reference/integrators.ts`.

Accelerations must be valid for the current positions on entry, and every
integrator leaves them valid on exit. This is what makes leapfrog cost one
force evaluation per step instead of two.

Any code that mutates positions, masses or lock flags **must** recompute
accelerations before the next step. `ReferenceEngine.refreshForces()` is the
reference for where those calls belong.

## 9. Renderer and camera contracts

`packages/renderer/src/types.ts`. Fixed in Phase 0; the WebGL2 implementation
behind them is Lane C's.

All camera parameters pass through a critically damped spring and are never
applied directly. `approach()` in `canvas2d.ts` is the function; it cannot
overshoot at any `dt`, which a mass-spring integration can.

The camera owns `originX/Y/Z`, the world-space point the renderer subtracts
before narrowing to f32. See rule 6.

## 10. Scenario document

`packages/protocol/src/scenario.ts`, validated by `ScenarioSchema`.

- `mass` may be 0. Massless test particles are how restricted problems and
  asteroid belts are expressed.
- `dt` may be negative. That is how time reversal is expressed.
- `softening` must be 0 for any preset tagged `periodic`. Any softening
  perturbs the potential and the orbits stop closing. Asserted in
  `packages/scenarios/src/registry.test.ts`.
- `locked` bodies exert force but do not receive it.
- Presets are authored with `defineScenario`, which fills defaults and
  validates immediately, so a malformed preset fails at module load rather
  than rendering a blank screen.

Slot indices are **not** stable. Bodies are identified by `id` across the
protocol and by `handles` inside a frame. Removals swap the last slot down.

## 11. `noUncheckedIndexedAccess` is off

Deliberate. This codebase indexes `Float64Array` in hot numeric loops, where
TypeScript widens every element read to `number | undefined`. The resulting
non-null assertions would be noise on every line of the force kernels and would
hide real problems rather than expose them. Buffer lengths are enforced by the
protocol layer and asserted in tests instead.

---

## Amendment log

| Date       | Change                        | Lanes affected |
| ---------- | ----------------------------- | -------------- |
| 2026-11-01 | Initial contract, Phase 0.    | all            |

---

## Appendix: pinned tooling and why

**TypeScript is pinned to `^6.0.3`, not 7.x.**

`typescript-eslint` 8.x declares `typescript: >=4.8.4 <6.1.0` and refuses to
load against TypeScript 7, which is the native Go rewrite. Support is tracked
upstream in typescript-eslint#10940.

Five lanes working in parallel get more value from a type-aware linter than
from the faster compiler, so the linter wins for now. Moving to 7.x is a
one-line change in every `package.json` once upstream lands, and nothing in the
codebase depends on 6-specific behaviour.
