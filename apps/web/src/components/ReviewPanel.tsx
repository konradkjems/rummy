'use client';
/**
 * AI Review after a round: expected final round points after each of the
 * player's decisions (line chart, with the best alternative for comparison)
 * and the two most expensive decisions explained.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReviewedDecision, RoundReview } from '@kova/rummy-ai';

const KIND_LABEL: Record<ReviewedDecision['kind'], string> = { draw: 'Træk', buy: 'Køb', turn: 'Melding og smid' };

function niceMax(v: number): number {
  if (v <= 10) return 10;
  const step = v <= 50 ? 10 : v <= 100 ? 20 : 50;
  return Math.ceil(v / step) * step;
}

function ExpectedChart({ review }: { review: RoundReview }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const points = review.decisions
    .map((d, i) => ({ i, d }))
    .filter(({ d }) => Number.isFinite(d.expected) && Number.isFinite(d.bestExpected));
  if (points.length < 2) return <p className="muted">For få beslutninger at tegne en kurve for.</p>;

  const height = 190;
  const m = { l: 34, r: 52, t: 14, b: 26 };
  const w = Math.max(160, width - m.l - m.r);
  const h = height - m.t - m.b;
  const maxY = niceMax(Math.max(...points.map((p) => Math.max(p.d.expected, p.d.bestExpected)), review.finalPoints));
  const n = review.decisions.length;
  const x = (i: number) => m.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => m.t + h - (v / maxY) * h;
  const path = (key: 'expected' | 'bestExpected') =>
    points.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.d[key]).toFixed(1)}`).join(' ');
  const mistakes = new Map(review.mistakes.map((mk, k) => [review.decisions.indexOf(mk), k + 1]));
  const last = points[points.length - 1];
  const endChosen = y(last.d.expected);
  const endBest = y(last.d.bestExpected);
  const labelsFit = Math.abs(endChosen - endBest) >= 14;
  const ticks = [0, maxY / 2, maxY];
  const hovered = hover !== null ? review.decisions[hover] : null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = points[0].i;
    for (const p of points) if (Math.abs(x(p.i) - m.l - px) < Math.abs(x(best) - m.l - px)) best = p.i;
    setHover(best);
  };

  return (
    <div className="viz" ref={wrap}>
      <div className="viz-legend" aria-hidden>
        <span>
          <i className="key key-1" /> Dit valg
        </span>
        <span>
          <i className="key key-2" /> Bedste alternativ
        </span>
      </div>
      <svg width={width} height={height} role="img" aria-label="Forventet slutscore for runden efter hver beslutning">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + w} y1={y(t)} y2={y(t)} className="viz-grid" />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="viz-tick">
              {Math.round(t)}
            </text>
          </g>
        ))}
        <text x={m.l} y={height - 6} className="viz-tick">
          Første beslutning
        </text>
        <text x={m.l + w} y={height - 6} textAnchor="end" className="viz-tick">
          Sidste
        </text>
        <path d={path('bestExpected')} className="viz-line series-2" />
        <path d={path('expected')} className="viz-line series-1" />
        {[...mistakes].map(([idx, k]) => {
          const d = review.decisions[idx];
          return (
            <g key={idx}>
              <circle cx={x(idx)} cy={y(d.expected)} r={5} className="viz-dot series-1" />
              <text x={x(idx)} y={y(d.expected) - 10} textAnchor="middle" className="viz-mark-label">
                {k}
              </text>
            </g>
          );
        })}
        {labelsFit && (
          <>
            <text x={m.l + w + 8} y={endChosen + 4} className="viz-end">
              {Math.round(last.d.expected)} p
            </text>
            <text x={m.l + w + 8} y={endBest + 4} className="viz-end muted">
              {Math.round(last.d.bestExpected)} p
            </text>
          </>
        )}
        {hovered && hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + h} className="viz-crosshair" />
        )}
        <rect
          x={m.l}
          y={m.t}
          width={w}
          height={h}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hovered && hover !== null && (
        <div className="viz-tooltip" style={{ left: Math.min(width - 170, Math.max(0, x(hover) - 80)) }}>
          <div className="tt-head">
            {KIND_LABEL[hovered.kind]} · tur {hovered.turn}
          </div>
          <div className="tt-row">
            <i className="key key-1" />
            <strong>{Math.round(hovered.expected)} p</strong> {hovered.chosenLabel}
          </div>
          <div className="tt-row">
            <i className="key key-2" />
            <strong>{Math.round(hovered.bestExpected)} p</strong> {hovered.bestLabel}
          </div>
        </div>
      )}
      <details className="viz-table">
        <summary>Vis som tabel</summary>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Beslutning</th>
              <th>Dit valg</th>
              <th>Bedste</th>
              <th>Tab</th>
            </tr>
          </thead>
          <tbody>
            {review.decisions.map((d, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  {KIND_LABEL[d.kind]}: {d.chosenLabel}
                </td>
                <td className="num">{Number.isFinite(d.expected) ? Math.round(d.expected) : '–'}</td>
                <td className="num">{Number.isFinite(d.bestExpected) ? Math.round(d.bestExpected) : '–'}</td>
                <td className="num">{d.loss.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function ReviewPanel({ review }: { review: RoundReview }) {
  return (
    <section className="review">
      <h3>AI Review</h3>
      <p className="muted small">
        Forventet slutscore for runden efter hvert af dine valg, målt med tusindvis af simulerede fortsættelser. Lavere
        er bedre.
      </p>
      <ExpectedChart review={review} />
      {review.mistakes.length === 0 ? (
        <p className="review-clean">Ingen dyre fejl i denne runde. Flot spillet!</p>
      ) : (
        <ol className="mistakes">
          {review.mistakes.map((m, i) => (
            <li key={i}>
              <div className="mistake-head">
                <span className="mistake-no">{i + 1}</span>
                <span>
                  {KIND_LABEL[m.kind]} · tur {m.turn}
                </span>
                <span className="mistake-loss">−{m.loss.toFixed(1)} p</span>
              </div>
              <p>{m.explanation}</p>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">
        Samlet forventet tab i runden: <strong>{review.totalLoss.toFixed(1)} point</strong>.
      </p>
    </section>
  );
}
