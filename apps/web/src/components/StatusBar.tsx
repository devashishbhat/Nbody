import { useEffect } from 'react';
import { clearStatus, useStore } from '../store.ts';

/** How long a message stays before it fades on its own. */
const DISMISS_MS = 4500;

/**
 * Transient messages.
 *
 * Used for the things the simulation needs to admit: a share link that was
 * copied, a system too large to link, an engine warning. Dismissed on a timer
 * because none of them are worth a button.
 */
export function StatusBar() {
  const status = useStore((state) => state.status);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(clearStatus, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [status]);

  if (!status) return null;

  return (
    <div className={`nb-status nb-status--${status.tone}`} role="status">
      {status.text}
    </div>
  );
}
