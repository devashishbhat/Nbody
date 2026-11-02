import { defaultPreset, getPreset, parseHash, safeDecodeScenario } from '@nbody/scenarios';
import { useEffect, useRef } from 'react';
import { CommandPalette } from './components/CommandPalette.tsx';
import { Diagnostics } from './components/Diagnostics.tsx';
import { HelpOverlay } from './components/HelpOverlay.tsx';
import { Inspector } from './components/Inspector.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { TransportBar } from './components/TransportBar.tsx';
import { useReadouts } from './readouts.ts';
import { loadScenario, setStatus, useStore } from './store.ts';
import { useIdleChrome } from './useIdleChrome.ts';
import { useKeyboard } from './useKeyboard.ts';
import { useSimulation } from './useSimulation.ts';

/**
 * The shell.
 *
 * The canvas is the whole page and everything else is an overlay on it, which
 * is what the minimalist brief actually requires: the simulation is the
 * subject, the chrome is the apparatus, and the apparatus gets out of the way.
 */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readouts = useReadouts();
  const handles = useSimulation(canvasRef, readouts);
  const ready = useStore((state) => state.scenario !== undefined);

  useIdleChrome();
  useKeyboard({
    toggleDimension: () => handles.current?.toggleDimension(),
    toggleFollow: () => handles.current?.toggleFollow(),
  });

  // The hash decides what loads, so a share link opens the system it names
  // rather than the default and then jumping.
  useEffect(() => {
    const target = readHash();
    if (target) loadScenario(target.scenario, target.presetId);
    else {
      const preset = defaultPreset();
      loadScenario(preset, preset.id);
    }
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="nb-canvas"
        aria-label="Gravitational simulation"
        role="img"
      />

      {ready ? (
        <>
          <TopBar />
          <TransportBar readouts={readouts} />
          <Inspector readouts={readouts} />
          <Diagnostics readouts={readouts} />
          <CommandPalette />
          <HelpOverlay />
        </>
      ) : null}

      <StatusBar />
    </>
  );
}

/** Resolves the location hash into something to load. */
function readHash(): {
  scenario: ReturnType<typeof defaultPreset>;
  presetId: string | null;
} | null {
  if (!window.location.hash) return null;

  try {
    const target = parseHash(window.location.hash);
    if (!target) return null;

    if (target.kind === 'preset') {
      const preset = getPreset(target.id);
      if (preset) return { scenario: preset, presetId: preset.id };
      setStatus(`There is no preset called "${target.id}"`, 'warn');
      return null;
    }

    return { scenario: target.scenario, presetId: null };
  } catch {
    // Reported rather than ignored. Silently loading something else when
    // someone follows a shared link is worse than saying the link is broken.
    const value = new URLSearchParams(window.location.hash.slice(1)).get('s');
    const result = value ? safeDecodeScenario(value) : null;
    setStatus(result && !result.ok ? result.error : 'That share link could not be read', 'error');
    return null;
  }
}
