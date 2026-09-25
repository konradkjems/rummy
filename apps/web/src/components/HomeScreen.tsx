'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { NUM_ROUNDS, type RuleOptions } from '@kova/rummy-engine';
import type { Difficulty } from '@kova/rummy-ai';
import { controller } from '@/lib/game';
import { type SavedGame, latestUnfinished } from '@/lib/persistence';
import { DEFAULT_SETTINGS, type Settings, loadSettings, saveSettings, webglAvailable } from '@/lib/settings';

const DIFFICULTIES: { id: Difficulty; name: string; text: string }[] = [
  { id: 'easy', name: 'Let', text: 'Spiller tilfældigt, men åbner når den kan.' },
  { id: 'medium', name: 'Medium', text: 'Grådig: vælger det bedste træk lige nu.' },
  { id: 'hard', name: 'Umulig', text: 'Kortoptælling, modstander-inferens og tusindvis af simulationer pr. træk.' },
];

const RULES: { key: keyof RuleOptions; label: string; help: string }[] = [
  {
    key: 'buildOnOpeningTurn',
    label: 'Byg på bordet i samme tur som man åbner',
    help: 'Ellers kan man først lægge til meldinger i sin næste tur.',
  },
  {
    key: 'jokerSwap',
    label: 'Joker på bordet må byttes med det rigtige kort',
    help: 'Den, der er åben, tager jokeren på hånden.',
  },
  {
    key: 'reshuffleDiscards',
    label: 'Bland afsmidningsbunken, når bunken er tom',
    help: 'Ellers slutter runden, og alle tæller deres hånd.',
  },
  {
    key: 'newMeldsAfterOpening',
    label: 'Nye meldinger efter åbning',
    help: 'Efter åbning må man lægge nye passere og løbere i senere ture. Uden den regel kan runden gå i hårdknude.',
  },
];

/** Interactive part of the front page. `children` is server-rendered content shown above the footer. */
export default function HomeScreen({ children }: { children?: React.ReactNode }) {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [resume, setResume] = useState<SavedGame | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [has3d, setHas3d] = useState(true);

  useEffect(() => {
    setSettings(loadSettings());
    setHas3d(webglAvailable());
    latestUnfinished().then((g) => setResume(g ?? null));
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };
  const updateRule = (patch: Partial<RuleOptions>) => update({ rules: { ...settings.rules, ...patch } });

  const start = () => {
    saveSettings(settings);
    controller.updateSettings(settings);
    controller.newGame(settings);
    router.push('/spil/');
  };

  const continueGame = () => {
    if (!resume) return;
    controller.resume(resume);
    router.push('/spil/');
  };

  const resumeRound = resume ? resume.actions.filter((a) => a.type === 'NextRound').length + 1 : 0;

  return (
    <main className="home">
      <section className="hero">
        <div className="hero-cards" aria-hidden>
          <span className="hero-card c1">E♠</span>
          <span className="hero-card c2">K♥</span>
          <span className="hero-card c3">★</span>
        </div>
        <h1>Løbere og Passere</h1>
        <p className="tagline">
          Kontrakt-rommy mod en computer, der træffer det statistisk bedste valg hver eneste gang.
          <br />
          <em>Jeg troede, jeg var god til det her spil. Hvorfor kan jeg ikke slå den?</em>
        </p>
      </section>

      <section className="home-actions">
        {resume && (
          <button className="btn btn-primary big" onClick={continueGame}>
            Fortsæt parti
            <span className="btn-sub">
              Runde {Math.min(resumeRound, NUM_ROUNDS)}/{NUM_ROUNDS} ·{' '}
              {resume.names.map((n, i) => `${n} ${resume.totals[i]}`).join(' · ')}
            </span>
          </button>
        )}
        {!showSetup ? (
          <button className={`btn big ${resume ? '' : 'btn-primary'}`} onClick={() => setShowSetup(true)}>
            Nyt parti
          </button>
        ) : (
          <div className="setup card-panel">
            <h2>Nyt parti</h2>
            <label className="field">
              <span>Dit navn</span>
              <input
                value={settings.playerName}
                maxLength={16}
                onChange={(e) => update({ playerName: e.target.value })}
                placeholder="Dig"
              />
            </label>

            <fieldset className="field">
              <legend>Modstander</legend>
              <div className="segmented">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d.id}
                    className={settings.difficulty === d.id ? 'on' : ''}
                    onClick={() => update({ difficulty: d.id })}
                    aria-pressed={settings.difficulty === d.id}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
              <p className="muted small">{DIFFICULTIES.find((d) => d.id === settings.difficulty)?.text}</p>
            </fieldset>

            <fieldset className="field">
              <legend>Antal AI-modstandere</legend>
              <div className="segmented">
                {[2, 3, 4].map((k) => (
                  <button
                    key={k}
                    className={settings.opponents === k ? 'on' : ''}
                    onClick={() => update({ opponents: k })}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </fieldset>

            <details className="field rules-box">
              <summary>Husregler</summary>
              {RULES.map((r) => (
                <label key={r.key} className="toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.rules[r.key])}
                    onChange={(e) => updateRule({ [r.key]: e.target.checked } as Partial<RuleOptions>)}
                  />
                  <span>
                    {r.label}
                    <small>{r.help}</small>
                  </span>
                </label>
              ))}
              <label className="field inline">
                <span>Maks. køb pr. runde</span>
                <select
                  value={settings.rules.maxBuysPerRound ?? 'none'}
                  onChange={(e) =>
                    updateRule({ maxBuysPerRound: e.target.value === 'none' ? null : Number(e.target.value) })
                  }
                >
                  <option value="none">Ubegrænset</option>
                  {[1, 2, 3, 4, 5].map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field inline">
                <span>Tid til at købe</span>
                <select value={settings.buySeconds} onChange={(e) => update({ buySeconds: Number(e.target.value) })}>
                  {[3, 4, 5, 7, 10].map((k) => (
                    <option key={k} value={k}>
                      {k} sek.
                    </option>
                  ))}
                </select>
              </label>
            </details>

            <fieldset className="field">
              <legend>Bord</legend>
              <div className="segmented">
                <button
                  className={settings.mode3d ? 'on' : ''}
                  disabled={!has3d}
                  onClick={() => update({ mode3d: true })}
                >
                  3D
                </button>
                <button className={!settings.mode3d ? 'on' : ''} onClick={() => update({ mode3d: false })}>
                  2D
                </button>
              </div>
              {!has3d && <p className="muted small">Din browser understøtter ikke WebGL, så bordet vises i 2D.</p>}
            </fieldset>

            <button className="btn btn-primary big" onClick={start}>
              Del kort ud
            </button>
          </div>
        )}
        <div className="home-links">
          <Link className="btn btn-ghost" href="/statistik/">
            Statistik
          </Link>
          <Link className="btn btn-ghost" href="/regler/">
            Regler
          </Link>
        </div>
      </section>
      {children}
      <footer className="home-foot muted small">
        Alt kører i din browser. Partier og statistik gemmes kun på denne enhed.
      </footer>
    </main>
  );
}
