/**
 * @nbody/engine
 *
 * The simulation host: the worker, the client that talks to it, the playback
 * interpolator, and the TypeScript reference engine.
 *
 * The engine runs entirely in TypeScript. Barnes-Hut closes the large-N gap
 * that direct summation could not, and the adaptive integrator covers the
 * close-encounter cases a fixed step gets wrong.
 */
export { createEngineClient, type EngineClientOptions, type WorkerLike } from './host/client.ts';
export { FrameRing, hermite, hermiteDerivative } from './host/ring.ts';

export { ReferenceEngine } from './reference/engine.ts';
export { RefState } from './reference/state.ts';
export { stepLeapfrog, stepYoshida4 } from './reference/integrators.ts';
export { computeAccelerations, type ForceField } from './reference/forces.ts';
export { BarnesHutTree } from './reference/barnes-hut.ts';
export { Dopri5 } from './reference/dopri5.ts';
export { computeDiagnostics, emptyDiagnostics, type Diagnostics } from './reference/diagnostics.ts';
export { resolveMerges } from './reference/collisions.ts';

export { createMockEngineClient, type MockEngineOptions } from './mock/orbits.ts';
