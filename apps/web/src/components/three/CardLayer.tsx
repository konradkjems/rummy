'use client';
/**
 * Every visible card is a mesh that eases towards the pose computed by the
 * mapping layer: it lifts in an arc while travelling, flips when its side
 * changes and gives a small "snap" when it lands in a meld.
 */
import { useFrame } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { type CardId, type GameState, cardType } from '@kova/rummy-engine';
import { BACK_CELL } from '@/lib/cardArt';
import { type Pose, type SceneLayout, handAnchor } from '@/lib/tableModel';
import { cardGeometry, cardMaterial } from './cardAssets';

type Where = 'deck' | 'discard' | 'meld' | 'human' | 'opponent' | 'none';

function locate(state: GameState | null, id: CardId, human: number): Where {
  if (!state) return 'none';
  if (state.hands[human].includes(id)) return 'human';
  if (state.hands.some((h, p) => p !== human && h.includes(id))) return 'opponent';
  if (state.deck.includes(id)) return 'deck';
  if (state.discard.includes(id)) return 'discard';
  if (state.melds.some((m) => m.cards.includes(id))) return 'meld';
  return 'none';
}

function anchorPose(where: Where, layout: SceneLayout, faceUp: boolean): Pose | null {
  switch (where) {
    case 'human':
      return { ...handAnchor(layout.dims), faceUp };
    case 'deck':
      return {
        x: layout.piles.deck.x,
        y: layout.deckHeight + 0.01,
        z: layout.piles.deck.z,
        rotY: 0,
        faceUp: false,
        scale: 1,
      };
    case 'discard':
      return { x: layout.piles.discard.x, y: 0.01, z: layout.piles.discard.z, rotY: 0, faceUp: true, scale: 1 };
    default:
      return null;
  }
}

interface Entry {
  id: CardId;
  target: Pose;
  start: Pose;
  exiting: boolean;
  /** Face may be shown (it is public or ours). */
  reveal: boolean;
}

interface CardProps {
  entry: Entry;
  onGone: (id: CardId) => void;
}

const CardMesh = memo(function CardMesh({ entry, onGone }: CardProps) {
  const ref = useRef<THREE.Mesh>(null);
  const cur = useRef({ ...entry.start, roll: entry.start.faceUp ? 0 : Math.PI, travelled: 0, pulse: 1 });
  const target = entry.target;
  const faceCell = entry.reveal ? cardType(entry.id) : BACK_CELL;
  const geometry = useMemo(() => cardGeometry(faceCell), [faceCell]);

  useFrame((_, rawDt) => {
    const mesh = ref.current;
    if (!mesh) return;
    const dt = Math.min(rawDt, 0.05);
    const c = cur.current;
    const k = 1 - Math.exp(-dt * 8.5);
    const dx = target.x - c.x;
    const dz = target.z - c.z;
    const dist = Math.hypot(dx, dz);
    c.x += dx * k;
    c.z += dz * k;
    const lift = Math.min(0.85, dist * 0.32);
    c.y += (target.y + lift - c.y) * k;
    let dr = target.rotY - c.rotY;
    if (dr > Math.PI) dr -= Math.PI * 2;
    if (dr < -Math.PI) dr += Math.PI * 2;
    c.rotY += dr * k;
    const roll = target.faceUp ? 0 : Math.PI;
    c.roll += (roll - c.roll) * (1 - Math.exp(-dt * 7));
    c.scale += (target.scale - c.scale) * k;
    // Snap: a card that travelled and has now landed gives a short bounce.
    if (dist > 0.6) {
      c.travelled = Math.max(c.travelled, dist);
      c.pulse = 0;
    } else if (c.travelled > 0.6 && dist < 0.03) {
      c.travelled = 0;
      c.pulse = 0.0001;
    }
    let bounce = 1;
    if (c.pulse > 0 && c.pulse < 1) {
      c.pulse = Math.min(1, c.pulse + dt * 3.2);
      bounce = 1 + Math.sin(c.pulse * Math.PI) * 0.12 * (1 - c.pulse);
    }
    mesh.position.set(c.x, c.y, c.z);
    mesh.rotation.set(0, c.rotY, c.roll);
    const s = c.scale * bounce;
    mesh.scale.set(s, 1, s);
    if (entry.exiting && dist < 0.08) onGone(entry.id);
  });

  return <mesh ref={ref} geometry={geometry} material={cardMaterial()} renderOrder={1} />;
});

interface CardLayerProps {
  state: GameState | null;
  layout: SceneLayout;
  humanSeat: number;
}

export function CardLayer({ state, layout, humanSeat }: CardLayerProps) {
  const prevState = useRef<GameState | null>(null);
  const [entries, setEntries] = useState<Map<CardId, Entry>>(new Map());

  useEffect(() => {
    setEntries((old) => {
      const next = new Map<CardId, Entry>();
      const prev = prevState.current;
      for (const [id, pose] of layout.poses) {
        const existing = old.get(id);
        // Only public cards show their face; face-down cards use the back on both sides.
        const reveal = pose.faceUp;
        if (existing && !existing.exiting) {
          next.set(id, { ...existing, target: pose, reveal });
          continue;
        }
        const where = locate(prev, id, humanSeat);
        const from = anchorPose(where, layout, where === 'human' || pose.faceUp) ?? pose;
        next.set(id, { id, target: pose, start: existing ? existing.target : from, exiting: false, reveal });
      }
      // Cards that left the visible set fly to where they went, then unmount.
      for (const [id, entry] of old) {
        if (next.has(id)) continue;
        if (entry.exiting) {
          next.set(id, entry);
          continue;
        }
        const where = locate(state, id, humanSeat);
        const exitPose = anchorPose(where, layout, where === 'human' || entry.target.faceUp);
        if (exitPose)
          next.set(id, { ...entry, target: exitPose, exiting: true, reveal: entry.reveal || where === 'human' });
      }
      return next;
    });
    prevState.current = state;
  }, [layout, state, humanSeat]);

  const onGone = useMemo(
    () => (id: CardId) =>
      setEntries((old) => {
        const e = old.get(id);
        if (!e || !e.exiting) return old;
        const next = new Map(old);
        next.delete(id);
        return next;
      }),
    [],
  );

  return (
    <group>
      {[...entries.values()].map((entry) => (
        <CardMesh key={entry.id} entry={entry} onGone={onGone} />
      ))}
    </group>
  );
}
