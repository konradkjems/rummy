'use client';
/**
 * Opening (and laying new melds after opening): the suggested split from the
 * contract validator, or a manual builder where the player forms the groups.
 */
import { useMemo, useState } from 'react';
import {
  type CardId,
  type Contract,
  type MeldSpec,
  describeContract,
  findBestOpening,
  interpretGroup,
  specsMeetContract,
} from '@kova/rummy-engine';
import { CardSprite } from './CardSprite';

interface Props {
  hand: CardId[];
  /** The round contract, or null when laying extra melds after opening. */
  contract: Contract | null;
  onConfirm: (melds: MeldSpec[]) => void;
  onClose: () => void;
}

const kindLabel = (m: MeldSpec) => (m.kind === 'set' ? 'Passer' : 'Løber');

export function OpenSheet({ hand, contract, onConfirm, onClose }: Props) {
  const suggestion = useMemo(() => findBestOpening(hand, contract ?? { sets: 0, runs: 0 }) ?? [], [hand, contract]);
  const [manual, setManual] = useState(false);
  const [groups, setGroups] = useState<MeldSpec[]>([]);
  const [current, setCurrent] = useState<CardId[]>([]);

  const used = new Set([...groups.flatMap((g) => g.cards), ...current]);
  const currentSpec = current.length >= 3 ? interpretGroup(current) : null;
  const valid = contract ? specsMeetContract(groups, contract) && groups.length > 0 : groups.length > 0;
  const title = contract ? `Åbn: ${describeContract(contract)}` : 'Læg nye meldinger';

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost small" onClick={onClose}>
            Luk
          </button>
        </div>
        {!manual ? (
          <>
            {suggestion.length === 0 ? (
              <p className="muted">Der er ingen gyldig melding på hånden lige nu.</p>
            ) : (
              <>
                <p className="muted">Forslag: flest mulige point lagt ned på én gang.</p>
                <div className="meld-list">
                  {suggestion.map((m, i) => (
                    <div key={i} className="meld-row">
                      <span className="meld-kind">{kindLabel(m)}</span>
                      <div className="meld-cards">
                        {m.cards.map((c) => (
                          <CardSprite key={c} card={c} width={42} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="sheet-actions">
              <button
                className="btn btn-primary"
                disabled={suggestion.length === 0}
                onClick={() => onConfirm(suggestion)}
              >
                Læg ned
              </button>
              <button className="btn btn-ghost" onClick={() => setManual(true)}>
                Vælg selv
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Tryk på kort for at samle en gruppe. En gruppe bliver gyldig ved 3+ kort.</p>
            <div className="meld-list">
              {groups.map((m, i) => (
                <div key={i} className="meld-row">
                  <span className="meld-kind">{kindLabel(m)}</span>
                  <div className="meld-cards">
                    {m.cards.map((c) => (
                      <CardSprite key={c} card={c} width={38} />
                    ))}
                  </div>
                  <button className="btn btn-ghost small" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>
                    Fjern
                  </button>
                </div>
              ))}
              <div className="meld-row current">
                <span className="meld-kind">{currentSpec ? `${kindLabel(currentSpec)} ✓` : 'Ny gruppe'}</span>
                <div className="meld-cards">
                  {current.map((c) => (
                    <button key={c} className="card-btn" onClick={() => setCurrent(current.filter((x) => x !== c))}>
                      <CardSprite card={c} width={38} />
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn-primary small"
                  disabled={!currentSpec}
                  onClick={() => {
                    if (!currentSpec) return;
                    setGroups([...groups, currentSpec]);
                    setCurrent([]);
                  }}
                >
                  Tilføj
                </button>
              </div>
            </div>
            <div className="sheet-hand">
              {hand
                .filter((c) => !used.has(c))
                .map((c) => (
                  <button key={c} className="card-btn" onClick={() => setCurrent([...current, c])}>
                    <CardSprite card={c} width={44} />
                  </button>
                ))}
            </div>
            <div className="sheet-actions">
              <button className="btn btn-primary" disabled={!valid} onClick={() => onConfirm(groups)}>
                Læg ned
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setManual(false);
                  setGroups([]);
                  setCurrent([]);
                }}
              >
                Brug forslaget
              </button>
            </div>
            {contract && !valid && groups.length > 0 && <p className="warn">Grupperne dækker ikke kontrakten endnu.</p>}
          </>
        )}
      </div>
    </div>
  );
}
