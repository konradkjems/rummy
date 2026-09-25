'use client';
import dynamic from 'next/dynamic';

const SoloGame = dynamic(() => import('@/components/SoloGame'), {
  ssr: false,
  loading: () => <div className="table-loading">Blander kortene…</div>,
});

export default function PlayPage() {
  return <SoloGame />;
}
