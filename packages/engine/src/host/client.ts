import {
  isWorkerMessage,
  type Body,
  type BodyPatch,
  type CollisionMode,
  type EngineClient,
  type EngineHandshake,
  type ForceModelId,
  type FrameSample,
  type IntegratorId,
  type MainToWorker,
  type Scenario,
} from '@nbody/protocol';
import { FrameRing } from './ring.ts';

/** The subset of Worker this client needs, so tests can supply a fake. */
export interface WorkerLike {
  postMessage(message: MainToWorker, transfer?: Transferable[]): void;
  terminate?(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror?: ((event: unknown) => void) | null;
}

export interface EngineClientOptions {
  /** Injectable for tests and for hosting the engine somewhere else. */
  worker?: WorkerLike;
  /** Frames per second the worker should publish. Defaults to 60. */
  publishHz?: number;
}

function defaultWorker(): WorkerLike {
  // Vite rewrites this at build time. The engine package is consumed as
  // TypeScript source, so there is no separate worker build step.
  return new Worker(new URL('../worker.ts', import.meta.url), {
    type: 'module',
    name: 'nbody-sim',
  }) as unknown as WorkerLike;
}

/**
 * Client-side half of the engine.
 *
 * Holds the playback ring, forwards control messages, and returns the
 * consumed frame buffers so the worker can write into them again. A client
 * that stopped recycling would silently force the worker to allocate a fresh
 * buffer every frame, so recycling happens inside the ring rather than being
 * left to the caller.
 */
export function createEngineClient(options: EngineClientOptions = {}): EngineClient {
  const worker = options.worker ?? defaultWorker();
  const publishHz = options.publishHz ?? 60;

  const errorListeners = new Set<(message: string, fatal: boolean) => void>();
  const pendingSnapshots = new Map<number, (scenario: Scenario) => void>();
  let nextRequestId = 1;
  let disposed = false;

  const ring = new FrameRing((buffer) => {
    if (disposed) return;
    worker.postMessage({ type: 'recycle', buffer }, [buffer]);
  });

  let resolveReady: (handshake: EngineHandshake) => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<EngineHandshake>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  function send(message: MainToWorker): void {
    if (disposed) return;
    worker.postMessage(message);
  }

  worker.onmessage = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (!isWorkerMessage(message)) return;

    switch (message.type) {
      case 'ready':
        resolveReady({ engine: message.engine });
        break;
      case 'frame':
        ring.push(message.buffer);
        break;
      case 'snapshot': {
        const resolve = pendingSnapshots.get(message.requestId);
        if (resolve) {
          pendingSnapshots.delete(message.requestId);
          resolve(message.scenario);
        }
        break;
      }
      case 'error':
        if (message.fatal) rejectReady(new Error(message.message));
        for (const listener of errorListeners) listener(message.message, message.fatal);
        break;
    }
  };

  if (worker.onerror !== undefined) {
    worker.onerror = (event: unknown) => {
      const message = event instanceof ErrorEvent ? event.message : 'simulation worker failed';
      rejectReady(new Error(message));
      for (const listener of errorListeners) listener(message, true);
    };
  }

  send({ type: 'init', publishHz });

  return {
    ready,

    load(scenario: Scenario): void {
      ring.clear();
      ring.timeScale = scenario.timeScale;
      send({ type: 'load', scenario });
    },
    play: () => send({ type: 'play' }),
    pause: () => send({ type: 'pause' }),
    stepOnce: (steps = 1) => send({ type: 'stepOnce', steps }),
    reset: () => send({ type: 'reset' }),

    setTimeScale(timeScale: number): void {
      // The ring advances its playback clock in sim time, so it has to learn
      // the new rate at the same moment the worker does.
      ring.timeScale = timeScale;
      send({ type: 'setTimeScale', timeScale });
    },
    setIntegrator: (integrator: IntegratorId) => send({ type: 'setIntegrator', integrator }),
    setDt: (dt: number) => send({ type: 'setDt', dt }),
    setTheta: (theta: number) => send({ type: 'setTheta', theta }),
    setForceModel: (forceModel: ForceModelId) => send({ type: 'setForceModel', forceModel }),
    setCollisions: (collisions: CollisionMode) => send({ type: 'setCollisions', collisions }),
    setRestitution: (restitution: number) => send({ type: 'setRestitution', restitution }),
    setSoftening: (softening: number) => send({ type: 'setSoftening', softening }),
    setG: (G: number) => send({ type: 'setG', G }),

    patchBody: (id: string, patch: BodyPatch) => send({ type: 'patchBody', id, patch }),
    addBody: (body: Body) => send({ type: 'addBody', body }),
    removeBody: (id: string) => send({ type: 'removeBody', id }),

    snapshot(): Promise<Scenario> {
      const requestId = nextRequestId++;
      return new Promise<Scenario>((resolve, reject) => {
        if (disposed) {
          reject(new Error('engine client disposed'));
          return;
        }
        pendingSnapshots.set(requestId, resolve);
        send({ type: 'snapshot', requestId });
      });
    },

    sample(nowMs: number): FrameSample | null {
      return ring.sample(nowMs);
    },

    onError(listener: (message: string, fatal: boolean) => void): () => void {
      errorListeners.add(listener);
      return () => errorListeners.delete(listener);
    },

    dispose(): void {
      if (disposed) return;
      send({ type: 'dispose' });
      disposed = true;
      errorListeners.clear();
      pendingSnapshots.clear();
      worker.onmessage = null;
      worker.terminate?.();
    },
  };
}
