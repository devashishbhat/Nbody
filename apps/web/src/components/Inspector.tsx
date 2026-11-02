import { useStore, setInspectorOpen } from '../store.ts';
import type { Readouts } from '../readouts.ts';
import { BodyInspector } from './BodyInspector.tsx';
import { SystemInspector } from './SystemInspector.tsx';

/**
 * The right-hand panel.
 *
 * Shows the selected body when there is one and the system settings otherwise,
 * rather than offering tabs: selecting a body is already the gesture that says
 * which of the two you want.
 */
export function Inspector({ readouts }: { readouts: Readouts }) {
  const open = useStore((state) => state.inspectorOpen);
  const selectedHandle = useStore((state) => state.selectedHandle);
  const selectedBodyId = useStore((state) => state.selectedBodyId);
  const bodies = useStore((state) => state.scenario.bodies);

  const body = selectedBodyId
    ? bodies.find((candidate) => candidate.id === selectedBodyId)
    : undefined;

  if (!open) {
    return (
      <button
        className="nb-panel nb-right nb-collapsed"
        onClick={() => setInspectorOpen(true)}
        aria-label="Open inspector"
        title="Open inspector (I)"
      >
        &#8249;
      </button>
    );
  }

  return (
    <aside className="nb-panel nb-right nb-inspector" aria-label="Inspector">
      <header className="nb-inspector-bar">
        <span className="nb-label">{body ? 'Body' : 'System'}</span>
        <button
          className="nb-icon-button"
          onClick={() => setInspectorOpen(false)}
          aria-label="Close inspector"
          title="Close inspector (I)"
        >
          &#8250;
        </button>
      </header>

      {body ? <BodyInspector key={body.id} body={body} readouts={readouts} /> : <SystemInspector />}

      {selectedHandle !== 0 && !body ? (
        <p className="nb-hint">This body was added after the scenario loaded.</p>
      ) : null}
    </aside>
  );
}
