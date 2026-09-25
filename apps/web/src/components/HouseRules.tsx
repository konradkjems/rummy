'use client';
import type { ReactNode } from 'react';
import type { RuleOptions } from '@kova/rummy-engine';

export const RULES: { key: keyof RuleOptions; label: string; help: string }[] = [
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

/** The house-rule switches (solo setup and new online tables). `children`: extra fields at the end. */
export function HouseRules({
  rules,
  onChange,
  children,
}: {
  rules: RuleOptions;
  onChange: (patch: Partial<RuleOptions>) => void;
  children?: ReactNode;
}) {
  return (
    <details className="field rules-box">
      <summary>Husregler</summary>
      {RULES.map((r) => (
        <label key={r.key} className="toggle">
          <input
            type="checkbox"
            checked={Boolean(rules[r.key])}
            onChange={(e) => onChange({ [r.key]: e.target.checked } as Partial<RuleOptions>)}
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
          value={rules.maxBuysPerRound ?? 'none'}
          onChange={(e) => onChange({ maxBuysPerRound: e.target.value === 'none' ? null : Number(e.target.value) })}
        >
          <option value="none">Ubegrænset</option>
          {[1, 2, 3, 4, 5].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      {children}
    </details>
  );
}
