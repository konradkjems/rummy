'use client';
/**
 * The human's hand as an HTML overlay: automatic grouping (complete melds,
 * "1 kort fra ..." groups, loose cards), tap to select, drag to reorder.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CardId } from '@kova/rummy-engine';
import { GROUP_LABEL, type HandGroup, groupHand } from '@/lib/hints';
import { CardSprite } from './CardSprite';

interface HandProps {
  hand: CardId[];
  order: CardId[] | null;
  selected: CardId[];
  playable: Set<CardId>;
  interactive: boolean;
  onToggle: (card: CardId) => void;
  onReorder: (order: CardId[] | null) => void;
}

interface Slot {
  card: CardId;
  x: number;
  group: number;
}

export function Hand({ hand, order, selected, playable, interactive, onToggle, onReorder }: HandProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [drag, setDrag] = useState<{ card: CardId; startX: number; dx: number; moved: boolean } | null>(null);
  const [fresh, setFresh] = useState<Set<CardId>>(new Set());
  const prevHand = useRef<CardId[]>(hand);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const added = hand.filter((c) => !prevHand.current.includes(c));
    prevHand.current = hand;
    if (added.length === 0 || added.length === hand.length) return;
    setFresh(new Set(added));
    const t = setTimeout(() => setFresh(new Set()), 1800);
    return () => clearTimeout(t);
  }, [hand]);

  const groups: HandGroup[] = useMemo(() => {
    if (order) {
      const cards = [...order.filter((c) => hand.includes(c)), ...hand.filter((c) => !order.includes(c))];
      return [{ kind: 'loose', cards }];
    }
    return groupHand(hand);
  }, [hand, order]);

  const flat = groups.flatMap((g, gi) => g.cards.map((card) => ({ card, group: gi })));
  const n = flat.length;
  const cardW = Math.max(46, Math.min(86, width * 0.155));
  const groupGap = order ? 0 : cardW * 0.22;
  const gaps = (groups.length - 1) * groupGap;
  const step = n > 1 ? Math.max(14, Math.min(cardW * 0.66, (width - 12 - cardW - gaps) / (n - 1))) : 0;
  const total = cardW + step * Math.max(0, n - 1) + gaps;
  const left0 = Math.max(6, (width - total) / 2);

  const slots: Slot[] = [];
  let x = left0;
  flat.forEach((item, i) => {
    if (i > 0) x += step + (item.group !== flat[i - 1].group ? groupGap : 0);
    slots.push({ card: item.card, x, group: item.group });
  });

  // While dragging, preview the new order.
  let display = slots;
  if (drag?.moved) {
    const from = slots.findIndex((s) => s.card === drag.card);
    const dragX = slots[from].x + drag.dx;
    let to = 0;
    for (let i = 0; i < slots.length; i++) if (dragX > slots[i].x - step / 2) to = i;
    const cards = slots.map((s) => s.card);
    cards.splice(from, 1);
    cards.splice(to, 0, drag.card);
    display = cards.map((card, i) => ({ card, x: left0 + i * step, group: 0 }));
  }

  const finishDrag = () => {
    if (!drag) return;
    if (!drag.moved) {
      if (interactive) onToggle(drag.card);
    } else {
      onReorder(display.map((s) => s.card));
    }
    setDrag(null);
  };

  // Group captions; a caption that would collide with its neighbour is dropped (the card tint still shows it).
  const labels: { key: number; text: string; x: number; kind: string; w: number }[] = [];
  if (!order) {
    let lastRight = -Infinity;
    groups.forEach((g, gi) => {
      const members = slots.filter((s) => s.group === gi);
      const text = GROUP_LABEL[g.kind];
      if (!text || members.length === 0) return;
      const x0 = members[0].x;
      const x1 = members[members.length - 1].x + cardW;
      const textW = text.length * 5.6 + 6;
      const center = (x0 + x1) / 2;
      if (center - textW / 2 < lastRight + 4) return;
      lastRight = center + textW / 2;
      labels.push({ key: gi, text, x: center, kind: g.kind, w: x1 - x0 });
    });
  }
  const nearCards = new Set(
    order ? [] : groups.filter((g) => g.kind === 'nearSet' || g.kind === 'nearRun').flatMap((g) => g.cards),
  );

  const height = cardW / 0.713;
  return (
    <div className="hand" ref={wrap} style={{ height: height + 34 }}>
      {labels.map((l) => (
        <div key={l.key} className={`hand-group-label ${l.kind}`} style={{ left: l.x }}>
          {l.text}
        </div>
      ))}
      {display.map((slot, i) => {
        const isSel = selected.includes(slot.card);
        const isDrag = drag?.card === slot.card && drag.moved;
        const tx = isDrag ? slots.find((s) => s.card === slot.card)!.x + drag!.dx : slot.x;
        return (
          <div
            key={slot.card}
            className={`hand-card${isSel ? ' selected' : ''}${playable.has(slot.card) ? ' playable' : ''}${fresh.has(slot.card) ? ' fresh' : ''}${isDrag ? ' dragging' : ''}${nearCards.has(slot.card) ? ' near' : ''}`}
            style={{
              transform: `translate(${tx}px, ${isSel ? -18 : 0}px)`,
              zIndex: isDrag ? 100 : i + 1,
              width: cardW,
            }}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              setDrag({ card: slot.card, startX: e.clientX, dx: 0, moved: false });
            }}
            onPointerMove={(e) => {
              if (!drag || drag.card !== slot.card) return;
              const dx = e.clientX - drag.startX;
              if (drag.moved || Math.abs(dx) > 8) setDrag({ ...drag, dx, moved: true });
            }}
            onPointerUp={finishDrag}
            onPointerCancel={() => setDrag(null)}
            role="button"
            tabIndex={0}
            aria-pressed={isSel}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && interactive) {
                e.preventDefault();
                onToggle(slot.card);
              }
            }}
          >
            <CardSprite card={slot.card} width={cardW} />
          </div>
        );
      })}
      {order && (
        <button className="hand-autosort" onClick={() => onReorder(null)} title="Sortér automatisk">
          Auto-sortér
        </button>
      )}
    </div>
  );
}
