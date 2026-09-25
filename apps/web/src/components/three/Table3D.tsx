'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CardId, GameState } from '@kova/rummy-engine';
import { CARD_H, CARD_W, type SceneLayout, type TableDims, type TableModel } from '@/lib/tableModel';
import { CardLayer } from './CardLayer';
import { cardMaterial } from './cardAssets';
import { MAX_ZOOM, markDragged, panBy, resetZoom, setTableBounds, useTableZoom, wasDragged, zoomTo } from './zoom';

export interface Table3DProps {
  state: GameState;
  model: TableModel;
  layout: SceneLayout;
  thinking: number | null;
  /** Online play: cards that just surfaced -> the face-down stand-in they replace. */
  renames?: Map<CardId, CardId> | null;
  canDraw: boolean;
  canTakeDiscard: boolean;
  highlightMelds: Set<number>;
  onDeck: () => void;
  onDiscard: () => void;
  onMeld: (meldId: number) => void;
  /** Fraction of the screen height covered by the hand overlay at the bottom. */
  bottomInset: number;
  /** Fraction of the screen height covered by the HUD at the top. */
  topInset: number;
}

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function feltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(256, 256, 40, 256, 256, 360);
  g.addColorStop(0, '#2f7a57');
  g.addColorStop(1, '#174733');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // Fine grain.
  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function TableMesh({ dims }: { dims: TableDims }) {
  const { w, d } = dims;
  const radius = Math.min(w, d) * 0.2;
  const felt = useMemo(() => {
    const geo = new THREE.ShapeGeometry(roundedRectShape(w, d, radius), 12);
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / w + 0.5;
      uv[i * 2 + 1] = pos.getY(i) / d + 0.5;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  }, [w, d, radius]);
  const rim = useMemo(() => {
    const outer = roundedRectShape(w + 0.7, d + 0.7, radius + 0.35);
    outer.holes.push(new THREE.Path(roundedRectShape(w, d, radius).getPoints(48)));
    return new THREE.ExtrudeGeometry(outer, {
      depth: 0.22,
      bevelEnabled: true,
      bevelSize: 0.06,
      bevelThickness: 0.06,
      bevelSegments: 2,
      curveSegments: 12,
    });
  }, [w, d, radius]);
  const tex = useMemo(() => feltTexture(), []);
  return (
    <group position={[0, 0, dims.cz]}>
      <mesh geometry={felt} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
      <mesh geometry={rim} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.16, 0]}>
        <meshStandardMaterial color="#5a3420" roughness={0.45} metalness={0.05} />
      </mesh>
    </group>
  );
}

function DeckBlock({ height, x, z }: { height: number; x: number; z: number }) {
  if (height <= 0) return null;
  return (
    <mesh position={[x, height / 2, z]}>
      <boxGeometry args={[CARD_W * 0.98, height, CARD_H * 0.98]} />
      <meshStandardMaterial color="#e9e0cc" roughness={0.8} />
    </mesh>
  );
}

const glowGeometries = new Map<string, THREE.ShapeGeometry>();
function glowGeometry(w: number, d: number): THREE.ShapeGeometry {
  const key = `${w.toFixed(2)}x${d.toFixed(2)}`;
  let geo = glowGeometries.get(key);
  if (!geo) {
    geo = new THREE.ShapeGeometry(roundedRectShape(w, d, Math.min(w, d) * 0.14), 6);
    glowGeometries.set(key, geo);
  }
  return geo;
}

function ClickZone({
  x,
  z,
  w,
  d,
  active,
  glow,
  onClick,
}: {
  x: number;
  z: number;
  w: number;
  d: number;
  active: boolean;
  glow: boolean;
  onClick: () => void;
}) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }) => {
    if (mat.current) mat.current.opacity = glow ? 0.2 + Math.sin(clock.elapsedTime * 4) * 0.1 : 0;
  });
  return (
    <mesh
      position={[x, 0.0015, z]}
      rotation={[-Math.PI / 2, 0, 0]}
      geometry={glowGeometry(w, d)}
      onClick={(e) => {
        if (!active || wasDragged()) return;
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={() => active && (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <meshBasicMaterial ref={mat} color="#ffd36b" transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function CameraRig({
  bottomInset,
  topInset,
  focusX,
  dims,
}: {
  bottomInset: number;
  topInset: number;
  focusX: number;
  dims: TableDims;
}) {
  const { camera, size } = useThree();
  /** The framing that shows the whole table; zoom and pan are applied on top. */
  const base = useRef({ dist: 14, elev: 1, cz: dims.cz - 0.35 });
  const cur = useRef({ zoom: 1, x: 0, z: 0, follow: 0 });
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    // Visible area: below the HUD and above the hand overlay.
    const usable = Math.max(0.3, 1 - bottomInset - topInset);
    const vFov = THREE.MathUtils.degToRad(cam.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const halfW = dims.w / 2 + 0.55;
    // Include the opponents' fans and name labels above the table.
    const halfD = dims.d / 2 + 0.9;
    const elev = THREE.MathUtils.degToRad(dims.portrait ? 64 : 54);
    const distW = halfW / Math.tan(hFov / 2);
    const distD = (halfD * Math.sin(elev) + 0.4) / Math.tan((vFov * usable) / 2);
    base.current = { dist: Math.max(distW, distD), elev, cz: dims.cz - 0.35 };
    setTableBounds(dims.w / 2, dims.d / 2);
    // Shift the picture so the table is centred in the visible area.
    const shift = ((bottomInset - topInset) / 2) * size.height;
    cam.setViewOffset(size.width, size.height, 0, shift, size.width, size.height);
    cam.updateProjectionMatrix();
  }, [camera, size, bottomInset, topInset, dims]);
  useFrame((_, dt) => {
    const { zoom, panX, panZ } = useTableZoom.getState();
    const c = cur.current;
    const k = 1 - Math.exp(-dt * 12);
    c.zoom += (zoom - c.zoom) * k;
    c.x += (panX - c.x) * k;
    c.z += (panZ - c.z) * k;
    // Subtle pan towards the active player, only while the whole table is in view.
    const follow = zoom > 1.02 ? 0 : focusX * 0.08;
    c.follow += (follow - c.follow) * (1 - Math.exp(-dt * 2));
    const { dist, elev, cz } = base.current;
    const d = dist / c.zoom;
    const tx = c.x + c.follow;
    const tz = cz + c.z;
    camera.position.set(tx, Math.sin(elev) * d, tz + Math.cos(elev) * d);
    camera.lookAt(tx, 0, tz);
  });
  return null;
}

/** Pinch, wheel, drag and double tap on the canvas. */
function ZoomGestures({ dims }: { dims: TableDims }) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    const ndc = new THREE.Vector2();
    const cz = dims.cz - 0.35;
    /** Table point under a screen position, relative to the unpanned look-at point. */
    const tablePoint = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!ray.ray.intersectPlane(plane, hit)) return undefined;
      return { x: hit.x, z: hit.z - cz };
    };
    /** Pan so the table point under `from` ends up under `to` (screen positions). */
    const drag = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const a = tablePoint(from.x, from.y);
      const b = tablePoint(to.x, to.y);
      if (a && b) panBy(a.x - b.x, a.z - b.z);
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let start: { x: number; y: number } | null = null;
    let pinch: { dist: number; zoom: number } | null = null;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Trackpad pinches arrive as wheel events with ctrlKey; they need a stronger response.
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      zoomTo(useTableZoom.getState().zoom * factor, tablePoint(e.clientX, e.clientY));
    };
    const onDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY };
        markDragged(false);
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: useTableZoom.getState().zoom };
        markDragged(true);
      }
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const now = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, now);
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        zoomTo(pinch.zoom * (dist / Math.max(1, pinch.dist)), tablePoint(mid.x, mid.y));
        // Moving both fingers together pans: one finger's move shifts the midpoint by half as much.
        drag({ x: mid.x - (now.x - prev.x) / 2, y: mid.y - (now.y - prev.y) / 2 }, mid);
        return;
      }
      if (!start) return;
      if (!wasDragged() && Math.hypot(now.x - start.x, now.y - start.y) < 8) return;
      if (useTableZoom.getState().zoom <= 1.02) return;
      markDragged(true);
      drag(prev, now);
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) start = null;
    };
    const onDouble = (e: MouseEvent) => {
      const z = useTableZoom.getState().zoom;
      if (z > 1.05) resetZoom();
      else zoomTo(Math.min(MAX_ZOOM, 2.2), tablePoint(e.clientX, e.clientY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    el.addEventListener('dblclick', onDouble);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      el.removeEventListener('dblclick', onDouble);
    };
  }, [camera, gl, dims]);
  return null;
}

function ZoomControls() {
  const zoom = useTableZoom((s) => s.zoom);
  return (
    <div className="zoom-controls" aria-label="Zoom">
      <button
        className="zoom-btn"
        aria-label="Zoom ind"
        onClick={() => zoomTo(zoom * 1.35)}
        disabled={zoom >= MAX_ZOOM}
      >
        +
      </button>
      <button className="zoom-btn" aria-label="Zoom ud" onClick={() => zoomTo(zoom / 1.35)} disabled={zoom <= 1.001}>
        −
      </button>
      {zoom > 1.02 && (
        <button className="zoom-btn" aria-label="Vis hele bordet" onClick={resetZoom}>
          ⤢
        </button>
      )}
    </div>
  );
}

/** Projects the seat anchors to screen space every frame and moves the DOM labels there. */
function LabelProjector({
  layout,
  labels,
}: {
  layout: SceneLayout;
  labels: React.MutableRefObject<Map<number, HTMLDivElement>>;
}) {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const [player, el] of labels.current) {
      const a = layout.anchors[player];
      if (!a) continue;
      v.set(a.x, 0.1, a.labelZ).project(camera);
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.visibility = v.z < 1 ? 'visible' : 'hidden';
    }
  });
  return null;
}

function SeatLabels({
  model,
  thinking,
  labels,
}: {
  model: TableModel;
  thinking: number | null;
  labels: React.MutableRefObject<Map<number, HTMLDivElement>>;
}) {
  return (
    <div className="seat-labels" aria-hidden>
      {model.seats.map((seat) => {
        if (seat.isHuman) return null;
        return (
          <div
            key={seat.player}
            className={`seat-label${seat.active ? ' active' : ''}`}
            ref={(el) => {
              if (el) labels.current.set(seat.player, el);
              else labels.current.delete(seat.player);
            }}
          >
            <span className="seat-name">{seat.name}</span>
            <span className="seat-meta">
              {seat.handCount} kort · {seat.total} p{seat.opened ? ' · åben' : ''}
            </span>
            {thinking === seat.player && <span className="seat-thinking">tænker…</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function Table3D(props: Table3DProps) {
  const {
    state,
    model,
    layout,
    thinking,
    renames,
    canDraw,
    canTakeDiscard,
    highlightMelds,
    onDeck,
    onDiscard,
    onMeld,
    bottomInset,
    topInset,
  } = props;
  const focusX = model.current === model.humanSeat ? 0 : (layout.anchors[model.current]?.x ?? 0);
  const labels = useRef(new Map<number, HTMLDivElement>());
  // Every table starts with the whole table in view.
  useEffect(() => resetZoom, []);
  return (
    <div className="table-3d">
      <Canvas
        className="table-canvas"
        dpr={[1, 2]}
        camera={{ fov: 38, near: 0.1, far: 100, position: [0, 12, 9] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          cardMaterial(gl.capabilities.getMaxAnisotropy());
        }}
      >
        <color attach="background" args={['#0d1712']} />
        <hemisphereLight args={['#fff4e0', '#1b2a22', 0.55]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[2.5, 9, 6]} intensity={1.25} />
        <CameraRig bottomInset={bottomInset} topInset={topInset} focusX={focusX} dims={layout.dims} />
        <ZoomGestures dims={layout.dims} />
        <TableMesh dims={layout.dims} />
        <DeckBlock height={layout.deckHeight} x={layout.piles.deck.x} z={layout.piles.deck.z} />
        <ClickZone
          x={layout.piles.deck.x}
          z={layout.piles.deck.z}
          w={CARD_W + 0.25}
          d={CARD_H + 0.25}
          active={canDraw}
          glow={canDraw}
          onClick={onDeck}
        />
        <ClickZone
          x={layout.piles.discard.x}
          z={layout.piles.discard.z}
          w={CARD_W + 0.3}
          d={CARD_H + 0.3}
          active={canTakeDiscard}
          glow={canTakeDiscard}
          onClick={onDiscard}
        />
        {[...layout.meldBoxes].map(([id, box]) => (
          <ClickZone
            key={id}
            x={box.x}
            z={box.z}
            w={box.w}
            d={box.d}
            active={highlightMelds.has(id)}
            glow={highlightMelds.has(id)}
            onClick={() => onMeld(id)}
          />
        ))}
        <CardLayer state={state} layout={layout} humanSeat={model.humanSeat} renames={renames ?? null} />
        <LabelProjector layout={layout} labels={labels} />
      </Canvas>
      <SeatLabels model={model} thinking={thinking} labels={labels} />
      <ZoomControls />
    </div>
  );
}
