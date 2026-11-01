import type { FrameView } from './frame.ts';
import type {
  Body,
  BodyPatch,
  CollisionMode,
  ForceModelId,
  IntegratorId,
  Scenario,
} from './scenario.ts';

/**
 * What the UI and renderer are allowed to know about the engine.
 *
 * Both the TypeScript reference engine and the Rust/WASM engine satisfy this,
 * so swapping them is a one-line change in the app shell and neither the
 * renderer nor the UI can tell the difference. This is the seam that lets
 * Lane B replace the engine under Lanes C and E without coordinating.
 */
export interface EngineClient {
  /** Resolves once the worker has reported `ready`. */
  readonly ready: Promise<EngineHandshake>;

  load(scenario: Scenario): void;
  play(): void;
  pause(): void;
  stepOnce(steps?: number): void;
  reset(): void;

  setTimeScale(timeScale: number): void;
  setIntegrator(integrator: IntegratorId): void;
  setDt(dt: number): void;
  setTheta(theta: number): void;
  setForceModel(forceModel: ForceModelId): void;
  setCollisions(collisions: CollisionMode): void;
  setSoftening(softening: number): void;
  setG(G: number): void;

  patchBody(id: string, patch: BodyPatch): void;
  addBody(body: Body): void;
  removeBody(id: string): void;

  /** The live state as a shareable Scenario. */
  snapshot(): Promise<Scenario>;

  /**
   * Latest interpolated state, for the current wall-clock instant.
   *
   * Call this once per animation frame. It returns a view the caller must not
   * retain past the frame, and it allocates nothing.
   */
  sample(nowMs: number): FrameSample | null;

  onError(listener: (message: string, fatal: boolean) => void): () => void;

  dispose(): void;
}

export interface EngineHandshake {
  engine: 'reference' | 'wasm';
}

/**
 * An interpolated snapshot for one rendered frame.
 *
 * `positions` and `velocities` are interleaved f64 triples, already blended
 * between the two surrounding published frames. `handles` identifies each
 * slot, and `topologyVersion` increments whenever the set of bodies changed,
 * which tells the renderer to rebuild its per-body GPU state.
 */
export interface FrameSample {
  readonly count: number;
  readonly simTime: number;
  readonly positions: Float64Array;
  readonly velocities: Float64Array;
  readonly handles: Uint32Array;
  readonly topologyVersion: number;
  /** The most recent published frame, for header diagnostics. */
  readonly latest: FrameView;
}
