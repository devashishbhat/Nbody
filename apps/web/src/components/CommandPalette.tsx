import { presets } from '@nbody/scenarios';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  loadScenario,
  resetScenario,
  setHelpOpen,
  setPaletteOpen,
  setRenderOption,
  togglePlay,
  toggleReverse,
  useStore,
} from '../store.ts';

interface Command {
  id: string;
  label: string;
  detail?: string;
  run: () => void;
}

/**
 * The command palette.
 *
 * Carries the whole surface of the app, which is what lets the visible chrome
 * stay as small as it is: anything not worth a permanent control is reachable
 * here, and so is every preset without a list taking up the screen.
 */
export function CommandPalette() {
  const open = useStore((state) => state.paletteOpen);
  const options = useStore((state) => state.options);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const presetCommands = presets.map((preset) => ({
      id: `preset:${preset.id}`,
      label: preset.name,
      detail: preset.description,
      run: () => loadScenario(preset, preset.id),
    }));

    const actions: Command[] = [
      { id: 'play', label: 'Play or pause', run: togglePlay },
      { id: 'reverse', label: 'Reverse time', run: toggleReverse },
      { id: 'reset', label: 'Reset to the start', run: resetScenario },
      {
        id: 'trails',
        label: options.showTrails ? 'Hide trails' : 'Show trails',
        run: () => setRenderOption('showTrails', !options.showTrails),
      },
      {
        id: 'grid',
        label: options.showGrid ? 'Hide grid' : 'Show grid',
        run: () => setRenderOption('showGrid', !options.showGrid),
      },
      {
        id: 'velocities',
        label: options.showVelocities ? 'Hide velocity arrows' : 'Show velocity arrows',
        run: () => setRenderOption('showVelocities', !options.showVelocities),
      },
      {
        id: 'orbit',
        label: options.showPredictedOrbit ? 'Hide predicted orbit' : 'Show predicted orbit',
        run: () => setRenderOption('showPredictedOrbit', !options.showPredictedOrbit),
      },
      {
        id: 'bloom',
        label: options.bloom ? 'Turn off glow' : 'Turn on glow',
        run: () => setRenderOption('bloom', !options.bloom),
      },
      { id: 'help', label: 'Keyboard shortcuts', run: () => setHelpOpen(true) },
    ];

    return [...presetCommands, ...actions];
  }, [options]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.detail?.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    setActive((index) => Math.min(index, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  function choose(command: Command | undefined): void {
    if (!command) return;
    command.run();
    setPaletteOpen(false);
  }

  return (
    <div
      className="nb-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setPaletteOpen(false);
      }}
    >
      <div className="nb-palette">
        <input
          ref={inputRef}
          className="nb-palette-input"
          placeholder="Search presets and commands"
          value={query}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, filtered.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(filtered[active]);
            }
          }}
        />
        <ul className="nb-palette-list" role="listbox">
          {filtered.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={index === active ? 'nb-palette-item is-active' : 'nb-palette-item'}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(command)}
              >
                <span className="nb-palette-label">{command.label}</span>
                {command.detail ? (
                  <span className="nb-palette-detail">{command.detail}</span>
                ) : null}
              </button>
            </li>
          ))}
          {filtered.length === 0 ? <li className="nb-palette-empty">Nothing matches</li> : null}
        </ul>
      </div>
    </div>
  );
}
