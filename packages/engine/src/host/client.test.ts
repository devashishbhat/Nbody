import {
  allocateFrame,
  BODY_STRIDE,
  defineScenario,
  H,
  type MainToWorker,
  type Scenario,
  type WorkerToMain,
} from '@nbody/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEngineClient } from './client.ts';
import type { WorkerLike } from './client.ts';

/** Records what the client sends and lets a test reply as the worker would. */
class FakeWorker implements WorkerLike {
  sent: MainToWorker[] = [];
  transfers: (Transferable[] | undefined)[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  terminated = false;

  postMessage(message: MainToWorker, transfer?: Transferable[]): void {
    this.sent.push(message);
    this.transfers.push(transfer);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: WorkerToMain): void {
    this.onmessage?.({ data: message } as MessageEvent);
  }

  typesSent(): string[] {
    return this.sent.map((m) => m.type);
  }
}

function scenario(): Scenario {
  return defineScenario({
    id: 'two',
    name: 'Two',
    description: '',
    units: 'natural',
    dt: 1e-3,
    timeScale: 4,
    bodies: [
      { name: 'A', mass: 1, radius: 0, position: [0, 0, 0], velocity: [0, 0, 0] },
      { name: 'B', mass: 1, radius: 0, position: [1, 0, 0], velocity: [0, 1, 0] },
    ],
  });
}

function frame(simTime: number, sequence: number, x: number): ArrayBuffer {
  const capacity = 4;
  const buffer = allocateFrame(capacity);
  const header = new Float64Array(buffer, 0, 16);
  header[H.simTime] = simTime;
  header[H.sequence] = sequence;
  header[H.publishDt] = 1 / 60;
  header[H.bodyCount] = 1;
  header[H.energy0] = -1;
  header[H.energy] = -1;
  new Float64Array(buffer, 128, capacity * BODY_STRIDE)[0] = x;
  return buffer;
}

describe('engine client', () => {
  let worker: FakeWorker;

  beforeEach(() => {
    worker = new FakeWorker();
  });

  it('sends init with the requested publish rate', () => {
    createEngineClient({ worker, publishHz: 120 });
    expect(worker.sent[0]).toEqual({ type: 'init', publishHz: 120 });
  });

  it('resolves ready on the handshake and reports which engine answered', async () => {
    const client = createEngineClient({ worker });
    worker.reply({ type: 'ready', engine: 'reference' });
    await expect(client.ready).resolves.toEqual({ engine: 'reference' });
  });

  it('adopts the scenario time scale so playback matches the worker', () => {
    const client = createEngineClient({ worker });
    client.load(scenario());
    // A mismatch here would make the interpolated clock drift against the
    // worker's sim time and force a visible correction every frame.
    client.setTimeScale(9);
    expect(worker.sent.at(-1)).toEqual({ type: 'setTimeScale', timeScale: 9 });
  });

  it('exposes published frames through sample', () => {
    const client = createEngineClient({ worker });
    client.load(scenario());
    expect(client.sample(0)).toBeNull();

    worker.reply({ type: 'frame', buffer: frame(0, 1, 7) });
    const sample = client.sample(0)!;
    expect(sample.count).toBe(1);
    expect(sample.positions[0]).toBe(7);
  });

  it('returns consumed buffers to the worker so it never has to allocate', () => {
    const client = createEngineClient({ worker });
    client.load(scenario());
    for (let i = 0; i < 5; i++) {
      worker.reply({ type: 'frame', buffer: frame(i / 60, i + 1, i) });
    }

    const recycles = worker.sent.filter((m) => m.type === 'recycle');
    expect(recycles.length).toBeGreaterThan(0);
    // Recycled buffers must be transferred, not copied.
    const index = worker.sent.findIndex((m) => m.type === 'recycle');
    expect(worker.transfers[index]).toHaveLength(1);
  });

  it('round-trips a snapshot request by id', async () => {
    const client = createEngineClient({ worker });
    const pending = client.snapshot();
    const request = worker.sent.at(-1);
    expect(request?.type).toBe('snapshot');

    const result = scenario();
    worker.reply({
      type: 'snapshot',
      requestId: (request as { requestId: number }).requestId,
      scenario: result,
    });

    await expect(pending).resolves.toEqual(result);
  });

  it('reports non-fatal worker warnings without rejecting ready', async () => {
    const client = createEngineClient({ worker });
    const seen: [string, boolean][] = [];
    client.onError((message, fatal) => seen.push([message, fatal]));

    worker.reply({ type: 'ready', engine: 'reference' });
    worker.reply({ type: 'error', message: 'approximated something', fatal: false });

    await expect(client.ready).resolves.toBeDefined();
    expect(seen).toEqual([['approximated something', false]]);
  });

  it('forwards every live setting without reloading the scenario', () => {
    const client = createEngineClient({ worker });
    client.load(scenario());
    const before = worker.sent.length;

    client.setG(2);
    client.setDt(-1e-3);
    client.setSoftening(0.01);
    client.setIntegrator('yoshida4');
    client.setForceModel('barnes-hut');
    client.setTheta(0.7);
    client.setCollisions('merge');
    client.patchBody('a', { mass: 50 });

    const after = worker.sent.slice(before).map((m) => m.type);
    expect(after).toEqual([
      'setG',
      'setDt',
      'setSoftening',
      'setIntegrator',
      'setForceModel',
      'setTheta',
      'setCollisions',
      'patchBody',
    ]);
    // Nothing above is allowed to imply a reload.
    expect(after).not.toContain('load');
    expect(after).not.toContain('reset');
  });

  it('stops talking to the worker after dispose', () => {
    const client = createEngineClient({ worker });
    client.dispose();
    const count = worker.sent.length;

    client.play();
    client.setG(5);

    expect(worker.sent.length).toBe(count);
    expect(worker.typesSent().at(-1)).toBe('dispose');
    expect(worker.terminated).toBe(true);
  });
});
