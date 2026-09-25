import type { Metadata } from 'next';
import LobbyScreen from '@/components/online/LobbyScreen';
import { socialMetadata } from '@/lib/site';

const TITLE = 'Spil Løbere og Passere online med venner';
const DESCRIPTION =
  'Opret et bord og invitér dine venner, eller sæt dig ved et åbent bord med andre spillere. Tomme pladser får en computerspiller.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/online/' },
  ...socialMetadata(TITLE, DESCRIPTION, '/online/'),
};

export default function OnlinePage() {
  return <LobbyScreen />;
}
