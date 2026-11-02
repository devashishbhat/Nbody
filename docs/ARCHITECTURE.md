# Architecture

## The shape of a frame

```
            WORKER THREAD                      MAIN THREAD
  ┌──────────────────────────────┐   ┌────────────────────────────────┐
  │  Engine                      │   │  FrameRing                     │
  │   direct sum or Barnes-Hut   │   │   3 slots, Hermite interpolate │
  │   leapfrog, Yoshida 4, or    │   │                                │
  │   adaptive Dormand-Prince    │   │  Renderer (WebGL2)             │
  │                              │   │   f64 -> f32 relative to the   │
  │  State lives here, always    │   │   camera origin, then upload   │
  │  ┌────────────────────────┐  │   │                                │
  │  │ fixed-step accumulator │  │   │  React shell                   │
  │  │ 10 ms budget / publish │  │   │   static chrome only           │
  │  └────────────────────────┘  │   └────────────────┬───────────────┘
  └──────────────┬───────────────┘                    │
                 │  frame buffer (transferred)        │
                 ├───────────────────────────────────>│
                 │<───────────────────────────────────┤
                    recycle (transferred back)
```

Three decisions do most of the work.

**Physics is decoupled from rendering.** The worker steps at a fixed `dt` on its
own schedule. The main thread renders at a fixed lag behind the newest frame and
interpolates. Neither waits for the other, and worker jitter never reaches the
screen.

**Interpolation is cubic Hermite, not linear.** Frames carry velocities, so the
interpolated path has the right curvature across the whole interval. A body on a
circular orbit does not flatten into a polygon at a low publish rate. This is
the single highest-leverage smoothness decision in the codebase.

**Buffers ping-pong and are transferred, never copied.** Steady state allocates
nothing on either side, and because these are transferables rather than
`SharedArrayBuffer`, the site needs no cross-origin isolation headers and stays
embeddable.

## Why these technologies

| Layer    | Choice                        | Reason                                                                    |
| -------- | ----------------------------- | ------------------------------------------------------------------------- |
| Physics  | TypeScript, f64, SoA          | Measured at 155 Mpair/s, which meets the frame budget. See below.         |
| Host     | Web Worker, transferables     | Physics off the main thread, no cross-origin isolation requirement.        |
| Renderer | Hand-written WebGL2           | The draw calls needed are few and specific.                               |
| UI       | React 19, Tailwind v4         | Static shell only.                                                        |
| Build    | pnpm workspaces, Vite         | One repo, independent packages, no build graph between libraries.          |
| Hosting  | Static, GitHub Pages          | Scenarios encode into the URL hash, so there is no server.                |

**Why not Rust and WebAssembly.** The original plan had the physics in a Rust
core compiled to WASM. Benchmarking the TypeScript engine first showed it
reaching 155 Mpair/s and already meeting the frame budget up to N = 2048. The
only gap was N = 5000, and that gap was algorithmic: direct summation needed 59
ms per force evaluation there, which no constant factor closes. Barnes-Hut
closed it in any language. Rust would still have bought headroom, but the
published evidence also shows WASM running slower than plain TypeScript when the
JS boundary is crossed often, so the win was not free either. The engine is
therefore TypeScript, and the seam that would have hidden a WASM engine is still
there if that changes.

**Why not WebGPU.** As of late 2026 Firefox ships it only on Windows and Apple
Silicon macOS; Linux and Android remain pre-release. WebGL2 is therefore the
primary and only renderer.

**Why not Three.js.** The renderer draws instanced points, line strips, a
full-screen grid quad and an optional two-pass bloom. A general scene graph
contributes nothing to that and costs bundle size and per-frame overhead.

## Where the smoothness comes from

Named explicitly because it is the product requirement most easily lost to
incremental change:

1. Fixed-step physics, decoupled from the display rate.
2. A three-deep frame ring rendered at 1.5 publish intervals of lag.
3. Cubic Hermite interpolation using the carried velocities.
4. Critically damped camera easing, with zoom eased in log space and anchored at
   the cursor.
5. A zero-allocation frame loop on both threads.
6. Fixed-width tabular figures in every readout.
7. `prefers-reduced-motion` honoured throughout.

Items 1 to 3 are in `packages/engine/src/host/ring.ts`. Item 4 is
`packages/renderer/src/camera.ts`. Item 5 is contract rule 4. Item 6 is
`packages/ui/src/format.ts`, whose tests assert width stability rather than
formatting correctness.

## Repository layout

```
packages/protocol     the shared contract: types, schema, frame layout, orbits
packages/engine       worker, client, interpolation ring, the physics engine
packages/renderer     WebGL2, camera, interaction-facing contracts
packages/scenarios    presets, procedural generators, share-link codec
packages/ui           design tokens, live-text primitive, controls
apps/web              the application: store, panels, interactions
tools/horizons        JPL ephemeris fetcher
tools/bench           throughput harness
tests/physics         cross-package fixtures: real engine over real presets
tests/e2e             Playwright
```

## Measured performance

From `pnpm bench` and the browser, on an Apple M4.

| N     | Model      | ms per force evaluation |
| ----- | ---------- | ----------------------- |
| 128   | direct     | 0.05                    |
| 1,024 | direct     | 3.4                     |
| 2,048 | direct     | 13.8                    |
| 5,000 | direct     | 59                      |
| 5,000 | Barnes-Hut | 18 at theta 0.5, 10 at theta 0.7 |

Every shipped preset holds 60 fps, including the 2,602-body galaxy flyby.

Headless CI reports lower frame rates because it rasterises in software through
SwiftShader. A fill-rate-bound measurement there says nothing about real
hardware, which is why the browser tests assert behaviour rather than frame
rate.
