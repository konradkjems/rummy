'use client';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type RoomInfo, normalizeCode } from '@kova/rummy-net';
import { online, useOnline } from '@/lib/online/client';
import { BOT_LEVELS } from './LobbyScreen';
import { ConnectionBanner } from './ConnectionBanner';

const OnlineGame = dynamic(() => import('./OnlineGame'), {
  ssr: false,
  loading: () => <div className="table-loading">Stiller bordet op…</div>,
});

/** /online/bord/?kode=XXXXX: the waiting room, then the game. */
export default function RoomScreen() {
  const router = useRouter();
  const { status, room, error, errorAt } = useOnline();
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const [askedAt, setAskedAt] = useState(0);

  useEffect(() => {
    setCode(normalizeCode(new URLSearchParams(location.search).get('kode')));
    online.start();
  }, []);

  // Take a seat at the table in the link (once connected; the server keeps it on reconnects).
  useEffect(() => {
    if (!code || status !== 'online' || askedAt) return;
    if (room?.code === code) return;
    setAskedAt(Date.now());
    online.send({ t: 'join', code });
  }, [code, status, room?.code, askedAt]);

  if (code === undefined) return <div className="table-loading">Finder bordet…</div>;

  const here = room && room.code === code ? room : null;
  if (here && here.status !== 'lobby') return <OnlineGame />;

  const failed = !here && askedAt > 0 && error && errorAt >= askedAt;
  return (
    <main className="page online">
      <nav className="page-nav">
        <Link href="/online/">← Alle borde</Link>
      </nav>
      <ConnectionBanner />
      {!code ? (
        <Missing text="Linket mangler en gyldig kode." />
      ) : failed ? (
        <Missing text={error!} />
      ) : here ? (
        <WaitingRoom
          room={here}
          onLeave={() => {
            online.send({ t: 'leave' });
            router.push('/online/');
          }}
        />
      ) : (
        <p className="muted">Sætter dig ved bordet {code}…</p>
      )}
    </main>
  );
}

function Missing({ text }: { text: string }) {
  return (
    <section className="card-panel">
      <h1>Bordet kan ikke findes</h1>
      <p>{text}</p>
      <Link className="btn btn-primary" href="/online/">
        Se åbne borde
      </Link>
    </section>
  );
}

function WaitingRoom({ room, onLeave }: { room: RoomInfo; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const empty = room.seats.filter((s) => s.kind === 'empty').length;
  const host = room.seats.find((s) => s.kind === 'human' && s.host);
  const link = typeof location === 'undefined' ? '' : `${location.origin}/online/bord/?kode=${room.code}`;
  const level = BOT_LEVELS.find((b) => b.id === room.settings.botLevel)?.name ?? '';

  const share = async () => {
    const data = { title: 'Løbere og Passere', text: `Sæt dig ved mit bord: ${room.name}`, url: link };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
    } catch {
      // Cancelled or not allowed: fall back to copying.
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Kopiér linket', link);
    }
  };

  return (
    <>
      <h1>{room.name}</h1>
      <section className="card-panel room-code">
        <div>
          <span className="muted small">Kode</span>
          <strong className="code">{room.code}</strong>
        </div>
        <button className="btn" onClick={share}>
          {copied ? 'Link kopieret' : 'Invitér'}
        </button>
      </section>
      <p className="muted small">
        {room.isPublic
          ? 'Bordet står på listen over åbne borde, så alle kan sætte sig.'
          : 'Bordet er skjult. Kun folk med koden eller linket kan sætte sig.'}
      </p>

      <section className="card-panel">
        <h2>
          Pladser ({room.seats.length - empty}/{room.seats.length})
        </h2>
        <ol className="seat-list">
          {room.seats.map((s, i) => (
            <li key={i} className={s.kind === 'human' && s.you ? 'me' : ''}>
              {s.kind === 'empty' ? (
                <span className="muted">Ledig plads</span>
              ) : s.kind === 'bot' ? (
                <span>{s.name} (computer)</span>
              ) : (
                <>
                  <span>
                    {s.name}
                    {s.you ? ' (dig)' : ''}
                  </span>
                  <span className="muted small">
                    {s.host ? 'vært' : ''}
                    {!s.connected ? `${s.host ? ' · ' : ''}forbinder…` : ''}
                  </span>
                </>
              )}
            </li>
          ))}
        </ol>
        <p className="muted small">
          Computer: {level} · køb: {room.settings.buySeconds} s · tur: {room.settings.turnSeconds} s
        </p>
      </section>

      {room.youAreHost ? (
        <button className="btn btn-primary big" onClick={() => online.send({ t: 'start' })}>
          Start spillet
          <span className="btn-sub">
            {empty === 0
              ? 'Alle pladser er taget'
              : `${empty} ${empty === 1 ? 'tom plads får' : 'tomme pladser får'} en computerspiller`}
          </span>
        </button>
      ) : (
        <p className="waiting">Venter på, at {host && host.kind === 'human' ? host.name : 'værten'} starter spillet…</p>
      )}
      <button className="btn btn-ghost" onClick={onLeave}>
        Forlad bordet
      </button>
    </>
  );
}
