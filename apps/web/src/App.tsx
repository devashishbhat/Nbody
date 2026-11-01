import { presets } from '@nbody/scenarios';
import { defaultPreset } from '@nbody/scenarios';
import { useMemo, useRef, useState } from 'react';
import { useReadouts, useSimulation } from './useSimulation.ts';

/**
 * Provisional app shell.
 *
 * LANE E owns this. It is deliberately the smallest thing that proves the
 * whole slice works end to end: engine in a worker, frames interpolated on the
 * main thread, renderer drawing, readouts updating without React re-rendering.
 *
 * The real interface, which is the inspector, the transport bar, the command
 * palette and the keyboard map, is Lane E's to build. Treat the markup here as
 * a harness rather than a foundation.
 */
export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scenarioId, setScenarioId] = useState(defaultPreset().id);
  const [playing, setPlaying] = useState(true);

  const scenario = useMemo(
    () => presets.find((p) => p.id === scenarioId) ?? defaultPreset(),
    [scenarioId],
  );

  const readouts = useReadouts();
  const clientRef = useSimulation(canvasRef, scenario, readouts);

  const togglePlay = () => {
    const client = clientRef.current;
    if (!client) return;
    if (playing) client.pause();
    else client.play();
    setPlaying(!playing);
  };

  return (
    <>
      <canvas ref={canvasRef} className="nb-canvas" />

      <div className="nb-panel nb-top-left">
        <div className="nb-label">Preset</div>
        <select
          className="nb-select"
          value={scenarioId}
          onChange={(event) => {
            setScenarioId(event.target.value);
            setPlaying(true);
          }}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        <p style={{ maxWidth: 260, color: 'var(--text-secondary)' }}>{scenario.description}</p>
        {scenario.watchFor ? (
          <p style={{ maxWidth: 260, color: 'var(--text-tertiary)' }}>{scenario.watchFor}</p>
        ) : null}
      </div>

      <div className="nb-panel nb-bottom-center">
        <button className="nb-button" onClick={togglePlay}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button className="nb-button" onClick={() => clientRef.current?.stepOnce(1)}>
          Step
        </button>
        <button className="nb-button" onClick={() => clientRef.current?.reset()}>
          Reset
        </button>
        <span className="nb-num">
          t = <span ref={readouts.simTime.attach}>0.000</span>
        </span>
      </div>

      <div className="nb-panel nb-bottom-right">
        <div className="nb-row">
          <span className="nb-label">Energy drift</span>
          <span className="nb-num" ref={readouts.drift.attach}>
            0.0e+00
          </span>
        </div>
        <div className="nb-row">
          <span className="nb-label">Bodies</span>
          <span className="nb-num" ref={readouts.bodies.attach}>
            0
          </span>
        </div>
        <div className="nb-row">
          <span className="nb-label">Per step</span>
          <span className="nb-num" ref={readouts.msPerStep.attach}>
            0.000 ms
          </span>
        </div>
        <div className="nb-row">
          <span className="nb-label">FPS</span>
          <span className="nb-num" ref={readouts.fps.attach}>
            ---
          </span>
        </div>
      </div>
    </>
  );
}
