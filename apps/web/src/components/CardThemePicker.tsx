'use client';
import { CARD_THEMES, type CardThemeId, cardTheme, preloadCardTheme } from '@/lib/cardThemes';
import { CardSprite } from './CardSprite';

// King of hearts, queen of spades and the back: faces and back at a glance.
const PREVIEW: (number | 'back')[] = [25, 11, 'back'];

export function CardThemePicker({ value, onChange }: { value: CardThemeId; onChange: (id: CardThemeId) => void }) {
  const selected = cardTheme(value);
  return (
    <div className="theme-picker">
      <div className="theme-options" role="radiogroup" aria-label="Kortdesign">
        {CARD_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={value === t.id}
            className={`theme-option${value === t.id ? ' on' : ''}`}
            onPointerEnter={() => preloadCardTheme(t.id)}
            onClick={() => onChange(t.id)}
          >
            <span className="theme-cards" aria-hidden>
              {PREVIEW.map((c, i) => (
                <CardSprite key={i} card={c} width={30} theme={t.id} />
              ))}
            </span>
            <span className="theme-name">{t.name}</span>
          </button>
        ))}
      </div>
      <p className="muted small">
        {selected.description}
        {selected.credit && (
          <>
            {' '}
            <a href={selected.credit.href} target="_blank" rel="noopener noreferrer">
              {selected.credit.text}
            </a>
          </>
        )}
      </p>
    </div>
  );
}

/** Attribution for the licensed card artwork (required by the Freepik licence). */
export function CardCredits() {
  return (
    <span className="card-credits">
      Kortdesign:{' '}
      {CARD_THEMES.filter((t) => t.credit).map((t, i) => (
        <span key={t.id}>
          {i > 0 && ' · '}
          {t.name}:{' '}
          <a href={t.credit!.href} target="_blank" rel="noopener noreferrer">
            {t.credit!.text}
          </a>
        </span>
      ))}
    </span>
  );
}
