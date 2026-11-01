/// <reference lib="webworker" />
import {
  allocateFrame,
  FrameView,
  frameByteLength,
  type MainToWorker,
  type WorkerToMain,
} from '@nbody/protocol';
import { ReferenceEngine } from './reference/engine.ts';

/**
 * Simulation worker.
 *
 * Owns the engine and the only copy of simulation state. The main thread never
 * sees a body array, only published frames, which is what keeps the JS/WASM
 * boundary cheap once the Rust engine replaces the reference one: state stays
 * on this side for the lifetime of a run and exactly one buffer crosses per
 * published frame.
 *
 * Lane B: replacing ReferenceEngine with the WASM engine should touch only the
 * `engine` binding and the `ready` handshake. Everything else here is engine
 * agnostic on purpose.
 */

const DEFAULT_PUBLISH_HZ = 60;

/**
 * Wall time a single publish may spend stepping.
 *
 * When the requested time scale needs more steps than this allows, the
 * simulation falls behind in sim time instead of blocking the worker. Falling
 * behind is visible and recoverable; a frozen worker is neither.
 */
const STEP_BUDGET_MS = 10;

/** Hard step ceiling per publish, as a second guard on pathological dt. */
const MAX_STEPS_PER_PUBLISH = 20_000;

/**
 * Longest wall delta that counts toward owed sim time.
 *
 * Without this, returning to a backgrounded tab would try to catch up on
 * minutes of simulation in one publish.
 */
const MAX_WALL_DELTA_MS = 100;

/** Spare frame buffers held for recycling. Two in flight plus one spare. */
const BUFFER_POOL_LIMIT = 3;

const engine = new ReferenceEngine();
const view = new FrameView(allocateFrame(0));

let running = false;
let loaded = false;
let publishIntervalMs = 1000 / DEFAULT_PUBLISH_HZ;
let timer: ReturnType<typeof setTimeout> | null = null;

let lastTickMs = 0;
let owedSimTime = 0;
let lastPublishSimTime = 0;
let msPerStep = 0;

const pool: ArrayBuffer[] = [];

function post(message: WorkerToMain, transfer?: Transferable[]): void {
  if (transfer) self.postMessage(message, transfer);
  else self.postMessage(message);
}

function reportError(error: unknown, fatal: boolean): void {
  post({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
    fatal,
  });
}

function takeBuffer(capacity: number): ArrayBuffer {
  const needed = frameByteLength(capacity);
  while (pool.length > 0) {
    const candidate = pool.pop()!;
    // A recycled buffer from before a capacity change is the wrong size. Drop
    // it rather than trying to reinterpret it.
    if (candidate.byteLength === needed) return candidate;
  }
  return allocateFrame(capacity);
}

function publish(): void {
  if (!loaded) return;

  const capacity = engine.state.capacity;
  const buffer = takeBuffer(capacity);
  view.bind(buffer);

  const publishDt = engine.simTime - lastPublishSimTime;
  lastPublishSimTime = engine.simTime;

  engine.writeFrame(view, publishDt, msPerStep, !running);

  if (engine.warning) {
    post({ type: 'error', message: engine.warning, fatal: false });
    engine.warning = null;
  }

  post({ type: 'frame', buffer }, [buffer]);
}

function advance(wallDeltaMs: number): void {
  const dt = engine.settings.dt;
  const stepMagnitude = Math.abs(dt);
  if (stepMagnitude === 0) return;

  // owedSimTime is a magnitude. A negative dt still consumes it, which is what
  // makes time reversal run at the same wall-clock rate as forward play.
  owedSimTime += (wallDeltaMs / 1000) * engine.settings.timeScale;

  const budgetStart = performance.now();
  let steps = 0;
  while (
    owedSimTime > 0 &&
    steps < MAX_STEPS_PER_PUBLISH &&
    performance.now() - budgetStart < STEP_BUDGET_MS
  ) {
    // The adaptive integrator decides its own step size, so the debt is
    // settled by what the engine actually advanced, not by the configured dt.
    // Subtracting dt here would let sim time run ahead of the integrator
    // through every close encounter.
    const advanced = engine.step();
    if (advanced === 0) break;
    owedSimTime -= Math.abs(advanced);
    steps++;
    if (engine.diverged) break;
  }

  if (steps > 0) {
    const elapsed = performance.now() - budgetStart;
    // Exponential smoothing, so the readout is stable enough to read.
    msPerStep = msPerStep === 0 ? elapsed / steps : msPerStep * 0.9 + (elapsed / steps) * 0.1;
  }

  // Do not bank unbounded debt: if the budget was exhausted, the simulation
  // runs slower than requested rather than accumulating a catch-up spike.
  if (owedSimTime > stepMagnitude * MAX_STEPS_PER_PUBLISH) {
    owedSimTime = stepMagnitude;
  }
  if (owedSimTime < 0) owedSimTime = 0;
}

function tick(): void {
  timer = null;
  const now = performance.now();
  const wallDelta = Math.min(now - lastTickMs, MAX_WALL_DELTA_MS);
  lastTickMs = now;

  try {
    if (running && loaded) advance(wallDelta);
    publish();
  } catch (error) {
    running = false;
    reportError(error, true);
    return;
  }

  schedule();
}

function schedule(): void {
  if (timer !== null) return;
  const elapsed = performance.now() - lastTickMs;
  timer = setTimeout(tick, Math.max(0, publishIntervalMs - elapsed));
}

function stopTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

self.onmessage = (event: MessageEvent<MainToWorker>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'init':
        publishIntervalMs = 1000 / Math.max(1, message.publishHz);
        post({ type: 'ready', engine: 'reference' });
        break;

      case 'load':
        engine.load(message.scenario);
        loaded = true;
        owedSimTime = 0;
        lastPublishSimTime = 0;
        msPerStep = 0;
        pool.length = 0;
        lastTickMs = performance.now();
        publish();
        schedule();
        break;

      case 'play':
        running = true;
        lastTickMs = performance.now();
        schedule();
        break;

      case 'pause':
        running = false;
        owedSimTime = 0;
        break;

      case 'stepOnce': {
        const steps = Math.max(1, Math.trunc(message.steps));
        for (let i = 0; i < steps && !engine.diverged; i++) engine.step();
        owedSimTime = 0;
        publish();
        break;
      }

      case 'reset':
        engine.reset();
        owedSimTime = 0;
        lastPublishSimTime = 0;
        publish();
        break;

      case 'setTimeScale':
        engine.applySettings({ timeScale: message.timeScale });
        break;
      case 'setIntegrator':
        engine.applySettings({ integrator: message.integrator });
        break;
      case 'setDt':
        engine.applySettings({ dt: message.dt });
        break;
      case 'setTheta':
        engine.applySettings({ theta: message.theta });
        break;
      case 'setForceModel':
        engine.applySettings({ forceModel: message.forceModel });
        break;
      case 'setCollisions':
        engine.applySettings({ collisions: message.collisions });
        break;
      case 'setSoftening':
        engine.applySettings({ softening: message.softening });
        break;
      case 'setG':
        engine.applySettings({ G: message.G });
        break;

      case 'patchBody':
        engine.patchBody(message.id, message.patch);
        break;
      case 'addBody':
        engine.addBody(message.body);
        break;
      case 'removeBody':
        engine.removeBody(message.id);
        break;

      case 'snapshot':
        post({ type: 'snapshot', requestId: message.requestId, scenario: engine.snapshot() });
        break;

      case 'recycle':
        if (pool.length < BUFFER_POOL_LIMIT) pool.push(message.buffer);
        break;

      case 'dispose':
        running = false;
        loaded = false;
        stopTimer();
        pool.length = 0;
        self.close();
        break;
    }
  } catch (error) {
    reportError(error, false);
  }
};
