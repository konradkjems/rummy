'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import type { RuleOptions } from '@kova/rummy-engine';
import {
  type BotLevel,
  BUY_SECONDS,
  DEFAULT_ROOM_SETTINGS,
  NAME_MAX,
  ROOM_NAME_MAX,
  type RoomSettings,
  TURN_SECONDS,
  cleanName,
  normalizeCode,
} from '@kova/rummy-net';
import { online, useOnline } from '@/lib/online/client';
import { loadSettings, saveSettings } from '@/lib/settings';
import { HouseRules } from '../HouseRules';
import { ConnectionBanner } from './ConnectionBanner';

export const BOT_LEVELS: { id: BotLevel; name: string }[] = [
  { id: 'easy', name: 'Let' },
  { id: 'medium', name: 'Medium' },
  { id: 'hard', name: 'Umulig' },
];

export function roomLink(code: string): string {
  return `/online/bord/?kode=${code}`;
}

export default function LobbyScreen() {
  const router = useRouter();
  const { status, lobby, room, error, errorAt } = useOnline();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  /** Set when this page asked for a seat; the answer navigates to the table. */
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    online.start();
    online.watchLobby(true);
    const saved = loadSettings().playerName;
    setName(saved === 'Dig' ? '' : saved);
    return () => online.watchLobby(false);
  }, []);

  useEffect(() => {
    if (asked && room) router.push(roomLink(room.code));
  }, [asked, room, router]);

  const commitName = () => {
    const clean = cleanName(name);
    if (!clean) return;
    const s = loadSettings();
    if (s.playerName !== clean) saveSettings({ ...s, playerName: clean });
    online.send({ t: 'name', name: clean });
  };

  const seat = (msg: Parameters<typeof online.send>[0]) => {
    commitName();
    setAsked(Date.now());
    online.send(msg);
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeCode(code);
    if (!c) {
      useOnline.setState({ error: 'Koden er 5 tegn, f.eks. K7PQ2.', errorAt: Date.now() });
      return;
    }
    seat({ t: 'join', code: c });
  };

  const showError = error && Date.now() - errorAt < 8000;
  const usable = status === 'online' || status === 'connecting' || status === 'offline';

  return (
    <main className="page online">
      <nav className="page-nav">
        <Link href="/">← Forsiden</Link>
      </nav>
      <h1>Spil online</h1>
      <p className="lead">
        Spil Løbere og Passere med venner eller med andre, der er online lige nu. Pladser, som ingen tager, får en
        computerspiller.
      </p>

      <ConnectionBanner />

      {usable && (
        <>
          {room && !asked && (
            <section className="card-panel notice-panel">
              <p>
                Du sidder ved bordet <strong>{room.name}</strong>.
              </p>
              <Link className="btn btn-primary" href={roomLink(room.code)}>
                Gå til bordet
              </Link>
            </section>
          )}

          <section className="card-panel online-start">
            <label className="field">
              <span>Dit navn</span>
              <input
                value={name}
                maxLength={NAME_MAX}
                placeholder="Skriv dit navn"
                autoComplete="nickname"
                onChange={(e) => setName(e.target.value)}
                onBlur={commitName}
              />
            </label>
            <div className="online-actions">
              <button className="btn btn-primary big" onClick={() => seat({ t: 'quick' })}>
                Hurtigt spil
                <span className="btn-sub">Sæt dig ved et åbent bord, eller start et nyt</span>
              </button>
              <button className="btn big" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
                Opret bord
                <span className="btn-sub">Til venner eller alle</span>
              </button>
            </div>
            <form className="join-code" onSubmit={join}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Kode"
                maxLength={5}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                aria-label="Bordets kode"
              />
              <button className="btn" type="submit">
                Deltag med kode
              </button>
            </form>
            {showError && <p className="warn">{error}</p>}
          </section>

          {creating && <CreateTable playerName={name} onCreate={(msg) => seat(msg)} />}

          <section className="card-panel">
            <h2>Åbne borde</h2>
            {lobby === null ? (
              <p className="muted">Henter borde…</p>
            ) : lobby.length === 0 ? (
              <p className="muted">Ingen åbne borde lige nu. Opret et, eller tryk Hurtigt spil.</p>
            ) : (
              <ul className="lobby-list">
                {lobby.map((r) => (
                  <li key={r.code} className="lobby-row">
                    <div className="lobby-main">
                      <strong>{r.name}</strong>
                      <span className="muted small">
                        {r.host ? `Vært: ${r.host} · ` : ''}
                        {r.humans}/{r.seats} spillere · computer: {BOT_LEVELS.find((b) => b.id === r.botLevel)?.name}
                      </span>
                    </div>
                    {r.status === 'lobby' && r.open > 0 ? (
                      <button className="btn" onClick={() => seat({ t: 'join', code: r.code })}>
                        Sæt dig
                      </button>
                    ) : (
                      <span className="chip">{r.status === 'playing' ? `I gang · runde ${r.round}` : 'Fuldt'}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function CreateTable({
  playerName,
  onCreate,
}: {
  playerName: string;
  onCreate: (msg: { t: 'create'; name: string; isPublic: boolean; settings: RoomSettings }) => void;
}) {
  const [tableName, setTableName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [settings, setSettings] = useState<RoomSettings>(() => {
    const local = loadSettings();
    return {
      ...DEFAULT_ROOM_SETTINGS,
      rules: { ...local.rules },
      buySeconds: (BUY_SECONDS as readonly number[]).includes(local.buySeconds)
        ? local.buySeconds
        : DEFAULT_ROOM_SETTINGS.buySeconds,
    };
  });
  const update = (patch: Partial<RoomSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const updateRule = (patch: Partial<RuleOptions>) => setSettings((s) => ({ ...s, rules: { ...s.rules, ...patch } }));
  const fallbackName = playerName.trim() ? `${cleanName(playerName)}s bord` : 'Nyt bord';

  return (
    <form
      className="card-panel setup"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({ t: 'create', name: cleanName(tableName, ROOM_NAME_MAX) || fallbackName, isPublic, settings });
      }}
    >
      <h2>Nyt bord</h2>
      <label className="field">
        <span>Bordets navn</span>
        <input
          value={tableName}
          maxLength={ROOM_NAME_MAX}
          placeholder={fallbackName}
          onChange={(e) => setTableName(e.target.value)}
        />
      </label>
      <fieldset className="field">
        <legend>Hvem kan sætte sig?</legend>
        <div className="segmented">
          <button type="button" className={isPublic ? 'on' : ''} onClick={() => setIsPublic(true)}>
            Alle
          </button>
          <button type="button" className={!isPublic ? 'on' : ''} onClick={() => setIsPublic(false)}>
            Kun med kode
          </button>
        </div>
        <p className="muted small">
          {isPublic
            ? 'Bordet står på listen over åbne borde.'
            : 'Bordet er skjult. Del koden eller linket med dine venner.'}
        </p>
      </fieldset>
      <fieldset className="field">
        <legend>Pladser</legend>
        <div className="segmented">
          {[3, 4, 5].map((n) => (
            <button
              type="button"
              key={n}
              className={settings.numPlayers === n ? 'on' : ''}
              onClick={() => update({ numPlayers: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>Computerspillere på tomme pladser</legend>
        <div className="segmented">
          {BOT_LEVELS.map((b) => (
            <button
              type="button"
              key={b.id}
              className={settings.botLevel === b.id ? 'on' : ''}
              onClick={() => update({ botLevel: b.id })}
            >
              {b.name}
            </button>
          ))}
        </div>
      </fieldset>
      <HouseRules rules={settings.rules} onChange={updateRule}>
        <label className="field inline">
          <span>Tid til at købe</span>
          <select value={settings.buySeconds} onChange={(e) => update({ buySeconds: Number(e.target.value) })}>
            {BUY_SECONDS.map((k) => (
              <option key={k} value={k}>
                {k} sek.
              </option>
            ))}
          </select>
        </label>
        <label className="field inline">
          <span>Tid pr. tur</span>
          <select value={settings.turnSeconds} onChange={(e) => update({ turnSeconds: Number(e.target.value) })}>
            {TURN_SECONDS.map((k) => (
              <option key={k} value={k}>
                {k} sek.
              </option>
            ))}
          </select>
        </label>
      </HouseRules>
      <button className="btn btn-primary big" type="submit">
        Opret bordet
      </button>
    </form>
  );
}
