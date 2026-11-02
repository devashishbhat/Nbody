import { defineScenario, type Scenario, type Vec3 } from '@nbody/protocol';
import type { Renderer } from '@nbody/renderer';
import {
  addBody,
  clearSelection,
  editBodyState,
  getEngine,
  selectHandle,
  setRenderOption,
  setStatus,
  useStore,
} from './store.ts';

/**
 * Pointer interaction on the canvas.
 *
 * Attached imperatively rather than through React handlers because these fire
 * at pointer rate, often every frame during a drag, and routing them through
 * the component tree would put reconciliation in the middle of a gesture.
 *
 * The gestures:
 *
 *   click a body            select it
 *   drag a body             move it
 *   drag its velocity tip   change its velocity
 *   drag empty space        pan, or orbit in 3D
 *   shift-drag empty space  slingshot a new body into existence
 *   wheel                   zoom, anchored where the pointer is
 *
 * Moving a body and changing its velocity are live edits: they change where
 * the system has got to, not what it is, so a reset puts it back.
 */

/** Pixels of movement before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 3;

/** How far the velocity arrow reaches, as a fraction of the view height. */
const HANDLE_REACH = 0.3;

/** Pixels within which the velocity tip can be grabbed. */
const HANDLE_GRAB_RADIUS = 18;

type Mode =
  | { kind: 'none' }
  | { kind: 'press'; startX: number; startY: number; slot: number }
  | { kind: 'pan' }
  | { kind: 'orbit' }
  | { kind: 'move'; id: string; from: Vec3 }
  | { kind: 'velocity'; id: string; from: Vec3; scale: number }
  | { kind: 'spawn'; startX: number; startY: number };

export interface InteractionHandles {
  detach: () => void;
  /** Recomputes the velocity handle scale. Called when the selection changes. */
  refreshHandle: () => void;
}

export function attachInteractions(
  canvas: HTMLCanvasElement,
  renderer: Renderer,
): InteractionHandles {
  const world = new Float64Array(3);
  const screen = new Float64Array(2);
  const position = new Float64Array(3);

  let mode: Mode = { kind: 'none' };
  let handleScale = 0;
  let spawnPreviewId: string | null = null;

  function scenario(): Scenario {
    return useStore.getState().scenario;
  }

  function bodyIdOfSlot(slot: number): string | null {
    const handle = renderer.handleOf(slot);
    const index = renderer.indexOfHandle(handle);
    const bodies = scenario().bodies;
    return index >= 0 && index < bodies.length ? bodies[index]!.id : null;
  }

  /**
   * Chooses how long the velocity arrow is.
   *
   * Fixed so that the arrow starts at a comfortable fraction of the view and
   * then scales linearly with the velocity, which makes dragging it twice as
   * far mean twice the speed. Recomputed on selection rather than per frame,
   * because an arrow that resized itself as the body sped up would be
   * impossible to aim.
   */
  function refreshHandle(): void {
    const state = useStore.getState();
    if (state.selectedHandle === 0) {
      handleScale = 0;
      setRenderOption('velocityHandleScale', 0);
      return;
    }
    const live = state.liveSelected;
    const velocity = live?.velocity;
    const speed = velocity ? Math.hypot(velocity[0], velocity[1], velocity[2]) : 0;
    const reach = renderer.camera.distance * HANDLE_REACH;
    handleScale = speed > 0 ? reach / speed : reach;
    setRenderOption('velocityHandleScale', handleScale);
  }

  function pointerOffset(event: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  /** True when the pointer is on the selected body's velocity tip. */
  function onVelocityHandle(x: number, y: number): boolean {
    const state = useStore.getState();
    if (state.selectedHandle === 0 || handleScale === 0) return false;
    const live = state.liveSelected;
    if (!live) return false;

    const tipX = live.position[0] + live.velocity[0] * handleScale;
    const tipY = live.position[1] + live.velocity[1] * handleScale;
    const tipZ = live.position[2] + live.velocity[2] * handleScale;
    if (!renderer.camera.project(tipX, tipY, tipZ, screen)) return false;

    return Math.hypot(screen[0]! - x, screen[1]! - y) <= HANDLE_GRAB_RADIUS;
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    const [x, y] = pointerOffset(event);

    if (event.shiftKey && renderer.camera.mode === '2d') {
      mode = { kind: 'spawn', startX: x, startY: y };
      return;
    }

    if (onVelocityHandle(x, y)) {
      const state = useStore.getState();
      const id = state.selectedBodyId;
      const live = state.liveSelected;
      if (id && live) {
        mode = { kind: 'velocity', id, from: live.velocity, scale: handleScale };
        return;
      }
    }

    const slot = renderer.pick(x, y);
    mode = { kind: 'press', startX: x, startY: y, slot: slot ?? -1 };
  }

  function onPointerMove(event: PointerEvent): void {
    const [x, y] = pointerOffset(event);

    if (mode.kind === 'press') {
      const moved = Math.hypot(x - mode.startX, y - mode.startY);
      if (moved < DRAG_THRESHOLD) return;

      if (mode.slot >= 0) {
        const id = bodyIdOfSlot(mode.slot);
        if (id && renderer.positionOf(mode.slot, position)) {
          mode = {
            kind: 'move',
            id,
            from: [position[0]!, position[1]!, position[2]!],
          };
        } else {
          mode = { kind: renderer.camera.mode === '3d' ? 'orbit' : 'pan' };
        }
      } else {
        mode = { kind: renderer.camera.mode === '3d' ? 'orbit' : 'pan' };
      }
    }

    switch (mode.kind) {
      case 'pan':
        renderer.camera.panBy(event.movementX, event.movementY);
        break;

      case 'orbit':
        // Half a viewport of drag is about a quarter turn, which is enough to
        // feel direct without making the camera twitchy.
        renderer.camera.orbitBy(-event.movementX * 0.006, event.movementY * 0.006);
        break;

      case 'move': {
        if (renderer.camera.mode !== '2d') break;
        renderer.camera.unproject2d(x, y, world);
        editBodyState(
          mode.id,
          { position: [world[0]!, world[1]!, mode.from[2]] },
          { position: mode.from },
          'move body',
          'drag-position',
        );
        break;
      }

      case 'velocity': {
        if (renderer.camera.mode !== '2d') break;
        const live = useStore.getState().liveSelected;
        if (!live) break;
        renderer.camera.unproject2d(x, y, world);
        const velocity: Vec3 = [
          (world[0]! - live.position[0]) / mode.scale,
          (world[1]! - live.position[1]) / mode.scale,
          mode.from[2],
        ];
        editBodyState(
          mode.id,
          { velocity },
          { velocity: mode.from },
          'change velocity',
          'drag-velocity',
        );
        break;
      }

      case 'spawn':
        // The preview is the body itself, added on the first movement and then
        // steered. Simpler than a separate ghost, and it means releasing the
        // pointer needs to do nothing at all.
        updateSpawn(mode.startX, mode.startY, x, y);
        break;
    }
  }

  function updateSpawn(startX: number, startY: number, x: number, y: number): void {
    const current = scenario();
    renderer.camera.unproject2d(startX, startY, world);
    const origin: Vec3 = [world[0]!, world[1]!, 0];

    renderer.camera.unproject2d(x, y, world);
    // Dragging away from the start sets the velocity, like pulling back a
    // slingshot. The divisor converts a screen-sized drag into a speed
    // comparable with what is already on screen.
    const reach = renderer.camera.distance * HANDLE_REACH;
    const velocity: Vec3 = [(world[0]! - origin[0]) / reach, (world[1]! - origin[1]) / reach, 0];

    if (spawnPreviewId === null) {
      const seed = makeBody(current, origin, velocity);
      spawnPreviewId = seed.id;
      addBody(seed);
      const engine = getEngine();
      if (engine) setStatus('Drag to aim, release to let go', 'info');
      return;
    }

    editBodyState(
      spawnPreviewId,
      { velocity },
      { velocity: [0, 0, 0] },
      'aim new body',
      'spawn-velocity',
    );
  }

  function onPointerUp(event: PointerEvent): void {
    const [x, y] = pointerOffset(event);

    if (mode.kind === 'press') {
      // A press that never became a drag is a click: select, or clear.
      if (mode.slot >= 0) {
        const handle = renderer.handleOf(mode.slot);
        selectHandle(handle, bodyIdOfSlot(mode.slot));
        refreshHandle();
      } else {
        clearSelection();
        setRenderOption('velocityHandleScale', 0);
      }
    }

    if (mode.kind === 'spawn' && spawnPreviewId === null) {
      // Shift-clicked without dragging: a body at rest where you clicked.
      renderer.camera.unproject2d(x, y, world);
      addBody(makeBody(scenario(), [world[0]!, world[1]!, 0], [0, 0, 0]));
    }

    spawnPreviewId = null;
    mode = { kind: 'none' };
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    // Exponential in the scroll delta, so a trackpad flick and a mouse notch
    // both feel proportional rather than one being unusable.
    const factor = Math.exp(-event.deltaY * 0.0022);
    renderer.camera.zoomBy(factor, event.clientX - rect.left, event.clientY - rect.top);
  }

  function onContextMenu(event: Event): void {
    event.preventDefault();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return {
    refreshHandle,
    detach() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    },
  };
}

/** A new body sized sensibly for whatever system it is joining. */
function makeBody(scenario: Scenario, position: Vec3, velocity: Vec3) {
  const masses = scenario.bodies.map((body) => body.mass).filter((mass) => mass > 0);
  const radii = scenario.bodies.map((body) => body.radius).filter((radius) => radius > 0);

  // A thousandth of the heaviest thing present: big enough to be visible and
  // to perturb what it passes, small enough not to wreck the system on sight.
  const mass = masses.length > 0 ? Math.max(...masses) * 1e-3 : 1;
  const radius = radii.length > 0 ? Math.min(...radii) : 0.01;

  const seed = defineScenario({
    id: 'spawn',
    name: 'Spawn',
    description: 'x',
    units: scenario.units,
    dt: scenario.dt,
    timeScale: scenario.timeScale,
    bodies: [
      {
        id: `added-${Date.now().toString(36)}`,
        name: 'New body',
        mass,
        radius,
        position,
        velocity,
        color: '#f7768e',
        trail: true,
      },
    ],
  });
  return seed.bodies[0]!;
}
