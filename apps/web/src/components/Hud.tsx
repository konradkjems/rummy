'use client';
import Link from 'next/link';
import { type CardId, type GameState, NUM_ROUNDS, contractForRound, describeContract } from '@kova/rummy-engine';
import { contractProgress } from '@/lib/hints';

interface HudProps {
  state: GameState;
  names: string[];
  humanSeat: number;
  hand: CardId[];
  onMenu: () => void;
}

export function Hud({ state, names, humanSeat, hand, onMenu }: HudProps) {
  const contract = contractForRound(state.round);
  const opened = state.openedTurn[humanSeat] >= 0;
  const progress = opened ? null : contractProgress(hand, contract);
  const live = state.phase.type === 'draw' || state.phase.type === 'meld' || state.phase.type === 'buy';
  return (
    <header className="hud">
      <button className="hud-menu" onClick={onMenu} aria-label="Menu">
        ☰
      </button>
      <div className="hud-contract">
        <div className="hud-round">
          Runde {state.round}/{NUM_ROUNDS}
        </div>
        <div className="hud-contract-text">{describeContract(contract)}</div>
        <div className="hud-progress" aria-label="Fremskridt mod kontrakten">
          {opened ? (
            <span className="chip done">Du er åben</span>
          ) : progress?.ready ? (
            <span className="chip ready">Klar til at åbne</span>
          ) : (
            <>
              {Array.from({ length: contract.sets }, (_, i) => (
                <span key={`s${i}`} className={`chip ${i < (progress?.sets ?? 0) ? 'done' : ''}`}>
                  Passer
                </span>
              ))}
              {Array.from({ length: contract.runs }, (_, i) => (
                <span key={`r${i}`} className={`chip ${i < (progress?.runs ?? 0) ? 'done' : ''}`}>
                  Løber
                </span>
              ))}
            </>
          )}
        </div>
      </div>
      <ol className="hud-scores" aria-label="Point">
        {names.map((name, p) => (
          <li key={p} className={live && state.current === p ? 'active' : ''}>
            <span className="hud-name">{name}</span>
            <span className="hud-total">{state.totals[p]}</span>
          </li>
        ))}
      </ol>
      <Link href="/" className="sr-only">
        Til forsiden
      </Link>
    </header>
  );
}
