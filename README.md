# N-Body

An interactive gravitational N-body simulator for the web. Load the solar
system, a periodic three-body orbit or a two-thousand-body galaxy, then change
anything you like and watch what happens.

Twenty presets. Four of them are real JPL ephemeris data. Nothing restarts when
you edit it.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

```bash
pnpm verify         # format, lint, typecheck, unit tests
pnpm test:e2e       # Playwright, after pnpm build
pnpm bench          # engine throughput
```

Regenerate the ephemeris from JPL Horizons:

```bash
pnpm --filter @nbody/tool-horizons fetch
```

## What it does

**Watch.** Twenty systems, each with a sentence saying what it is and a second
saying what to look for. Real solar system data from JPL Horizons at 1 January
2026. Nine periodic three-body orbits, each verified to return to its starting
point after exactly one published period. Star clusters, a cold collapse, a
galaxy flyby that draws out tidal tails.

**Change.** Click a body to select it, drag it to move it, drag the tip of its
velocity arrow to aim it, shift-drag empty space to sling a new body into the
system. Mass, radius, colour, gravity, the integrator, the time step, softening,
the force model and the collision mode are all live. Undo and redo everything.

**Understand.** Energy drift, momentum and cost are on screen the whole time,
so you can see when a simulation stops being trustworthy. The selected body
shows its osculating orbital elements, which change as you perturb it, and its
predicted orbit can be drawn as you drag.

**Share.** Any system compresses into the URL. No server, no accounts, nothing
to operate.

## How it works

Physics runs in a Web Worker at a fixed step. The main thread renders at a fixed
lag behind the newest frame and interpolates with cubic Hermite splines, using
the velocities each frame carries, so worker jitter never reaches the screen.
Frame buffers are transferred and recycled rather than copied, so a running
simulation allocates nothing on either thread. React renders the static shell
only: every value that changes per frame is written straight to the DOM from
inside the animation frame.

Rendering is hand-written WebGL2. Bodies are instanced discs drawn from a signed
distance field, so they stay round and antialiased at any zoom. Trails are GPU
ring buffers. The reference grid is one full-screen quad that reconstructs a
world ray per fragment and snaps to whichever power of ten keeps cells near
ninety pixels.

Direct summation up to about two thousand bodies, a Barnes-Hut octree above
that. Leapfrog by default, Yoshida 4 for accuracy, and adaptive Dormand-Prince
for close encounters, where a fixed step is not merely less accurate but
actually wrong.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the choices, including why
the physics is TypeScript rather than Rust compiled to WebAssembly, which is
what the plan originally called for.

## Verification

261 unit tests and 17 browser tests.

The physics is checked against closed-form solutions and published results
rather than against itself: convergence order, bounded symplectic energy error,
exact momentum conservation, time reversal, Barnes-Hut converging to direct
summation as theta goes to zero, and every periodic orbit returning to its
starting configuration after one period. The solar system is checked against
reality: Earth comes out at 0.9834 AU and 30.28 km/s, and the barycentre lands
just outside the Sun's surface.

The browser tests cover selection, mass editing, undo, live setting changes,
zoom, slingshot spawning, the command palette, a share-link round trip and the
keyboard map.

[docs/PHYSICS.md](docs/PHYSICS.md) has the numbers.

## Performance

Measured on an Apple M4. Every preset holds 60 fps, including the 2,602-body
galaxy flyby. The engine reaches 155 Mpair/s on direct summation; Barnes-Hut
takes N = 5000 from 59 ms per force evaluation to 10 ms.

Headless CI reports lower frame rates because it rasterises in software, which
is why the browser tests assert behaviour rather than frame rate.

## Documentation

| Document                                | Contents                                           |
| --------------------------------------- | -------------------------------------------------- |
| [CONTRACTS.md](docs/CONTRACTS.md)       | Frozen interfaces and eleven rules. Read first.     |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Thread model, package graph, technology choices.    |
| [PHYSICS.md](docs/PHYSICS.md)           | Integrators, force models, units, verified results. |
| [DESIGN.md](docs/DESIGN.md)             | Visual language, layout, scale handling, motion.    |

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy.yml`. Enable Pages for the repository with "GitHub
Actions" as the source and it works with no further configuration: the workflow
sets the base path from the repository name, which the simulation worker's URL
depends on.

For any other static host, `pnpm build` writes `apps/web/dist`. Set `BASE_PATH`
if it is not served from the root.

## Layout

```
packages/protocol     the shared contract: types, schema, frame layout, orbits
packages/engine       worker, client, interpolation ring, the physics engine
packages/renderer     WebGL2, camera, interaction contracts
packages/scenarios    presets, procedural generators, share-link codec
packages/ui           design tokens, live-text primitive, controls
apps/web              the application: store, panels, interactions
tools/horizons        JPL ephemeris fetcher
tools/bench           throughput harness
tests/physics         cross-package fixtures: a real engine over real presets
tests/e2e             Playwright
```
