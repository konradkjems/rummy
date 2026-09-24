'use client';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NUM_ROUNDS, contractForRound, describeContract } from '@kova/rummy-engine';
import { DIFFICULTY_LABELS } from '@kova/rummy-ai';
import { type SavedGame, clearAll, listGames } from '@/lib/persistence';

interface Stats {
  played: number;
  wins: number;
  avgRound: number;
  closedRounds: number;
  rounds: number;
  currentStreak: number;
  bestStreak: number;
  bestGame: SavedGame | null;
  perRound: { round: number; avg: number; count: number }[];
  avgLoss: number | null;
  recent: SavedGame[];
}

function placement(g: SavedGame): number {
  const mine = g.totals[g.humanSeat];
  return 1 + g.totals.filter((t) => t < mine).length;
}

function computeStats(games: SavedGame[]): Stats {
  const finished = games.filter((g) => g.finished).sort((a, b) => a.updatedAt - b.updatedAt);
  let wins = 0;
  let streak = 0;
  let bestStreak = 0;
  let roundSum = 0;
  let rounds = 0;
  let closed = 0;
  let bestGame: SavedGame | null = null;
  const perRound = Array.from({ length: NUM_ROUNDS }, (_, i) => ({ round: i + 1, sum: 0, count: 0 }));
  let lossSum = 0;
  let lossCount = 0;
  for (const g of finished) {
    const won = placement(g) === 1;
    if (won) {
      wins++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
    } else {
      streak = 0;
    }
    if (!bestGame || g.totals[g.humanSeat] < bestGame.totals[bestGame.humanSeat]) bestGame = g;
    g.roundScores.forEach((r, i) => {
      const pts = r[g.humanSeat];
      roundSum += pts;
      rounds++;
      if (pts === 0) closed++;
      perRound[i].sum += pts;
      perRound[i].count++;
    });
    for (const rv of g.reviews) {
      if (rv) {
        lossSum += rv.totalLoss;
        lossCount++;
      }
    }
  }
  return {
    played: finished.length,
    wins,
    avgRound: rounds ? roundSum / rounds : 0,
    closedRounds: closed,
    rounds,
    currentStreak: streak,
    bestStreak,
    bestGame,
    perRound: perRound.map((r) => ({ round: r.round, avg: r.count ? r.sum / r.count : 0, count: r.count })),
    avgLoss: lossCount ? lossSum / lossCount : null,
    recent: finished.slice(-10).reverse(),
  };
}

function RoundBars({ data }: { data: Stats['perRound'] }) {
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
  const height = 200;
  const m = { l: 32, r: 8, t: 22, b: 26 };
  const w = width - m.l - m.r;
  const h = height - m.t - m.b;
  const max = Math.max(10, ...data.map((d) => d.avg));
  const top = Math.ceil(max / 10) * 10;
  const band = w / data.length;
  const bw = Math.min(24, band * 0.6);
  const y = (v: number) => m.t + h - (v / top) * h;
  const ticks = [0, top / 2, top];
  const bar = (x: number, v: number) => {
    const y0 = m.t + h;
    const y1 = y(v);
    const r = Math.min(4, (y0 - y1) / 2, bw / 2);
    return `M${x},${y0} L${x},${y1 + r} Q${x},${y1} ${x + r},${y1} L${x + bw - r},${y1} Q${x + bw},${y1} ${x + bw},${y1 + r} L${x + bw},${y0} Z`;
  };
  return (
    <div className="viz" ref={wrap}>
      <svg width={width} height={height} role="img" aria-label="Gennemsnitlige point pr. runde">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + w} y1={y(t)} y2={y(t)} className="viz-grid" />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" className="viz-tick">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = m.l + band * i + (band - bw) / 2;
          return (
            <g key={d.round}>
              {d.count > 0 && d.avg > 0 && (
                <path d={bar(x, d.avg)} className={`viz-bar series-1${hover === i ? ' hover' : ''}`} />
              )}
              {d.count > 0 && (
                <text x={x + bw / 2} y={y(d.avg) - 6} textAnchor="middle" className="viz-value">
                  {Math.round(d.avg)}
                </text>
              )}
              <text x={x + bw / 2} y={height - 8} textAnchor="middle" className="viz-tick">
                R{d.round}
              </text>
              <rect
                x={m.l + band * i}
                y={m.t}
                width={band}
                height={h}
                fill="transparent"
                tabIndex={0}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="viz-tooltip" style={{ left: Math.min(width - 180, Math.max(0, m.l + band * hover - 40)) }}>
          <div className="tt-head">
            Runde {data[hover].round} · {describeContract(contractForRound(data[hover].round))}
          </div>
          <div className="tt-row">
            <strong>{data[hover].count ? data[hover].avg.toFixed(1) : '–'} p</strong> i gennemsnit over{' '}
            {data[hover].count} runder
          </div>
        </div>
      )}
      <details className="viz-table">
        <summary>Vis som tabel</summary>
        <table>
          <thead>
            <tr>
              <th>Runde</th>
              <th>Kontrakt</th>
              <th className="num">Gns. point</th>
              <th className="num">Runder</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.round}>
                <td>{d.round}</td>
                <td>{describeContract(contractForRound(d.round))}</td>
                <td className="num">{d.count ? d.avg.toFixed(1) : '–'}</td>
                <td className="num">{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  useEffect(() => {
    listGames().then((g) => setStats(computeStats(g)));
  }, []);

  if (!stats) return <main className="page">Henter statistik…</main>;
  const winRate = stats.played ? Math.round((100 * stats.wins) / stats.played) : 0;
  return (
    <main className="page stats">
      <nav className="page-nav">
        <Link href="/">← Forsiden</Link>
      </nav>
      <h1>Statistik</h1>
      {stats.played === 0 ? (
        <p className="muted">
          Ingen færdige partier endnu. <Link href="/">Spil et parti</Link> – så fylder vi siden op.
        </p>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <span className="tile-label">Vundne partier</span>
              <span className="tile-value">{winRate}%</span>
              <span className="tile-sub">
                {stats.wins} af {stats.played}
              </span>
            </div>
            <div className="tile">
              <span className="tile-label">Point pr. runde</span>
              <span className="tile-value">{stats.avgRound.toFixed(1)}</span>
              <span className="tile-sub">lavere er bedre</span>
            </div>
            <div className="tile">
              <span className="tile-label">Streak</span>
              <span className="tile-value">{stats.currentStreak}</span>
              <span className="tile-sub">bedste: {stats.bestStreak}</span>
            </div>
            <div className="tile">
              <span className="tile-label">Bedste parti</span>
              <span className="tile-value">
                {stats.bestGame ? stats.bestGame.totals[stats.bestGame.humanSeat] : '–'}
              </span>
              <span className="tile-sub">point i alt</span>
            </div>
            <div className="tile">
              <span className="tile-label">Runder lukket</span>
              <span className="tile-value">{stats.closedRounds}</span>
              <span className="tile-sub">af {stats.rounds}</span>
            </div>
            <div className="tile">
              <span className="tile-label">Forventet tab pr. runde</span>
              <span className="tile-value">{stats.avgLoss === null ? '–' : stats.avgLoss.toFixed(1)}</span>
              <span className="tile-sub">ifølge AI Review</span>
            </div>
          </div>

          <section className="card-panel">
            <h2>Gennemsnitlige point pr. runde</h2>
            <RoundBars data={stats.perRound} />
          </section>

          <section className="card-panel">
            <h2>Seneste partier</h2>
            <table className="score-table">
              <thead>
                <tr>
                  <th>Dato</th>
                  <th>Modstander</th>
                  <th className="num">Placering</th>
                  <th className="num">Point</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((g) => (
                  <tr key={g.id}>
                    <td>{new Date(g.updatedAt).toLocaleDateString('da-DK')}</td>
                    <td>
                      {DIFFICULTY_LABELS[g.difficulty]} · {g.numPlayers} spillere
                    </td>
                    <td className="num">
                      {placement(g)}/{g.numPlayers}
                    </td>
                    <td className="num">{g.totals[g.humanSeat]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
      <button
        className="btn btn-ghost small danger"
        onClick={async () => {
          if (confirm('Slet alle gemte partier og al statistik på denne enhed?')) {
            await clearAll();
            setStats(computeStats([]));
          }
        }}
      >
        Nulstil statistik
      </button>
    </main>
  );
}
