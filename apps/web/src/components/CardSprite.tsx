'use client';
import { type CSSProperties, useEffect, useState } from 'react';
import { type CardId, cardName, cardType } from '@kova/rummy-engine';
import { BACK_CELL, CARD_ASPECT, spriteStyle } from '@/lib/cardArt';
import { type CardThemeId, cardTheme, useCardTheme } from '@/lib/cardThemes';

interface CardSpriteProps {
  card: CardId | 'back';
  width: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Show this deck instead of the one in use (theme previews). */
  theme?: CardThemeId;
}

/** A card drawn from the same atlas the 3D table uses. */
export function CardSprite({ card, width, className, style, title, theme }: CardSpriteProps) {
  const current = useCardTheme((s) => s.theme);
  const themeId = theme ?? current;
  const [sprite, setSprite] = useState<Record<string, string> | null>(null);
  const cell = card === 'back' ? BACK_CELL : cardType(card);
  // The painted atlas needs a canvas, so styles are computed after mount.
  useEffect(() => {
    setSprite(spriteStyle(cell, width, cardTheme(themeId)));
  }, [cell, width, themeId]);
  const label = card === 'back' ? 'Kort med bagsiden op' : cardName(card);
  return (
    <div
      role="img"
      aria-label={label}
      title={title ?? label}
      className={`card-sprite${className ? ` ${className}` : ''}`}
      style={{ width, height: width / CARD_ASPECT, ...(sprite ?? {}), ...style }}
    />
  );
}
