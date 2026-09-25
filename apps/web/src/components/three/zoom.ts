/**
 * Zoom and pan for the 3D table: pinch or the mouse wheel zooms towards the
 * point under the fingers/cursor, dragging pans while zoomed in, and the
 * on-screen buttons or a double tap zoom in and out. The camera rig eases
 * towards this state every frame.
 */
import { create } from 'zustand';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3.2;

interface ZoomState {
  zoom: number;
  /** Look-at offset on the table (world units). */
  panX: number;
  panZ: number;
  /** Half the table size: panning never leaves it. */
  halfW: number;
  halfD: number;
}

export const useTableZoom = create<ZoomState>(() => ({ zoom: 1, panX: 0, panZ: 0, halfW: 4, halfD: 4 }));

function clampPan(zoom: number, x: number, z: number, s: ZoomState) {
  const room = 1 - 1 / zoom;
  const mx = s.halfW * room;
  const mz = s.halfD * room;
  return { panX: Math.max(-mx, Math.min(mx, x)), panZ: Math.max(-mz, Math.min(mz, z)) };
}

/** Zoom to `zoom`, keeping the table point (fx, fz) (look-at relative) where it is on screen. */
export function zoomTo(zoom: number, focus?: { x: number; z: number }) {
  const s = useTableZoom.getState();
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const ratio = next / s.zoom;
  let { panX, panZ } = s;
  if (focus) {
    panX += (focus.x - panX) * (1 - 1 / ratio);
    panZ += (focus.z - panZ) * (1 - 1 / ratio);
  }
  useTableZoom.setState({ zoom: next, ...clampPan(next, panX, panZ, s) });
}

export function panBy(dx: number, dz: number) {
  const s = useTableZoom.getState();
  useTableZoom.setState(clampPan(s.zoom, s.panX + dx, s.panZ + dz, s));
}

export function resetZoom() {
  useTableZoom.setState({ zoom: 1, panX: 0, panZ: 0 });
}

export function setTableBounds(halfW: number, halfD: number) {
  const s = useTableZoom.getState();
  if (s.halfW === halfW && s.halfD === halfD) return;
  useTableZoom.setState({ halfW, halfD, ...clampPan(s.zoom, s.panX, s.panZ, { ...s, halfW, halfD }) });
}

// A drag or pinch that ends on a card pile must not count as a tap on it.
let dragged = false;

export function markDragged(value: boolean) {
  dragged = value;
}

/** True when the pointer that is being released moved the view. */
export function wasDragged(): boolean {
  return dragged;
}
