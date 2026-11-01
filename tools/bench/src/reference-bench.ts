/**
 * Baseline throughput for the TypeScript reference engine.
 *
 *   node tools/bench/src/reference-bench.ts
 *
 * This is the number the Rust core has to beat, and the reason it exists as a
 * committed harness rather than a one-off script: the entire justification for
 * a WASM physics core is a measured speedup, and published cases exist where a
 * Rust/WASM port ran slower than the TypeScript it replaced because of bridge
 * overhead. If the measured gain is small, the boundary is wrong rather than
 * the language.
 *
 * LANE A: mirror these sizes in the criterion benches and commit both sets of
 * baselines. The budget being defended is in docs/PHYSICS.md.
 */
import { ReferenceEngine } from '@nbody/engine';
import { defineScenario, type Scenario } from '@nbody/protocol';

const SIZES = [128, 512, 1024, 2048, 5000];

/** A virialised-ish random cloud. Representative of the collective presets. */
function cloud(n: number): Scenario {
  // Deterministic, so runs are comparable across machines and commits.
  let seed = 0x2f6e2b1;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };

  const bodies = Array.from({ length: n }, (_, i) => {
    const r = Math.cbrt(random()) * 10;
    const theta = Math.acos(2 * random() - 1);
    const phi = random() * Math.PI * 2;
    const speed = 0.08 * Math.sqrt(n / 1000);
    return {
      name: `b${i}`,
      mass: 1 / n,
      radius: 0,
      position: [
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.sin(theta) * Math.sin(phi),
        r * Math.cos(theta),
      ] as [number, number, number],
      velocity: [(random() - 0.5) * speed, (random() - 0.5) * speed, (random() - 0.5) * speed] as [
        number,
        number,
        number,
      ],
    };
  });

  return defineScenario({
    id: `cloud-${n}`,
    name: `Cloud ${n}`,
    description: 'Benchmark cloud.',
    units: 'natural',
    dt: 1e-3,
    integrator: 'leapfrog',
    forceModel: 'direct',
    softening: 0.05,
    timeScale: 1,
    bodies,
  });
}

function benchmark(n: number): void {
  const engine = new ReferenceEngine();
  engine.load(cloud(n));

  // Warm up, so the JIT has compiled the force kernel before timing starts.
  for (let i = 0; i < 20; i++) engine.step();

  const budgetMs = 1500;
  const start = performance.now();
  let steps = 0;
  while (performance.now() - start < budgetMs) {
    engine.step();
    steps++;
  }
  const elapsed = performance.now() - start;

  const msPerStep = elapsed / steps;
  const pairs = (n * (n - 1)) / 2;
  const pairsPerSecond = (pairs * steps) / (elapsed / 1000);
  // Substeps that fit in a 16.67 ms frame, which is the number that actually
  // decides whether a preset is usable.
  const substeps = 16.667 / msPerStep;

  console.log(
    `N=${String(n).padStart(5)}  ` +
      `${msPerStep.toFixed(3).padStart(8)} ms/step  ` +
      `${(pairsPerSecond / 1e6).toFixed(1).padStart(7)} Mpair/s  ` +
      `${substeps.toFixed(1).padStart(7)} substeps/frame`,
  );
}

console.log('TypeScript reference engine, direct summation, leapfrog\n');
for (const n of SIZES) benchmark(n);
console.log('\nTargets (docs/PHYSICS.md): N<=512 needs 8+ substeps/frame,');
console.log('N=2000 needs 1-2, N=5000 needs 1 with Barnes-Hut.');
