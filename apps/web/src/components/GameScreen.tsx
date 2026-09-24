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
  canMeetContract,
  cardLabel,
  contractForRound,
  describeContract,
  findBestOpening,
  interpretGroup,
} from '@kova/rummy-engine';
import { HUMAN, controller, useGame } from '@/lib/game';
import { type BuildOption, buildOptions, meldTitle, playableCards } from '@/lib/hints';
import { latestUnfinished } from '@/lib/persistence';
import { loadSettings, saveSettings, webglAvailable } from '@/lib/settings';
import { buildTableModel, layoutScene, tableDims } from '@/lib/tableModel';
import { BuyPrompt } from './BuyPrompt';
import { Hand } from './Hand';
import { Hud } from './Hud';
import { OpenSheet } from './OpenSheet';
import { RoundSummary } from './RoundSummary';
import Table2D from './Table2D';

const Table3D = dynamic(() => import('./three/Table3D'), {
  ssr: false,
  loading: () => <div className="table-loading">Stiller bordet op…</div>,
});

export default function GameScreen() {
  const router = useRouter();
  const { state, game, selected, handOrder, thinking, buyPrompt, flash, review, settings, error } = useGame();
  const [sheet, setSheet] = useState<null | 'open' | 'meld'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [choice, setChoice] = useState<{ meldId: number; options: BuildOption[] } | null>(null);
  const [use3d, setUse3d] = useState(false);
  const [booting, setBooting] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);
  const [bottomInset, setBottomInset] = useState(0.34);
  const [topInset, setTopInset] = useState(0.12);

  // Boot: keep the running game, otherwise resume the latest unfinished one or start fresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const current = useGame.getState();
      if (!current.game) {
        const saved = await latestUnfinished();
        if (cancelled) return;
        if (saved) controller.resume(saved);
        else controller.newGame(loadSettings());
      } else {
        controller.schedule();
      }
      setUse3d(useGame.getState().settings.mode3d && webglAvailable());
      setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
  const model = useMemo(() => (state ? buildTableModel(state, names, HUMAN) : null), [state, names]);
  const layout = useMemo(() => (model ? layoutScene(model, tableDims(portrait)) : null), [model, portrait]);

  if (booting || !state || !game || !model || !layout) {
    return <div className="table-loading">{error ?? 'Blander kortene…'}</div>;
  }

  const hand = state.hands[HUMAN];
  const ph = state.phase;
  const myTurn = (ph.type === 'draw' || ph.type === 'meld') && state.current === HUMAN;
  const canDraw = myTurn && ph.type === 'draw';
  const canTakeDiscard = canDraw && state.discard.length > 0;
  const inMeld = myTurn && ph.type === 'meld';
  const opened = state.openedTurn[HUMAN] >= 0;
  const canBuild = inMeld && canBuildNow(state, HUMAN);
  const contract = contractForRound(state.round);
  const ready = inMeld && !opened && canMeetContract(hand, contract);
  const single = selected.length === 1 ? selected[0] : null;
  const options = single !== null && canBuild ? buildOptions(state, HUMAN, single) : [];
  const highlight = new Set(options.map((o) => o.meld.id));
  const playable = canBuild ? playableCards(state, HUMAN) : new Set<CardId>();
  const newMeld =
    canBuild && state.config.rules.newMeldsAfterOpening && selected.length >= 3 ? interpretGroup(selected) : null;
  const canLayMore =
    canBuild &&
    state.config.rules.newMeldsAfterOpening &&
    (findBestOpening(hand, { sets: 0, runs: 0 })?.length ?? 0) > 0;
  const topDiscard = state.discard[state.discard.length - 1];

  const act = (action: Action) => {
    const err = controller.human(action);
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
    controller.clearSelection();
    if (opt.kind === 'swap') act({ type: 'SwapJoker', player: HUMAN, meldId: opt.meld.id, card });
    else act({ type: 'Extend', player: HUMAN, meldId: opt.meld.id, card, end: opt.end });
  };

  const confirmMelds = (melds: MeldSpec[]) => {
    setSheet(null);
    controller.clearSelection();
    if (sheet === 'open') {
      act({ type: 'Open', player: HUMAN, melds });
    } else {
      for (const meld of melds) {
        const err = controller.human({ type: 'LayMeld', player: HUMAN, meld });
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

  const tableProps = {
    canDraw,
    canTakeDiscard,
    highlightMelds: highlight,
    onDeck: () => act({ type: 'DrawFromDeck', player: HUMAN }),
    onDiscard: () => act({ type: 'DrawFromDiscard', player: HUMAN }),
    onMeld,
  };

  return (
    <div className="game">
      <Hud state={state} names={names} humanSeat={HUMAN} hand={hand} onMenu={() => setMenu(true)} />
      <div className="table-area">
        {use3d ? (
          <Table3D
            state={state}
            model={model}
            layout={layout}
            thinking={thinking}
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
          <div className="status" aria-live="polite">
            {status}
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
                onClick={() => single !== null && act({ type: 'Discard', player: HUMAN, card: single })}
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
          onToggle={(c) => controller.toggleSelect(c)}
          onReorder={(o) => controller.setHandOrder(o)}
        />
      </div>

      {buyPrompt && ph.type === 'buy' && (
        <BuyPrompt
          prompt={buyPrompt}
          discarder={discarderName}
          onBuy={() => act({ type: 'BuyClaim', player: HUMAN })}
          onPass={() => act({ type: 'BuyPass', player: HUMAN })}
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
        humanSeat={HUMAN}
        review={review}
        onNext={() => controller.nextRound()}
        onNewGame={() => controller.newGame(useGame.getState().settings)}
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
            <Link className="btn" href="/regler/">
              Regler
            </Link>
            <button
              className="btn btn-ghost"
              onClick={() => {
                controller.reset();
                useGame.setState({ game: null, state: null });
                router.push('/');
              }}
            >
              Til forsiden (spillet gemmes)
            </button>
          </div>
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
    </div>
  );

  function confirmMeldsDirect(meld: MeldSpec) {
    controller.clearSelection();
    act({ type: 'LayMeld', player: HUMAN, meld });
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

/** Engine messages are English; show Danish to the player. */
function translate(message: string): string {
  const map: [RegExp, string][] = [
    [/turn you open/, 'Du kan ikke bygge på bordet i den tur, du åbner.'],
    [/does not fit/, 'Kortet passer ikke her.'],
    [/contract/, 'Meldingerne dækker ikke rundens kontrakt.'],
    [/not in hand/, 'Kortet er ikke på din hånd.'],
    [/must open/, 'Du skal åbne med kontrakten først.'],
    [/may not buy/, 'Du kan ikke købe dette kort.'],
    [/No buy window/, 'For sent – kortet er væk.'],
    [/already passed/, 'Du har allerede sagt nej.'],
    [/not player/, 'Det er ikke din tur.'],
    [/Invalid/, 'Det er ikke en gyldig melding.'],
  ];
  for (const [re, text] of map) if (re.test(message)) return text;
  return message;
}
