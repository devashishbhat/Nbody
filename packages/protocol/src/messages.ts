import type {
  Body,
  BodyPatch,
  CollisionMode,
  ForceModelId,
  IntegratorId,
  Scenario,
} from './scenario.ts';

/**
 * Worker message protocol.
 *
 * Every setting that can change live is its own message rather than a generic
 * `patch` so that the worker never has to diff state, and so that a lane
 * adding a setting is forced to think about whether it can be applied without
 * a reset.
 *
 * Settings messages apply to the LIVE state. Nothing here restarts the
 * simulation except `load` and `reset`. That is the whole point: raising
 * Jupiter's mass mid-flight has to work.
 */
export type MainToWorker =
  | { type: 'init'; publishHz: number }
  | { type: 'load'; scenario: Scenario }
  | { type: 'play' }
  | { type: 'pause' }
  /** Advance exactly `steps` integrator steps while paused. */
  | { type: 'stepOnce'; steps: number }
  | { type: 'setTimeScale'; timeScale: number }
  | { type: 'setIntegrator'; integrator: IntegratorId }
  /** Negative dt runs the simulation backwards. */
  | { type: 'setDt'; dt: number }
  | { type: 'setTheta'; theta: number }
  | { type: 'setForceModel'; forceModel: ForceModelId }
  | { type: 'setCollisions'; collisions: CollisionMode }
  | { type: 'setRestitution'; restitution: number }
  | { type: 'setSoftening'; softening: number }
  | { type: 'setG'; G: number }
  | { type: 'patchBody'; id: string; patch: BodyPatch }
  | { type: 'addBody'; body: Body }
  | { type: 'removeBody'; id: string }
  /** Restores the loaded scenario at t=0, including any live setting edits. */
  | { type: 'reset' }
  /** Asks for the live state as a Scenario, for sharing or download. */
  | { type: 'snapshot'; requestId: number }
  /**
   * Returns a consumed frame buffer so the worker can write into it again.
   * This is what makes the frame path allocation-free. A client that never
   * recycles forces the worker to allocate a fresh buffer every frame.
   */
  | { type: 'recycle'; buffer: ArrayBuffer }
  | { type: 'dispose' };

export type EngineKind = 'reference' | 'wasm';

export type WorkerToMain =
  | { type: 'ready'; engine: EngineKind }
  | { type: 'frame'; buffer: ArrayBuffer }
  | { type: 'snapshot'; requestId: number; scenario: Scenario }
  | { type: 'error'; message: string; fatal: boolean };

/** Narrowing helper, so neither side reaches for `as`. */
export function isWorkerMessage(value: unknown): value is WorkerToMain {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}
