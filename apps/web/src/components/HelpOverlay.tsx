import { SHORTCUTS } from '../useKeyboard.ts';
import { setHelpOpen, useStore } from '../store.ts';

export function HelpOverlay() {
  const open = useStore((state) => state.helpOpen);
  if (!open) return null;

  return (
    <div
      className="nb-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setHelpOpen(false);
      }}
    >
      <div className="nb-help">
        <h2 className="nb-help-title">Controls</h2>
        <dl className="nb-help-list">
          {SHORTCUTS.map((shortcut) => (
            <div className="nb-help-row" key={shortcut.keys}>
              <dt className="nb-kbd">{shortcut.keys}</dt>
              <dd className="nb-help-action">{shortcut.action}</dd>
            </div>
          ))}
        </dl>
        <button className="nb-button" onClick={() => setHelpOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
}
