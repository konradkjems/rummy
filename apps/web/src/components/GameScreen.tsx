'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  type Action,
  type CardId,
  type MeldSpec,
  canBuildNow,
  cardLabel,
  contractForRound,
  describeContract,
  interpretGroup,
} from '@kova/rummy-engine';
import { type CardThemeId, setCardTheme } from '@/lib/cardThemes';
import { type GameDriver, clearSelection, controller, setHandOrder, toggleSelect, useGame } from '@/lib/game';
import { type BuildOption, bestMelds, buildOptions, canOpen, meldTitle, playableCards } from '@/lib/hints';
import { translate } from '@/lib/messages';
import { saveSettings, webglAvailable } from '@/lib/settings';
import { buildTableModel, layoutScene, tableDims } from '@/lib/tableModel';
import { BuyPrompt } from './BuyPrompt';
import { CardThemePicker } from './CardThemePicker';
import { Hand } from './Hand';
import { Hud } from './Hud';
import { OpenSheet } from './OpenSheet';
import { RoundSummary } from './RoundSummary';
import Table2D from './Table2D';

const Table3D = dynamic(() => import('./three/Table3D'), {
  ssr: false,
  loading: () => <div className="table-loading">Stiller bordet op…</div>,
});

/** Seconds left until a local-clock deadline, ticking once a second. */
function useCountdown(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

export default function GameScreen({ driver }: { driver: GameDriver }) {
  const router = useRouter();
  const { state, game, selected, handOrder, thinking, buyPrompt, flash, review, settings, error, renames, online } =
    useGame();
  const onlinePlay = driver.kind === 'online';
  const [sheet, setSheet] = useState<null | 'open' | 'meld'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [choice, setChoice] = useState<{ meldId: number; options: BuildOption[] } | null>(null);
  const [use3d, setUse3d] = useState(false);
  const [booting, setBooting] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  const [bottomInset, setBottomInset] = useState(0.34);
  const [topInset, setTopInset] = useState(0.12);

  // Boot: solo keeps the running game, otherwise resumes the latest unfinished one or starts fresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await driver.boot();
      if (cancelled) return;
      setUse3d(useGame.getState().settings.mode3d && webglAvailable());
      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [driver]);

  // The 3D camera frames the table between the HUD and the hand overlay.
  useLayoutEffect(() => {
    const el = bottom.current;
    const hud = document.querySelector('.hud') as HTMLElement | null;
    if (!el) return;
    const measure = () => {
      const h = Math.max(1, window.innerHeight);
      setBottomInset(Math.min(0.6, el.offsetHeight / h));
      if (hud) setTopInset(Math.min(0.3, (hud.offsetHeight + 8) / h));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (hud) ro.observe(hud);
    measure();
    return () => ro.disconnect();
  }, [booting]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  const [flashVisible, setFlashVisible] = useState<typeof flash>(null);
  useEffect(() => {
    if (!flash) return;
    setFlashVisible(flash);
    const t = setTimeout(() => setFlashVisible(null), flash.celebrate ? 2900 : 1900);
    return () => clearTimeout(t);
  }, [flash]);

  const [portrait, setPortrait] = useState(true);
  useEffect(() => {
    const update = () => setPortrait(window.innerWidth < window.innerHeight * 1.05);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const names = useMemo(() => game?.names ?? [], [game?.names]);
  const me = game?.humanSeat ?? 0;
  const model = useMemo(() => (state ? buildTableModel(state, names, me) : null), [state, names, me]);
  const layout = useMemo(() => (model ? layoutScene(model, tableDims(portrait)) : null), [model, portrait]);
  const turnLeft = useCountdown(online?.turnDeadline ?? null);
  const nextLeft = useCountdown(online?.nextDeadline ?? null);

  if (booting || !state || !game || !model || !layout) {
    return <div className="table-loading">{error ?? 'Blander kortene…'}</div>;
  }

  const hand = state.hands[me];
  const ph = state.phase;
  const myTurn = (ph.type === 'draw' || ph.type === 'meld') && state.current === me;
  const canDraw = myTurn && ph.type === 'draw';
  const canTakeDiscard = canDraw && state.discard.length > 0;
  const inMeld = myTurn && ph.type === 'meld';
  const opened = state.openedTurn[me] >= 0;
  const canBuild = inMeld && canBuildNow(state, me);
  const contract = contractForRound(state.round);
  const ready = inMeld && !opened && canOpen(hand, contract);
  const single = selected.length === 1 ? selected[0] : null;
  const options = single !== null && canBuild ? buildOptions(state, me, single) : [];
  const highlight = new Set(options.map((o) => o.meld.id));
  const playable = canBuild ? playableCards(state, me) : new Set<CardId>();
  const newMeld =
    canBuild && state.config.rules.newMeldsAfterOpening && selected.length >= 3 ? interpretGroup(selected) : null;
  const canLayMore = canBuild && state.config.rules.newMeldsAfterOpening && bestMelds(hand).length > 0;
  const topDiscard = state.discard[state.discard.length - 1];

  const act = (action: Action) => {
    const err = driver.act(action);
    if (err) setNotice(translate(err));
    setChoice(null);
  };

  const onMeld = (meldId: number) => {
    const opts = options.filter((o) => o.meld.id === meldId);
    if (opts.length === 0 || single === null) return;
    if (opts.length === 1) return perform(opts[0], single);
    setChoice({ meldId, options: opts });
  };

  const perform = (opt: BuildOption, card: CardId) => {
    clearSelection();
    if (opt.kind === 'swap') act({ type: 'SwapJoker', player: me, meldId: opt.meld.id, card });
    else act({ type: 'Extend', player: me, meldId: opt.meld.id, card, end: opt.end });
  };

  const confirmMelds = (melds: MeldSpec[]) => {
    setSheet(null);
    clearSelection();
    if (sheet === 'open') {
      act({ type: 'Open', player: me, melds });
    } else if (onlinePlay) {
      // The server checks each meld against the table as it is when it arrives.
      for (const meld of melds) act({ type: 'LayMeld', player: me, meld });
    } else {
      for (const meld of melds) {
        const err = driver.act({ type: 'LayMeld', player: me, meld });
        if (err) {
          setNotice(translate(err));
          break;
        }
      }
    }
  };

  const discarderName = ph.type === 'buy' && ph.discarder !== null ? names[ph.discarder] : null;

  let status: string;
  if (ph.type === 'buy') status = buyPrompt ? 'Køb eller lad være' : 'Køb-vinduet er åbent…';
  else if (!myTurn) status = thinking !== null ? `${names[thinking]} tænker…` : `${names[state.current]}s tur`;
  else if (canDraw) status = 'Din tur: træk blindt eller tag det øverste kort';
  else if (!opened) status = ready ? 'Du kan åbne!' : `Saml ${describeContract(contract)} – og smid et kort`;
  else if (!canBuild) status = 'Du kan bygge videre fra næste tur. Smid et kort.';
  else status = selected.length ? 'Vælg hvor kortet skal hen' : 'Byg på bordet eller smid et kort';
  // Online: the turn clock, and who is away.
  const away = online && !myTurn && online.connected[state.current] === false;
  if (away && (ph.type === 'draw' || ph.type === 'meld'))
    status = `${names[state.current]} er væk – computeren spiller snart`;
  const clock = turnLeft !== null && (ph.type === 'draw' || ph.type === 'meld') ? turnLeft : null;
  const hurry = myTurn && clock !== null && clock <= 15;

  const toggle3d = () => {
    const next = !use3d;
    if (next && !webglAvailable()) {
      setNotice('3D kræver WebGL, som ikke er tilgængeligt her.');
      return;
    }
    setUse3d(next);
    const s = { ...settings, mode3d: next };
    controller.updateSettings(s);
    saveSettings(s);
  };

  const changeTheme = (cardTheme: CardThemeId) => {
    const s = { ...settings, cardTheme };
    controller.updateSettings(s);
    saveSettings(s);
    setCardTheme(cardTheme);
  };

  const tableProps = {
    canDraw,
    canTakeDiscard,
    highlightMelds: highlight,
    onDeck: () => act({ type: 'DrawFromDeck', player: me }),
    onDiscard: () => act({ type: 'DrawFromDiscard', player: me }),
    onMeld,
  };

  return (
    <div className="game">
      <Hud state={state} names={names} humanSeat={me} hand={hand} onMenu={() => setMenu(true)} />
      <div className="table-area">
        {use3d ? (
          <Table3D
            state={state}
            model={model}
            layout={layout}
            thinking={thinking}
            renames={renames}
            bottomInset={bottomInset}
            topInset={topInset}
            {...tableProps}
          />
        ) : (
          <Table2D model={model} thinking={thinking} {...tableProps} />
        )}
      </div>

      {flashVisible && (
        <div key={flashVisible.id} className={`flash flash-${flashVisible.tone}`}>
          {flashVisible.text}
        </div>
      )}
      {flashVisible?.celebrate && <Confetti key={`c${flashVisible.id}`} />}
      {notice && <div className="notice">{notice}</div>}

      <div className="bottom" ref={bottom}>
        <div className="action-bar">
          <div className={`status${hurry ? ' hurry' : ''}`} aria-live="polite">
            {status}
            {clock !== null && <span className="turn-clock"> · {clock} s</span>}
          </div>
          <div className="actions">
            {canDraw && (
              <>
                <button className="btn btn-primary" onClick={tableProps.onDeck}>
                  Træk blindt
                </button>
                {topDiscard !== undefined && (
                  <button className="btn" onClick={tableProps.onDiscard}>
                    Tag {cardLabel(topDiscard)}
                  </button>
                )}
              </>
            )}
            {ready && (
              <button className="btn btn-primary pulse" onClick={() => setSheet('open')}>
                Åbn
              </button>
            )}
            {single !== null &&
              options.slice(0, 3).map((o, i) => (
                <button key={i} className="btn" onClick={() => perform(o, single)}>
                  {o.kind === 'swap' ? `Byt joker i ${meldTitle(o.meld)}` : `Læg på ${meldTitle(o.meld)}`}
                </button>
              ))}
            {newMeld && (
              <button className="btn" onClick={() => confirmMeldsDirect(newMeld)}>
                Læg {newMeld.kind === 'set' ? 'passer' : 'løber'}
              </button>
            )}
            {!newMeld && canLayMore && selected.length === 0 && (
              <button className="btn" onClick={() => setSheet('meld')}>
                Nye meldinger
              </button>
            )}
            {inMeld && (
              <button
                className="btn btn-discard"
                disabled={single === null}
                onClick={() => single !== null && act({ type: 'Discard', player: me, card: single })}
              >
                {single !== null ? `Smid ${cardLabel(single)}` : 'Smid'}
              </button>
            )}
          </div>
        </div>
        <Hand
          hand={hand}
          order={handOrder}
          selected={selected}
          playable={playable}
          interactive={ph.type !== 'roundOver' && ph.type !== 'gameOver'}
          onToggle={toggleSelect}
          onReorder={setHandOrder}
        />
      </div>

      {buyPrompt && ph.type === 'buy' && (
        <BuyPrompt
          prompt={buyPrompt}
          discarder={discarderName}
          onBuy={() => act({ type: 'BuyClaim', player: me })}
          onPass={() => act({ type: 'BuyPass', player: me })}
        />
      )}

      {choice && single !== null && (
        <div className="sheet-backdrop" onClick={() => setChoice(null)}>
          <div className="sheet small" onClick={(e) => e.stopPropagation()}>
            <h2>Hvor skal {cardLabel(single)} hen?</h2>
            <div className="sheet-actions column">
              {choice.options.map((o, i) => (
                <button key={i} className="btn" onClick={() => perform(o, single)}>
                  {o.kind === 'swap'
                    ? 'Byt jokeren ud'
                    : o.end === 'low'
                      ? 'Læg i den lave ende'
                      : 'Læg i den høje ende'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {sheet && (
        <OpenSheet
          hand={hand}
          contract={sheet === 'open' ? contract : null}
          onConfirm={confirmMelds}
          onClose={() => setSheet(null)}
        />
      )}

      <RoundSummary
        state={state}
        names={names}
        humanSeat={me}
        review={review}
        onNext={() => driver.nextRound()}
        onNewGame={() => driver.newGame()}
        online={
          online
            ? {
                ready: online.ready.includes(me),
                readyCount: online.ready.length,
                people: online.bots.filter((b, p) => !b && online.connected[p]).length,
                secondsLeft: nextLeft,
                isHost: online.isHost,
                onLeave: () => {
                  driver.leave();
                  router.push('/online/');
                },
              }
            : undefined
        }
      />

      {menu && (
        <div className="modal-backdrop" onClick={() => setMenu(false)}>
          <div className="modal menu" onClick={(e) => e.stopPropagation()}>
            <h2>Menu</h2>
            <button className="btn btn-primary" onClick={() => setMenu(false)}>
              Fortsæt spillet
            </button>
            <button className="btn" onClick={toggle3d}>
              {use3d ? 'Skift til 2D-bord' : 'Skift til 3D-bord'}
            </button>
            <div className="menu-section">
              <h3>Kortdesign</h3>
              <CardThemePicker value={settings.cardTheme} onChange={changeTheme} />
            </div>
            <Link className="btn" href="/regler/" target={onlinePlay ? '_blank' : undefined}>
              Regler
            </Link>
            {onlinePlay ? (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  if (!window.confirm('Forlad bordet? Computeren spiller videre på din plads.')) return;
                  driver.leave();
                  router.push('/online/');
                }}
              >
                Forlad bordet
              </button>
            ) : (
              <button
                className="btn btn-ghost"
                onClick={() => {
                  driver.leave();
                  router.push('/');
                }}
              >
                Til forsiden (spillet gemmes)
              </button>
            )}
          </div>
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
    </div>
  );

  function confirmMeldsDirect(meld: MeldSpec) {
    clearSelection();
    act({ type: 'LayMeld', player: me, meld });
  }
}

const CONFETTI_COLORS = ['#e8bb52', '#c0263a', '#3987e5', '#52c28a', '#fbf7ee'];

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        dx: (Math.random() - 0.5) * 160,
        rot: (Math.random() - 0.5) * 1080,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    [],
  );
  return (
    <div className="celebrate" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti"
          style={
            {
              left: `${p.left}%`,
              background: p.color,
              animationDelay: `${p.delay}s`,
              '--dx': `${p.dx}px`,
              '--rot': `${p.rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
