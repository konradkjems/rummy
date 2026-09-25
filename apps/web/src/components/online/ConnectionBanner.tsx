'use client';
import { online, useOnline } from '@/lib/online/client';

/** Connection state, when it is anything but fine. */
export function ConnectionBanner() {
  const status = useOnline((s) => s.status);
  switch (status) {
    case 'online':
      return null;
    case 'connecting':
      return <p className="conn-banner">Forbinder til spilserveren…</p>;
    case 'offline':
      return <p className="conn-banner warn">Forbindelsen er tabt. Prøver igen…</p>;
    case 'replaced':
      return (
        <p className="conn-banner warn">
          Du spiller i et andet vindue.{' '}
          <button className="btn btn-ghost small" onClick={() => online.reclaim()}>
            Spil her i stedet
          </button>
        </p>
      );
    case 'outdated':
      return (
        <p className="conn-banner warn">
          Siden er blevet opdateret.{' '}
          <button className="btn btn-ghost small" onClick={() => location.reload()}>
            Genindlæs
          </button>
        </p>
      );
    case 'unconfigured':
      return (
        <p className="conn-banner warn">
          Online-spil er ikke slået til på denne side endnu. Du kan stadig spille mod computeren fra forsiden.
        </p>
      );
    default:
      return null;
  }
}
