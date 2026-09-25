'use client';
import { soloDriver } from '@/lib/game';
import GameScreen from './GameScreen';

export default function SoloGame() {
  return <GameScreen driver={soloDriver} />;
}
