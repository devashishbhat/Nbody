import { createEngineClient } from '@nbody/engine';
import { FrameFlags, H, type EngineClient, type Scenario } from '@nbody/protocol';
import { createCanvas2DRenderer, type Renderer } from '@nbody/renderer';
import { formatDrift, formatFps, formatMsPerStep, LiveText } from '@nbody/ui';
import { useEffect, useMemo, useRef } from 'react';

export interface Readouts {
  simTime: LiveText;
  drift: LiveText;
  fps: LiveText;
  msPerStep: LiveText;
  bodies: LiveText;
}

/** One stable set of text bindings for the lifetime of the component. */
export function useReadouts(): Readouts {
  return useMemo(
    () => ({
      simTime: new LiveText(),
      drift: new LiveText(),
      fps: new LiveText(),
      msPerStep: new LiveText(),
      bodies: new LiveText(),
    }),
    [],
  );
}

/**
 * The render loop.
 *
 * Everything that changes per frame lives here, outside React: the canvas, the
 * camera springs, and every numeric readout, which are written straight to
 * their text nodes. React is told nothing. Driving the readouts through
 * component state instead would re-render a subtree sixty times a second and
 * make the frame budget depend on reconciliation, which is the one thing the
 * architecture is arranged to avoid. See docs/CONTRACTS.md.
 */
export function useSimulation(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  scenario: Scenario,
  readouts: Readouts,
): React.RefObject<EngineClient | null> {
  const clientRef = useRef<EngineClient | null>(null);
  const rendererRef = useRef<Renderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const client = createEngineClient({ publishHz: 60 });
    const renderer = createCanvas2DRenderer({ canvas });
    clientRef.current = client;
    rendererRef.current = renderer;

    const unsubscribe = client.onError((message, fatal) => {
      // Non-fatal messages are the engine telling the truth about an
      // approximation it had to make, which belongs in front of the user
      // rather than in a console nobody opens.
      console[fatal ? 'error' : 'warn'](`[engine] ${message}`);
    });

    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    });
    observer.observe(canvas);

    const rect = canvas.getBoundingClientRect();
    renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);

    let raf = 0;
    let lastFpsMs = 0;
    let frames = 0;
    let fps = 0;

    const loop = (nowMs: number) => {
      raf = requestAnimationFrame(loop);

      frames++;
      if (nowMs - lastFpsMs >= 500) {
        fps = (frames * 1000) / (nowMs - lastFpsMs);
        frames = 0;
        lastFpsMs = nowMs;
        readouts.fps.set(formatFps(fps));
      }

      const sample = client.sample(nowMs);
      if (!sample) return;

      renderer.draw(sample, nowMs);

      const header = sample.latest.header;
      readouts.simTime.set(sample.simTime.toFixed(3));
      readouts.drift.set(
        sample.latest.hasFlag(FrameFlags.Diverged)
          ? 'diverged'
          : formatDrift(sample.latest.energyDrift),
      );
      readouts.msPerStep.set(formatMsPerStep(header[H.msPerStep]));
      readouts.bodies.set(String(sample.count));
    };

    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      unsubscribe();
      renderer.dispose();
      client.dispose();
      clientRef.current = null;
      rendererRef.current = null;
    };
    // The loop is created once per canvas. Scenario changes are pushed through
    // the effect below instead of tearing the worker down and rebuilding it.
  }, [canvasRef, readouts]);

  useEffect(() => {
    const client = clientRef.current;
    const renderer = rendererRef.current;
    if (!client || !renderer) return;
    renderer.setScenario(scenario);
    client.load(scenario);
    client.play();
  }, [scenario]);

  return clientRef;
}
