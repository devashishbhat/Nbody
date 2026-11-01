/**
 * @nbody/engine
 *
 * The simulation host: the worker, the client that talks to it, the playback
 * interpolator, and the TypeScript reference engine.
 *
 * The reference engine is not a placeholder to be deleted. It unblocks the
 * renderer and UI lanes now, and it stays as the parity oracle the Rust engine
 * is tested against, because an engine with no independent implementation to
 * disagree with has no way to be shown wrong.
 */
export { createEngineClient, type EngineClientOptions, type WorkerLike } from './host/client.ts';
export { FrameRing, hermite, hermiteDerivative } from './host/ring.ts';

export { ReferenceEngine } from './reference/engine.ts';
export { RefState } from './reference/state.ts';
export { computeAccelerations, stepLeapfrog, stepYoshida4 } from './reference/integrators.ts';
export { computeDiagnostics, emptyDiagnostics, type Diagnostics } from './reference/diagnostics.ts';
export { resolveMerges } from './reference/collisions.ts';

export { createMockEngineClient, type MockEngineOptions } from './mock/orbits.ts';
