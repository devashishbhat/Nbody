# Physics

## Integrators

| Integrator          | Role                                                | Force evals |
| ------------------- | --------------------------------------------------- | ----------- |
| `leapfrog`          | Default. Symplectic, time-symmetric.                | 1           |
| `yoshida4`          | Long accurate runs.                                 | 3           |
| `dopri5`            | Close encounters, collisions, chaotic few-body.     | 7           |

**Leapfrog** is kick-drift-kick velocity Verlet. Its energy error oscillates
with the orbit instead of accumulating, and it conserves momentum *exactly*
rather than approximately, because the pair loop computes one force per pair and
applies equal and opposite impulses. For a tool meant to be left running, that
bounded error matters more than raw order.

**Yoshida 4** composes three leapfrog steps with weights `w1, w0, w1` where
`w1 = 1/(2 - 2^(1/3))` and `w0 = -2^(1/3)/(2 - 2^(1/3))`. The negative middle
weight is what cancels the third-order error term. Measured: roughly a
thousandfold accuracy improvement over leapfrog at the same step size.

**Dormand-Prince 5(4)** is adaptive, and covers the one case where a fixed step
is not merely less accurate but actually wrong. Seven stages, a fifth-order
solution with an embedded fourth-order error estimate, and a standard step
controller. It treats the scenario's `dt` as an upper bound rather than the step
itself.

Two presets prove it earns its place:

- **Pythagorean three-body.** Against a brute-force symplectic reference it
  agrees to 1e-5, where leapfrog at the same nominal step is off by more than
  0.01. On a chaotic problem that is not slightly wrong, it is a different
  outcome.
- **Dragonfly.** Two bodies pass within 7.3e-3 of each other against separations
  near 1. At a fixed step of 1e-4 the orbit misses its own starting point by a
  tenth of the system's size. Adaptively it closes to 7e-4 in ten times fewer
  steps.

It is not symplectic and not time-symmetric, so energy drifts rather than
oscillating and reversing time under it is no longer exact.

### Deliberately excluded

**Gragg-Bulirsch-Stoer** was the original choice, following REBOUND's guidance
that an adaptive integrator is required for close encounters. It reaches higher
accuracy on smooth problems, but its order and step control is substantially
more intricate, and a subtly wrong step controller produces plausible-looking
trajectories that are wrong. Dormand-Prince 5(4) is in the same use class, is an
order of magnitude less code, and its behaviour is verifiable, which it is.

**WHFast** needs Jacobi coordinates and a dominant central mass, so it does not
generalise to clusters or to equal-mass choreographies, which are most of the
preset list.

**IAS15** is excellent but its Gauss-Radau predictor-corrector is
disproportionately fiddly for a visualisation tool that already has an adaptive
option.

### Time reversal is free

Both symplectic integrators are time-symmetric. Negate `dt` and the trajectory
retraces itself to round-off. Verified to 1e-11 over 5000 steps in
`packages/engine/src/reference/physics.test.ts`.

### Entry invariant

Accelerations must be valid for the current positions on entry to a step, and
every integrator leaves them valid on exit. This is what makes leapfrog cost one
force evaluation per step. Mutating positions, masses or lock flags obliges the
caller to recompute. See contract rule 8.

## Force models

**Direct** summation, O(N²), exploiting pair symmetry so each pair is visited
once. Plummer softening `1 / (r² + ε²)^(3/2)`.

**Barnes-Hut** octree, default `theta = 0.5`, rebuilt every force evaluation.
Leaves hold up to eight bodies rather than one, which took the N = 5000 tree
from roughly 20,000 nodes to 2,300. Subdivision stops at depth 24, past which a
leaf keeps a body chain, because coincident bodies are not hypothetical: they
are what a merge produces.

Profiling put 0.6 ms of the N = 5000 cost in the build and the rest in
traversal, which is interaction-bound rather than memory-bound since the whole
tree fits in L2. That leaves theta as the only real lever, and it is a steep
one:

| theta | ms at N=5000 | mean relative error | worst  |
| ----- | ------------ | ------------------- | ------ |
| 0.3   | 47           | 2e-3                |        |
| 0.5   | 18           | 6e-3                | 6e-2   |
| 0.7   | 10           | 1.4e-2              | 2.5e-1 |
| 1.0   | 4.6          | 3.9e-2              | 4e-1   |

So N = 5000 inside a 60 Hz frame wants theta near 0.7, not the 0.5 that suits a
few hundred bodies. For a cluster being looked at rather than measured a 1.4%
mean error is invisible, and presets above a couple of thousand bodies set theta
explicitly.

Direct summation skips pairs where both bodies are massless, since neither can
move the other. This is not a micro-optimisation: the Trojan preset is 520 test
particles and two massive bodies, so 99.2% of its pairs were pure waste.

`forceModel: 'auto'` picks direct below 2000 bodies and Barnes-Hut above, and
presets override it where they know better.

Budgeting a preset: the worker will spend about 600 ms per wall second
stepping, and the renderer needs the rest of the machine, so aim for roughly a
third of that. Steps per second is `timeScale / dt`, and the cost per step is in
the measured table in ARCHITECTURE.md.

### Measured baseline

The TypeScript reference engine, direct summation with leapfrog, on an Apple
Silicon laptop (`pnpm --filter @nbody/tool-bench bench`):

| N     | ms/step | Mpair/s | substeps per 60 Hz frame |
| ----- | ------- | ------- | ------------------------ |
| 128   | 0.052   | 155.7   | 319.3                    |
| 512   | 0.842   | 155.5   | 19.8                     |
| 1,024 | 3.393   | 154.4   | 4.9                      |
| 2,048 | 13.775  | 152.2   | 1.2                      |
| 5,000 | 97.210  | 128.6   | 0.2                      |

**This measurement is why the engine is TypeScript.** It already meets the
frame budget at N up to 2048. What it cannot do is N = 5000, where it is five
times over budget, and a gap that large does not close with a faster inner
loop: the work itself has to shrink. Barnes-Hut shrinks it, in any language.

A native core compiled to WebAssembly was the original plan, and was dropped
after this. It would still buy headroom at small N, and the seam it would slot
into is still there, but it was not what any preset needed.

### Softening

`ε = 0` is legal and is **required** for the periodic families. Any softening
perturbs the potential and the orbits stop closing. Asserted for every preset
tagged `periodic`.

Potential energy is computed with the *same* softening as the force kernel.
Reporting the unsoftened potential would describe an energy the integrator is
not conserving, and the drift readout would show a fault that does not exist.

## Units

| System    | G                      | Used by                        |
| --------- | ---------------------- | ------------------------------ |
| `solar`   | 2.959122082855911e-4   | solar system presets           |
| `si`      | 6.6743e-11             | available, unused by presets   |
| `natural` | 1                      | periodic few-body families     |

`G_SOLAR` is the IAU Gaussian gravitational constant `k = 0.01720209895`
squared, in AU³ / (M☉ · day²). Solar system scenarios use it because it keeps
positions, velocities and masses all within a few orders of magnitude of 1,
which is where f64 has the most headroom.

Nothing converts between systems. A scenario declares its units and every layer
reads values in that system.

## Collisions

Four modes. Which outcome is physically right is decided by one number: the
closing speed along the line of centres, against the mutual escape velocity

```
v_esc = sqrt( 2 G (m1 + m2) / (r1 + r2) )
```

Below it the pair cannot separate again whatever it does, so it accretes. This
is not a simplification: it is how planets were built. Above it the bodies
arrive with more than enough energy to leave, so they scatter.

| Mode        | Behaviour                                              |
| ----------- | ------------------------------------------------------ |
| `none`      | Pass through. The default.                              |
| `realistic` | Applies the escape-velocity test above.                 |
| `merge`     | Always accrete.                                         |
| `bounce`    | Always rebound.                                         |

**Merging** conserves mass, momentum and volume
(`r_merged = (r_i³ + r_j³)^(1/3)`). The heavier body keeps its identity
including its handle, so a trail being drawn for the dominant object continues
through the merge rather than jumping.

**Bouncing** applies an impulse along the line of centres, split by inverse
mass, so momentum is conserved exactly however unequal the pair. `restitution`
sets the fraction of closing speed that survives; 1 conserves kinetic energy
exactly, and real rock on rock is around 0.1 to 0.4. A pinned body and a
massless one both reduce to the same case, zero inverse mass: one side does not
respond and the other takes the whole velocity change, so a pinned planet does
not recoil from a dust grain. The pair is separated by a hair after the
impulse, or the same overlap is detected next step and it buzzes instead of
bouncing.

### What this does not model

A fast impact between real bodies shatters them. Fragmentation needs a strength
model, a debris size distribution and a way to create bodies mid-step, nearly
all of which would be invented rather than derived, so a super-escape impact
here scatters the bodies intact.

### Tunnelling

Contact is found by overlap, so a pair that crosses the whole contact distance
inside one step passes through undetected. The step needed to avoid that is
roughly the contact radius over the closing speed. The adaptive integrator does
not help, since it watches the smoothness of the gravitational field rather
than the geometry.

### Energy drift with collisions on

Merging is inelastic and so is any bounce below perfect restitution, so both
genuinely remove energy. The drift baseline is therefore reset whenever a
collision resolves, and the readout means the integration error since the
system last changed. Without that it climbs to 1e-2 on a preset working
exactly as intended.

## Verified results

Everything below is asserted in the test suite, not claimed.

### Integrators

| Case                                           | Result                       |
| ---------------------------------------------- | ---------------------------- |
| Circular binary, closed-form energy            | exact to 1e-12               |
| Circular binary, yoshida4 over one period      | position error < 1e-9        |
| Leapfrog energy drift over 1000 orbits         | < 1e-6, bounded not drifting |
| Leapfrog momentum and centre of mass           | < 1e-14 over 10,000 steps    |
| Leapfrog convergence order                     | 2 (error ratio 3.5 to 4.5)   |
| Yoshida 4 convergence order                    | 4 (error ratio 14 to 18)     |
| Time reversal, 5000 steps each way             | < 1e-11                      |
| Dormand-Prince against a brute-force reference | < 1e-5 on the Pythagorean problem |
| Dormand-Prince versus a fixed step of the same size | 1000x more accurate     |

### Barnes-Hut

| Case                                   | Result                                |
| -------------------------------------- | ------------------------------------- |
| theta to zero                          | converges to direct summation, < 1e-12 |
| theta 0.5, N = 1000                    | worst relative error < 5%             |
| theta 0.2, N = 1000                    | worst relative error < 0.5%           |
| Two bodies                             | matches direct summation to 1e-14     |
| Twelve coincident bodies               | terminates, stays finite              |

### Periodic orbits

Each is integrated for exactly one published period and every body's distance
from its starting point is measured.

| Orbit                   | Return error |
| ----------------------- | ------------ |
| Lagrange triangle       | < 1e-10      |
| Figure-eight            | 4.1e-8       |
| Butterfly, moth, yin-yang, goggles, dragonfly | 2e-4 to 9e-4 |

The three-body catalogue orbits are limited by their published five-decimal
velocities, not by the integration, which is good to about 1e-13. The Lagrange
triangle is derived rather than transcribed, so it has no such floor, and its
side lengths are also checked to be constant throughout rather than merely at
the end of a period.

### Solar system

| Case                                        | Result               |
| ------------------------------------------- | -------------------- |
| Centre-of-mass speed at t = 0               | 2.3e-11 AU/day       |
| Earth-Sun distance                          | 0.9834 AU            |
| Earth speed relative to the Sun             | 30.28 km/s           |
| Barycentre distance from the Sun's centre   | 0.0063 AU, just outside its surface |
| Earth's return after one year               | < 5e-3 AU on a 6.3 AU path |
| Energy drift, years 1 to 20 versus 21 to 40 | envelope flat, not growing |
| Trojan clouds over 14 Jupiter orbits        | librate about their points, never circulate |

### A note on the figure-eight

Its return error plateaus at about 4.1e-8 and does **not** improve with smaller
`dt`, for either integrator. That floor is the published initial conditions and
period, given to eight or nine significant figures; refining the period to
6.32591403 brings it to 2.2e-8.

This matters for anyone tightening the test: 4e-8 is the data, not the code. It
also means `dt` must divide the period exactly, because `round(P/dt) * dt` falls
short by up to half a step, which at order-unity speeds is a 1e-5 position error
that swamps everything real.
