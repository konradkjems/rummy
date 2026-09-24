'use client';
import dynamic from 'next/dynamic';

const GameScreen = dynamic(() => import('@/components/GameScreen'), {
  ssr: false,
  loading: () => <div className="table-loading">Blander kortene…</div>,
});

export default function PlayPage() {
  return <GameScreen />;
}
