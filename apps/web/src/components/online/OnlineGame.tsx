'use client';
import { useEffect } from 'react';
import { onlineDriver } from '@/lib/online/driver';
import GameScreen from '../GameScreen';
import { ConnectionBanner } from './ConnectionBanner';

/** The shared game screen, driven by the game server. */
export default function OnlineGame() {
  useEffect(() => {
    onlineDriver.attach();
    return () => onlineDriver.detach();
  }, []);
  return (
    <>
      <div className="conn-overlay">
        <ConnectionBanner />
      </div>
      <GameScreen driver={onlineDriver} />
    </>
  );
}
