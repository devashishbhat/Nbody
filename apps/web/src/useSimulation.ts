import { createEngineClient } from '@nbody/engine';
import {
  FrameFlags,
  H,
  orbitalElements,
  UNIT_LABELS,
  type FrameSample,
  type Scenario,
  type Vec3,
} from '@nbody/protocol';
import { createWebGLRenderer, WebGLUnavailableError, type Renderer } from '@nbody/renderer';
import {
  formatDaysAsYears,
  formatDrift,
  formatFps,
  formatMsPerStep,
  formatScientific,
} from '@nbody/ui';
import { useEffect, useRef } from 'react';
import { attachInteractions, type InteractionHandles } from './interactions.ts';
import type { Readouts } from './readouts.ts';
import {
  attachEngine,
  attachView,
  LIVE_SAMPLE_HZ,
  setLiveSelected,
  setRenderOption,
  setStatus,
  syncCameraMode,
  useStore,
} from './store.ts';

export interface SimulationHandles {
  toggleFollow: () => void;
}

/**
 * The render loop, and everything that runs inside it.
 *
 * This is the one place that touches both the engine and the renderer every
 * frame, and the only place allowed to. React is not involved: the readouts
 * are written straight to their text nodes, and the single piece of state that
 * does reach the store, the selected body's live position and velocity, is
 * throttled to a few hertz because the inspector needs it in editable fields.
 *
 * Nothing here allocates. Buffers and scratch values are created once.
 */
export function useSimulation(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  readouts: Readouts,
): React.RefObject<SimulationHandles | null> {
  const handlesRef = useRef<SimulationHandles | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const interactionsRef = useRef<InteractionHandles | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const client = createEngineClient({ publishHz: 60 });
    attachEngine(client);

    let renderer: Renderer;
    try {
      renderer = createWebGLRenderer({ canvas });
    } catch (error) {
      if (error instanceof WebGLUnavailableError) {
        // Said plainly rather than shown as a black rectangle. WebGL2 has been
        // in every major browser since 2017, so this is a hardware or policy
        // problem rather than something to paper over with a second renderer.
        setStatus('This browser cannot run WebGL2, which this simulator needs.', 'error');
        client.dispose();
        attachEngine(null);
        return;
      }
      throw error;
    }

    rendererRef.current = renderer;
    const interactions = attachInteractions(canvas, renderer);
    interactionsRef.current = interactions;

    const toggleFollow = () => {
      const handle = useStore.getState().selectedHandle;
      renderer.camera.follow(renderer.camera.following === handle ? 0 : handle);
    };

    handlesRef.current = { toggleFollow };
    attachView({
      setCameraMode: (mode) => renderer.camera.setMode(mode),
      toggleFollow,
      isFollowing: () => renderer.camera.following !== 0,
    });
    syncCameraMode(renderer.camera.mode);

    const unsubscribeError = client.onError((message, fatal) => {
      setStatus(message, fatal ? 'error' : 'warn');
    });

    // Scenario and options are pushed into the renderer rather than read from
    // it, so the renderer never has to know the store exists.
    //
    // The two cases are deliberately distinguished. Any change to the
    // scenario, including editing one body's mass, replaces the object and
    // needs the appearance tables refreshed. Only an actual LOAD should frame
    // the camera and clear the trails, which is what loadToken marks: without
    // it, changing a mass threw away the view you had arranged, including the
    // camera mode.
    let currentScenario: Scenario | null = null;
    let currentLoadToken = -1;
    const unsubscribeStore = useStore.subscribe((state) => {
      if (state.scenario && state.scenario !== currentScenario) {
        currentScenario = state.scenario;
        renderer.setScenario(state.scenario);

        if (state.loadToken !== currentLoadToken) {
          currentLoadToken = state.loadToken;
          renderer.resetView(state.scenario);
        }
      }
      renderer.setOptions(state.options);
    });

    const observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);
    });
    observer.observe(canvas);
    const rect = canvas.getBoundingClientRect();
    renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const applyMotion = () => {
      useStore.setState((state) => ({
        options: { ...state.options, reducedMotion: reducedMotion.matches },
      }));
    };
    applyMotion();
    reducedMotion.addEventListener('change', applyMotion);

    // Exposed deliberately: a renderer is hard to inspect from the outside,
    // and this makes the live engine and renderer reachable from the console
    // and from tests without a build-time debug flag.
    (window as unknown as { nbody?: unknown }).nbody = { client, renderer };

    let raf = 0;
    let frames = 0;
    let lastFpsMs = 0;
    let lastLiveMs = 0;
    const liveIntervalMs = 1000 / LIVE_SAMPLE_HZ;

    const loop = (nowMs: number) => {
      raf = requestAnimationFrame(loop);

      frames++;
      if (nowMs - lastFpsMs >= 500) {
        readouts.fps.set(formatFps((frames * 1000) / (nowMs - lastFpsMs)));
        frames = 0;
        lastFpsMs = nowMs;
      }

      const sample = client.sample(nowMs);
      if (!sample) return;

      renderer.draw(sample, nowMs);

      // Loading a scenario can change the mode without the interface asking,
      // so the mirror is kept honest here rather than only on user action.
      syncCameraMode(renderer.camera.mode);

      const scenario = useStore.getState().scenario;
      if (scenario) writeDiagnostics(readouts, sample, scenario);

      if (nowMs - lastLiveMs >= liveIntervalMs) {
        lastLiveMs = nowMs;
        updateSelection(readouts, sample, renderer, scenario);
      }
    };

    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      reducedMotion.removeEventListener('change', applyMotion);
      unsubscribeError();
      unsubscribeStore();
      interactions.detach();
      renderer.dispose();
      client.dispose();
      attachEngine(null);
      attachView(null);
      rendererRef.current = null;
      interactionsRef.current = null;
      handlesRef.current = null;
    };
  }, [canvasRef, readouts]);

  return handlesRef;
}

function writeDiagnostics(readouts: Readouts, sample: FrameSample, scenario: Scenario): void {
  const header = sample.latest.header;
  const labels = UNIT_LABELS[scenario.units];

  readouts.simTime.set(sample.simTime.toFixed(3));
  readouts.clock.set(
    scenario.units === 'solar'
      ? formatDaysAsYears(sample.simTime)
      : `${sample.simTime.toFixed(3)} ${labels.time}`,
  );
  readouts.drift.set(
    sample.latest.hasFlag(FrameFlags.Diverged)
      ? 'diverged'
      : formatDrift(sample.latest.energyDrift),
  );
  readouts.momentum.set(formatScientific(header[H.momentum]!, 3));
  readouts.bodies.set(String(sample.count));
  readouts.msPerStep.set(formatMsPerStep(header[H.msPerStep]!));
  readouts.forceModel.set(
    scenario.forceModel === 'auto'
      ? sample.count >= 2000
        ? 'barnes-hut'
        : 'direct'
      : scenario.forceModel,
  );
}

/**
 * How far the velocity drag handle reaches, as a fraction of the view height.
 *
 * Shared with the interaction layer through the render options, so what you
 * can grab is exactly what you can see.
 */
const HANDLE_REACH = 0.3;

/** Scratch, so the per-frame selection work allocates nothing. */
const primaryPosition: [number, number, number] = [0, 0, 0];
const primaryVelocity: [number, number, number] = [0, 0, 0];
const bodyPosition: [number, number, number] = [0, 0, 0];
const bodyVelocity: [number, number, number] = [0, 0, 0];

/**
 * Live values and orbital elements for the selected body.
 *
 * Runs at a few hertz rather than every frame. The orbital elements are the
 * most informative thing the interface can say about a body, and they are
 * cheap, but there is no point computing them sixty times a second for a panel
 * a human is reading.
 */
/** Selection the handle scale was last computed for. */
let handleHandle = 0;

function updateSelection(
  readouts: Readouts,
  sample: FrameSample,
  renderer: Renderer,
  scenario: Scenario | null,
): void {
  const state = useStore.getState();
  const handle = state.selectedHandle;

  if (handle === 0 || !scenario) {
    setLiveSelected(null);
    if (handleHandle !== 0) {
      handleHandle = 0;
      setRenderOption('velocityHandleScale', 0);
    }
    return;
  }

  let slot = -1;
  for (let i = 0; i < sample.count; i++) {
    if (sample.handles[i] === handle) {
      slot = i;
      break;
    }
  }
  if (slot < 0) {
    setLiveSelected(null);
    return;
  }

  const d = slot * 3;
  const velocity: Vec3 = [
    sample.velocities[d]!,
    sample.velocities[d + 1]!,
    sample.velocities[d + 2]!,
  ];
  setLiveSelected({
    position: [sample.positions[d]!, sample.positions[d + 1]!, sample.positions[d + 2]!],
    velocity,
  });

  // Sized once per selection, not per sample. An arrow that resized itself as
  // the body sped up would be impossible to aim, and computing it here rather
  // than at the moment of the click is what makes it correct: at click time
  // the live velocity has not been sampled yet, so the scale came out of a
  // fallback and the handle sat almost on top of the body.
  if (handleHandle !== handle) {
    handleHandle = handle;
    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    const reach = renderer.camera.distance * HANDLE_REACH;
    setRenderOption('velocityHandleScale', speed > 0 ? reach / speed : reach);
  }

  // Measured against the heaviest OTHER body, which is what "the orbit of this
  // planet" means in a system with a dominant mass, and the only sensible
  // answer in an equal-mass binary, where the heaviest body is the selected one
  // and nothing orbits itself.
  let primarySlot = -1;
  let primaryMass = -Infinity;
  for (let i = 0; i < sample.count; i++) {
    if (i === slot) continue;
    const index = renderer.indexOfHandle(sample.handles[i]!);
    if (index < 0) continue;
    const mass = scenario.bodies[index]!.mass;
    if (mass > primaryMass) {
      primaryMass = mass;
      primarySlot = i;
    }
  }

  const selectedIndex = renderer.indexOfHandle(handle);
  if (primarySlot < 0 || selectedIndex < 0) {
    clearOrbitReadouts(readouts);
    return;
  }

  const p = primarySlot * 3;
  primaryPosition[0] = sample.positions[p]!;
  primaryPosition[1] = sample.positions[p + 1]!;
  primaryPosition[2] = sample.positions[p + 2]!;
  primaryVelocity[0] = sample.velocities[p]!;
  primaryVelocity[1] = sample.velocities[p + 1]!;
  primaryVelocity[2] = sample.velocities[p + 2]!;
  bodyPosition[0] = sample.positions[d]!;
  bodyPosition[1] = sample.positions[d + 1]!;
  bodyPosition[2] = sample.positions[d + 2]!;
  bodyVelocity[0] = sample.velocities[d]!;
  bodyVelocity[1] = sample.velocities[d + 1]!;
  bodyVelocity[2] = sample.velocities[d + 2]!;

  const elements = orbitalElements(
    scenario.G,
    primaryMass,
    scenario.bodies[selectedIndex]!.mass,
    primaryPosition,
    primaryVelocity,
    bodyPosition,
    bodyVelocity,
  );

  if (!elements) {
    clearOrbitReadouts(readouts);
    return;
  }

  const labels = UNIT_LABELS[scenario.units];
  readouts.selectedDistance.set(`${elements.distance.toPrecision(5)} ${labels.length}`);
  readouts.selectedSpeed.set(`${elements.speed.toPrecision(5)} ${labels.velocity}`);
  readouts.selectedEccentricity.set(elements.eccentricity.toFixed(4));
  readouts.selectedInclination.set(`${((elements.inclination * 180) / Math.PI).toFixed(2)}°`);

  if (elements.bound) {
    readouts.selectedSemiMajor.set(`${elements.semiMajorAxis.toPrecision(5)} ${labels.length}`);
    readouts.selectedPeriod.set(
      scenario.units === 'solar'
        ? formatDaysAsYears(elements.period)
        : `${elements.period.toPrecision(5)} ${labels.time}`,
    );
  } else {
    readouts.selectedSemiMajor.set('unbound');
    readouts.selectedPeriod.set('escaping');
  }
}

function clearOrbitReadouts(readouts: Readouts): void {
  readouts.selectedSemiMajor.set('–');
  readouts.selectedEccentricity.set('–');
  readouts.selectedInclination.set('–');
  readouts.selectedPeriod.set('–');
  readouts.selectedDistance.set('–');
  readouts.selectedSpeed.set('–');
}
