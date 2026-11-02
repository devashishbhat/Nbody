import { presets } from '@nbody/scenarios';
import { useEffect } from 'react';
import {
  clearSelection,
  editSetting,
  loadScenario,
  redo,
  resetScenario,
  setHelpOpen,
  setInspectorOpen,
  setPaletteOpen,
  setRenderOption,
  stepOnce,
  toggleCameraMode,
  toggleFollow,
  togglePlay,
  undo,
  useStore,
} from './store.ts';

/**
 * Keyboard shortcuts.
 *
 * Bound on the window rather than a focused element, so they work wherever the
 * pointer is, and suppressed while a text field has focus so that typing a
 * mass does not pause the simulation.
 */
export function useKeyboard(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      const meta = event.metaKey || event.ctrlKey;

      // The palette opens from anywhere, including from inside a field.
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!useStore.getState().paletteOpen);
        return;
      }

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (event.key === 'Escape') {
        const state = useStore.getState();
        if (state.paletteOpen) setPaletteOpen(false);
        else if (state.helpOpen) setHelpOpen(false);
        else clearSelection();
        return;
      }

      if (typing || meta || event.altKey) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          togglePlay();
          break;

        case 'ArrowRight':
          event.preventDefault();
          stepOnce(event.shiftKey ? 20 : 1);
          break;

        case 'ArrowLeft': {
          // One step backwards, without leaving the simulation reversed. The
          // symplectic integrators are time-symmetric, so this lands exactly
          // where the previous step started.
          event.preventDefault();
          const { scenario } = useStore.getState();
          const forward = scenario.dt;
          editSetting('dt', -forward);
          stepOnce(event.shiftKey ? 20 : 1);
          editSetting('dt', forward);
          break;
        }

        case '/':
          event.preventDefault();
          setPaletteOpen(true);
          break;

        case '?':
          setHelpOpen(!useStore.getState().helpOpen);
          break;

        default:
          handleLetters(event);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

function handleLetters(event: KeyboardEvent): void {
  const state = useStore.getState();
  const key = event.key.toLowerCase();

  if (key >= '1' && key <= '9') {
    const preset = presets[Number(key) - 1];
    if (preset) loadScenario(preset, preset.id);
    return;
  }

  switch (key) {
    case 'r':
      resetScenario();
      break;
    case 'f':
      toggleFollow();
      break;
    case 'd':
      toggleCameraMode();
      break;
    case 'i':
      setInspectorOpen(!state.inspectorOpen);
      break;
    case 't':
      setRenderOption('showTrails', !state.options.showTrails);
      break;
    case 'g':
      setRenderOption('showGrid', !state.options.showGrid);
      break;
    case 'v':
      setRenderOption('showVelocities', !state.options.showVelocities);
      break;
    case 'o':
      setRenderOption('showPredictedOrbit', !state.options.showPredictedOrbit);
      break;
    case 'b':
      setRenderOption('bloom', !state.options.bloom);
      break;
  }
}

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Space', action: 'Play or pause' },
  { keys: '→ / ←', action: 'Step forward or back' },
  { keys: 'Shift + → / ←', action: 'Step twenty' },
  { keys: 'R', action: 'Reset to the start' },
  { keys: 'F', action: 'Follow the selected body' },
  { keys: 'D', action: 'Flat or orbiting camera' },
  { keys: 'Drag empty space', action: 'Pan, or orbit in 3D' },
  { keys: '1 to 9', action: 'Load a preset' },
  { keys: '⌘K or /', action: 'Command palette' },
  { keys: 'I', action: 'Show or hide the inspector' },
  { keys: 'T / G / V / O / B', action: 'Trails, grid, arrows, orbit, glow' },
  { keys: '⌘Z / ⌘⇧Z', action: 'Undo and redo' },
  { keys: 'Click', action: 'Select a body' },
  { keys: 'Drag a body', action: 'Move it' },
  { keys: 'Drag the arrow tip', action: 'Change its velocity' },
  { keys: 'Shift + drag', action: 'Sling a new body' },
  { keys: 'Scroll', action: 'Zoom where the pointer is' },
  { keys: 'Escape', action: 'Deselect, or close' },
];
