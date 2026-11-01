# Architecture

## The shape of a frame

```
            WORKER THREAD                      MAIN THREAD
  ┌──────────────────────────────┐   ┌────────────────────────────────┐
  │  nbody-core (Rust/WASM)      │   │  FrameRing                     │
  │  or ReferenceEngine (TS)     │   │   3 slots, Hermite interpolate │
  │                              │   │                                │
  │  State lives here, always    │   │  Renderer (WebGL2)             │
  │  ┌────────────────────────┐  │   │   f64 -> f32 relative to the   │
  │  │ fixed-step accumulator │  │   │   camera origin, then upload   │
  │  │ 10 ms budget / publish │  │   │                                │
  │  └────────────────────────┘  │   │  React shell                   │
  └──────────────┬───────────────┘   │   static chrome only           │
                 │                   └────────────────┬───────────────┘
                 │  frame buffer (transferred)        │
                 ├───────────────────────────────────>│
                 │<───────────────────────────────────┤
                    recycle (transferred back)
```

Three decisions do most of the work.

**Physics is decoupled from rendering.** The worker steps at a fixed `dt` on
its own schedule. The main thread renders at a fixed lag behind the newest
frame and interpolates. Neither one waits for the other, and worker jitter
never reaches the screen.

**Interpolation is cubic Hermite, not linear.** Frames carry velocities, so the
interpolated path has the right curvature across the whole interval. A body on
a circular orbit does not flatten into a polygon at a low publish rate. This is
the single highest-leverage smoothness decision in the codebase.

**Buffers ping-pong and are transferred, never copied.** The main thread hands
each consumed buffer back. Steady state allocates nothing on either side, and
because these are transferables rather than `SharedArrayBuffer`, the site needs
no COOP/COEP headers and stays embeddable.

## Why these technologies

| Layer      | Choice                     | Reason                                                                                                                              |
| ---------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Physics    | Rust, f64, SoA, 128-bit SIMD | Fast, and testable without a browser. Independently benchmarkable.                                                                   |
| Boundary   | `wasm-bindgen`, `wasm-pack`  | Standard path. State stays in WASM memory; see contract rule 5.                                                                      |
| Host       | Web Worker, transferables    | Physics off the main thread, no cross-origin isolation requirement.                                                                 |
| Renderer   | Hand-written WebGL2          | The draw calls needed are few and specific. A scene graph adds bundle weight and per-frame overhead for nothing.                     |
| UI         | React 19, Tailwind v4        | Static shell only. Deepest ecosystem, most predictable for parallel agents.                                                         |
| Build      | pnpm + Cargo workspaces      | One repo, independent packages, five lanes.                                                                                         |
| Hosting    | Static, Cloudflare Pages     | Scenarios encode into the URL hash, so there is no server, no database and nothing to operate.                                       |

**Why not WebGPU.** As of late 2026 Firefox ships it only on Windows and Apple
Silicon macOS; Linux and Android remain pre-release. WebGL2 is therefore the
primary and only renderer, which also independently settles the decision not to
build a GPU compute path.

**Why not Three.js.** The renderer draws instanced points, line strips, a
full-screen grid quad and an optional two-pass bloom. A general scene graph
contributes nothing to that and costs bundle size and per-frame overhead.

## Package graph

```
protocol ──┬── engine ──┐
           ├── renderer ─┼── web
           ├── scenarios ┤
           └── ui ───────┘
```

`protocol` imports nothing from the project. Everything else imports `protocol`
and, apart from `web`, nothing else internal. Library packages are consumed as
TypeScript source with no build step, so no lane waits on another's compile.

## Where the smoothness comes from

Named explicitly because it is the product requirement most easily lost to
incremental change:

1. Fixed-step physics, decoupled from the display rate.
2. A three-deep frame ring rendered at 1.5 publish intervals of lag.
3. Cubic Hermite interpolation using the carried velocities.
4. Critically damped camera springs, exponential zoom anchored at the cursor.
5. A zero-allocation frame loop on both threads.
6. Fixed-width tabular figures in every readout.
7. `prefers-reduced-motion` honoured throughout.

Items 1 to 3 are implemented in `packages/engine/src/host/ring.ts`. Item 5 is
contract rule 4. Item 6 is `packages/ui/src/format.ts`, whose tests assert
width stability rather than formatting correctness.

## Repository layout

```
crates/nbody-core     physics, no WASM dependency       Lane A
crates/nbody-wasm     the boundary, nothing else        Lane B
packages/protocol     the frozen contract               shared
packages/engine       worker, client, ring, reference   Lane B
packages/renderer     WebGL2                            Lane C
packages/scenarios    presets, generators, codec        Lane D
packages/ui           tokens and primitives             Lane E
apps/web              Vite shell                        Lane E
tools/horizons        ephemeris fetcher                  Lane D
tools/bench           benchmark harness                  Lane A
tests/e2e             Playwright                         shared
```
