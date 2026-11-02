# Contracts

Frozen interfaces and the rules that are not open to reinterpretation.

---

## 1. `@nbody/protocol` is the only shared package

Every package depends on `@nbody/protocol` and on no other `@nbody` package.
`protocol` itself imports nothing from the project.

```
protocol ──┬── engine ──┐
           ├── renderer ─┼── web
           ├── scenarios ┤
           └── ui ───────┘
```

If you find yourself wanting `@nbody/renderer` to import `@nbody/engine`, the
thing you actually need belongs in `protocol`. Cross-package work that genuinely
needs two of them, such as running a real engine over real presets, lives in
`tests/physics`.

## 2. Internal packages are consumed as TypeScript source

Library packages have no build step. Their `package.json` points `main`, `types`
and `exports` straight at `./src/index.ts`, and Vite, Vitest and `tsc` all read
the source. Only `apps/web` builds.

Relative imports carry an explicit `.ts` extension, and `erasableSyntaxOnly` is
on, so no enums, namespaces or constructor parameter properties. Every source
file stays loadable by plain `node`, which the tools under `tools/` rely on.

## 3. React never renders at frame rate

**React owns the static shell. The render loop owns the canvas and every value
that changes per frame.**

The fifteen per-frame readouts are written straight to their text nodes from
inside the animation frame, using `LiveText` from `@nbody/ui`. They never pass
through component state, context or a store subscription.

One exception, deliberately bounded: the inspector needs the selected body's
live position and velocity in editable fields, which rules out `LiveText`. That
is sampled at five hertz. Five re-renders a second of one small panel is
nothing; sixty would not be.

The pattern to copy is `apps/web/src/useSimulation.ts`.

## 4. The frame loop allocates nothing

No object literals, array literals, closures, spreads or string concatenation in
any function reached from `requestAnimationFrame` or from the worker's step
loop. Pre-allocated scratch buffers only, grown on scenario load.

This is the difference between smooth and intermittently hitchy: a garbage
collection pause does not care that your average frame time was fine.

Pinned by these properties:

- `FrameView.bind` returns its existing views when rebound to the same buffer.
- `FrameRing.sample` returns the same object every call.
- `BarnesHutTree` reuses its node pool across rebuilds.
- The Dormand-Prince stage coefficient rows are module constants, because as
  array literals at the call site they were six allocations per step.

## 5. Frame buffer layout

Defined in `packages/protocol/src/frame.ts`. For a buffer of capacity `C`:

| Region  | Bytes                | Type  | Length |
| ------- | -------------------- | ----- | ------ |
| header  | `[0, 128)`           | `f64` | 16     |
| bodies  | `[128, 128 + 48C)`   | `f64` | `6C`   |
| handles | `[128 + 48C, +4C)`   | `u32` | `C`    |

Total `128 + 52C` bytes. At `C = 5000` and 60 Hz that is about 16 MB/s through a
transferable, which costs nothing.

**Positions are f64 on the wire, not f32.** At 30 AU an f32 coordinate resolves
to about two metres, visible as jitter the moment the camera zooms in near a
planet. The renderer narrows to f32 only *after* subtracting a camera-anchored
origin in f64. `writeRelativePositionsF32` does this and
`packages/protocol/src/frame.test.ts` pins the property.

The body block is interleaved (`x,y,z,vx,vy,vz` per body) because Hermite
interpolation reads all six components of one body together and it is the
hottest loop on the main thread. Velocities are carried because interpolation
needs them and the velocity overlay would otherwise need a second channel.

### Buffer ownership

Buffers ping-pong. The worker transfers a frame to the main thread; the main
thread transfers the consumed buffer back with a `recycle` message. A client
that stops recycling silently forces the worker to allocate every frame, so
recycling lives inside `FrameRing` rather than being left to callers.

Transferables, not `SharedArrayBuffer`, which is why the site needs no COOP or
COEP headers and stays embeddable.

## 6. Worker protocol

`MainToWorker` and `WorkerToMain` in `packages/protocol/src/messages.ts`. Every
live setting is its own message, so the worker never diffs state.

**Only `load` and `reset` restart anything.** Mass, velocity, position, G,
softening, dt, integrator, force model, theta and collision mode all apply to
the live state. Changing gravity mid-flight and watching what happens is the
product.

`engine.step()` returns the simulation time it actually advanced. Under the
adaptive integrator that is not `dt`, and a caller that assumes otherwise lets
simulation time run ahead of the integrator through every close encounter.

## 7. What a system is, versus where it has got to

The store keeps the scenario as a document describing the system at t = 0.

- Mass, radius, colour, lock and trail are part of what the system **is**. They
  are written to the document and survive a reset.
- Position and velocity are where it **has got to**. Dragging a body changes the
  live state only, so resetting puts it back where it started.

## 8. Integrator entry invariant

Accelerations must be valid for the current positions on entry to a step, and
every integrator leaves them valid on exit. This is what makes leapfrog cost one
force evaluation per step instead of two.

Any code that mutates positions, masses or lock flags **must** recompute before
the next step. `ReferenceEngine.refreshForces` is the reference for where those
calls belong, and anything that changes the force field or the step bound must
also call `Dopri5.restart`, since a carried step size is only valid for the
dynamics it was measured against.

## 9. Scenarios are canonical

Two scenarios describing the same system must be structurally identical, or
share links stop round-tripping and preset comparison breaks. `defineScenario`
enforces this:

- Negative zero normalises to zero. Generated initial conditions produce it
  constantly, and JSON does not preserve it.
- `locked: false` and `trail: false` are dropped, since absence means the same
  thing and only one of them survives a positional encoding.

Other rules:

- `mass` may be 0. Massless test particles are how restricted problems and
  asteroid swarms are expressed, and the direct kernel skips pairs where both
  are massless.
- `dt` may be negative. That is how time reversal is expressed.
- `softening` must be 0 for any preset tagged `periodic`. Any softening perturbs
  the potential and the orbits stop closing.
- `locked` bodies exert force but do not receive it.

Slot indices are **not** stable. Bodies are identified by `id` across the
protocol and by `handle` inside a frame. Removals swap the last slot down.

## 10. Camera `distance` is the visible half-height

In both modes. Not the eye distance: with a 50 degree field of view the visible
height at the target is 0.93 times the eye distance against 2 times the
orthographic half-height, so treating it as the orbit radius meant a scenario
framed flat showed less than half as much when switched to the orbiting camera.
The 3D eye distance is derived from it.

## 11. `noUncheckedIndexedAccess` is off

Deliberate. This codebase indexes `Float64Array` in hot numeric loops, where
TypeScript widens every element read to `number | undefined`. The resulting
non-null assertions would be noise on every line of the force kernels and would
hide real problems rather than expose them. Buffer lengths are enforced by the
protocol layer and asserted in tests instead.

---

## Appendix: pinned tooling

**TypeScript is pinned to `^6.0.3`, not 7.x.** `typescript-eslint` declares
`typescript: >=4.8.4 <6.1.0` and refuses to load against TypeScript 7, the
native Go rewrite; support is tracked in typescript-eslint#10940. A working
type-aware linter is worth more than the faster compiler, and moving to 7.x is a
one-line change per package once upstream lands.
