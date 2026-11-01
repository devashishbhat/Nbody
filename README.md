# N-Body

An interactive gravitational N-body simulator for the web. Load the solar
system or a classic three-body orbit, then change any body's mass, velocity or
position and watch what happens.

Three things define it: a minimalist interface, motion that feels genuinely
smooth, and real editable physics rather than a canned animation.

## Status: Phase 0 complete

The shared contract, the simulation host and a working vertical slice exist.
Five lanes can now proceed in parallel. See **[docs/AGENTS.md](docs/AGENTS.md)**
for who owns what and what to build next.

| Area                            | State                                                                 |
| ------------------------------- | --------------------------------------------------------------------- |
| Contract (`@nbody/protocol`)    | Done. Frozen. 34 tests.                                               |
| Engine host (`@nbody/engine`)   | Worker, client, Hermite interpolator, TS reference engine. 43 tests.   |
| Physics (`crates/nbody-core`)   | Traits, SoA state, direct kernel, leapfrog, yoshida4. **Uncompiled.**  |
| WASM boundary                   | Layout constants and the build plan only.                             |
| Renderer (`@nbody/renderer`)    | Contracts fixed. Provisional Canvas2D; WebGL2 is Lane C's.             |
| Scenarios (`@nbody/scenarios`)  | 5 presets, real JPL ephemeris. Codec and the rest are Lane D's.        |
| UI (`@nbody/ui`, `apps/web`)    | Tokens, live-text primitive, formatters, provisional shell.           |

**The Rust workspace has never been compiled**: no toolchain was installed in
the environment where Phase 0 was written. Lane A's first task is to install
`rustup` and run `cargo test --workspace`, expecting to fix small compile
errors.

Everything else is verified: 101 unit tests and 5 Playwright tests pass, and
the app builds and runs.

## Quick start

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

```bash
pnpm verify         # format, lint, typecheck, unit tests
pnpm test           # unit tests only
pnpm test:e2e       # Playwright, needs `pnpm build` first
pnpm test:rust      # needs rustup, see above
pnpm build:wasm     # needs rustup and wasm-pack
```

Regenerate the solar system ephemeris from JPL Horizons:

```bash
pnpm --filter @nbody/tool-horizons fetch
```

## How it works

Physics runs in a Web Worker at a fixed step. The main thread renders at a
fixed lag behind the newest frame and interpolates with cubic Hermite splines,
using the velocities the frame carries. Frame buffers are transferred and
recycled, so a running simulation allocates nothing on either thread. React
renders the static shell only; anything that changes per frame is written
straight to the DOM from inside the animation frame.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains why, including why not
WebGPU and why not Three.js.

## Documentation

| Document                                     | Contents                                                      |
| -------------------------------------------- | ------------------------------------------------------------- |
| [CONTRACTS.md](docs/CONTRACTS.md)            | Frozen interfaces and eleven rules. **Read first.**            |
| [AGENTS.md](docs/AGENTS.md)                  | Lane ownership, working rules, what each lane builds next.     |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)      | Thread model, package graph, technology choices.               |
| [PHYSICS.md](docs/PHYSICS.md)                | Integrators, force models, units, verified results.            |
| [DESIGN.md](docs/DESIGN.md)                  | Visual language, layout, scale handling, motion.               |

## Layout

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
tests/physics         cross-package physics fixtures     shared
tests/e2e             Playwright                         shared
```

## Stack

Rust compiled to WebAssembly for the physics, hand-written WebGL2 for
rendering, React 19 and Tailwind v4 for the shell, Vite, pnpm and Cargo
workspaces, deployed as a static site. No server: scenarios encode into the URL
hash.
