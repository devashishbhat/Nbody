# Physics

## Integrators

| Integrator          | Role                                                | Force evals |
| ------------------- | --------------------------------------------------- | ----------- |
| `leapfrog`          | Default. Symplectic, time-symmetric.                | 1           |
| `yoshida4`          | Long accurate runs.                                 | 3           |
| `bulirsch-stoer`    | Close encounters, collisions, chaotic few-body.     | variable    |

**Leapfrog** is kick-drift-kick velocity Verlet. Its energy error oscillates
with the orbit instead of accumulating, and it conserves momentum *exactly*
rather than approximately, because the pair loop computes one force per pair and
applies equal and opposite impulses. For a tool meant to be left running, that
bounded error matters more than raw order.

**Yoshida 4** composes three leapfrog steps with weights `w1, w0, w1` where
`w1 = 1/(2 - 2^(1/3))` and `w0 = -2^(1/3)/(2 - 2^(1/3))`. The negative middle
weight is what cancels the third-order error term. Measured: roughly a
thousandfold accuracy improvement over leapfrog at the same step size.

**Bulirsch-Stoer** is adaptive and is the one case where a fixed step is not
merely less accurate but actually wrong. REBOUND's own documentation is explicit
that a fixed-step symplectic method is the wrong tool when close encounters
occur. The Pythagorean preset is the case in point.

### Deliberately excluded

**WHFast** needs Jacobi coordinates and a dominant central mass, so it does not
generalise to clusters or to equal-mass choreographies, which are half the
preset list.

**IAS15** is excellent but its Gauss-Radau predictor-corrector is
disproportionately fiddly to implement correctly for a visualisation tool that
already has an adaptive option.

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

**Barnes-Hut** octree, default `theta = 0.5`, built per step from Morton-sorted
indices. Lane A.

`forceModel: 'auto'` picks direct below 2000 bodies and Barnes-Hut above.
Targets at 60 Hz:

| N      | Model       | Budget                        |
| ------ | ----------- | ----------------------------- |
| ≤ 512  | direct      | 8 or more substeps per frame  |
| 2,000  | direct      | 1 to 2 substeps per frame     |
| 5,000  | Barnes-Hut  | 1 substep per frame           |

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

**This changes the priority order for Lane A.** Plain TypeScript already meets
the targets at N ≤ 2048. What it cannot do is N = 5000, where it is five times
over budget and no amount of SIMD closes a gap that large: the work itself has
to shrink.

So Barnes-Hut is the critical piece, not the SIMD kernel. SIMD buys headroom
for more substeps at small N, which is worth having but is not what unblocks a
preset. Build the octree first.

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

Optional merge-on-contact, conserving mass, momentum and volume
(`r_merged = (r_i³ + r_j³)^(1/3)`). The **heavier** body keeps its identity
including its handle, so a trail being drawn for the dominant object continues
through the merge rather than jumping.

## Verified results

From `packages/engine/src/reference/physics.test.ts`, all passing:

| Case                                           | Result                        |
| ---------------------------------------------- | ----------------------------- |
| Circular binary, closed-form energy            | exact to 1e-12                |
| Circular binary, yoshida4 over one period      | position error < 1e-9         |
| Leapfrog energy drift over 1000 orbits         | < 1e-6, bounded not drifting  |
| Leapfrog momentum and COM over 10,000 steps    | < 1e-14                       |
| Leapfrog convergence order                     | 2 (error ratio 3.5 to 4.5)    |
| Yoshida4 convergence order                     | 4 (error ratio 14 to 18)      |
| Time reversal, 5000 steps each way             | < 1e-11                       |
| Figure-eight return after one period           | < 1e-7                        |
| Figure-eight energy drift over one period      | < 1e-10                       |

### A note on the figure-eight

The return error plateaus at about 4.1e-8 and does **not** improve with smaller
`dt`, for either integrator. That floor is the published initial conditions and
period, which are given to eight or nine significant figures; refining the
period to 6.32591403 brings it to 2.2e-8. The integration itself is good to
about 1e-13.

This matters for anyone tightening the test: 4e-8 is the data, not the code. It
also means `dt` must be chosen to divide the period exactly, because
`round(P/dt) * dt` falls short of the true period by up to half a step, which at
order-unity speeds shows up as a 1e-5 position error and swamps everything real.
