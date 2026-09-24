'use client';
import { type CSSProperties, useEffect, useState } from 'react';
import { type CardId, cardName, cardType } from '@kova/rummy-engine';
import { BACK_CELL, CARD_ASPECT, spriteStyle } from '@/lib/cardArt';

interface CardSpriteProps {
  card: CardId | 'back';
  width: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** A card drawn from the same atlas the 3D table uses. */
export function CardSprite({ card, width, className, style, title }: CardSpriteProps) {
  const [sprite, setSprite] = useState<Record<string, string> | null>(null);
  const cell = card === 'back' ? BACK_CELL : cardType(card);
  useEffect(() => {
    setSprite(spriteStyle(cell, width));
  }, [cell, width]);
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
