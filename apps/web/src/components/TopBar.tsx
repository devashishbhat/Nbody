import { useState } from 'react';
import {
  buildScenarioFile,
  buildShareLink,
  setHelpOpen,
  setPaletteOpen,
  setStatus,
  useStore,
} from '../store.ts';

/**
 * Preset name, description and sharing.
 *
 * The description and the "watch for" line are the only teaching the interface
 * does, and they are why someone who has never seen a three-body orbit knows
 * what they are looking at.
 */
export function TopBar() {
  const scenario = useStore((state) => state.scenario);
  const [sharing, setSharing] = useState(false);

  async function share(): Promise<void> {
    setSharing(true);
    try {
      const url = await buildShareLink();
      window.history.replaceState(null, '', url);
      await navigator.clipboard.writeText(url);
      setStatus('Link copied. It contains the whole system.', 'info');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'could not build a link';
      // Too many bodies for a URL is a normal outcome, not a failure, so it
      // offers the file instead of just refusing.
      setStatus(`${message}. Downloading a file instead.`, 'warn');
      await download();
    } finally {
      setSharing(false);
    }
  }

  async function download(): Promise<void> {
    try {
      const blob = await buildScenarioFile();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${scenario.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setStatus('Could not export this system', 'error');
    }
  }

  return (
    <header className="nb-panel nb-top-left" aria-label="Scenario">
      <button className="nb-preset-button" onClick={() => setPaletteOpen(true)}>
        <span className="nb-label">Preset</span>
        <span className="nb-preset-name">{scenario.name}</span>
        <span className="nb-kbd">⌘K</span>
      </button>

      <p className="nb-description">{scenario.description}</p>
      {scenario.watchFor ? <p className="nb-watch">{scenario.watchFor}</p> : null}

      <div className="nb-top-actions">
        <button className="nb-button" onClick={share} disabled={sharing}>
          {sharing ? 'Copying…' : 'Share'}
        </button>
        <button className="nb-button" onClick={() => setHelpOpen(true)} title="Shortcuts (?)">
          Keys
        </button>
      </div>
    </header>
  );
}
