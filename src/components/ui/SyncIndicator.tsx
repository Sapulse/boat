import { useState } from 'react';
import { Check, RefreshCw, CloudOff, AlertTriangle, CloudUpload } from 'lucide-react';
import type { SyncInfo } from '../../lib/repository';
import { describeSync, type SyncTone } from '../../lib/syncLabels';
import { cn } from '../../lib/utils';

// Indicateur de synchro (correctif audit #3, brique 3) — mode API uniquement.
// Rend TOUT échec VISIBLE et RÉCUPÉRABLE : gradué (discret « à jour » -> alerte
// non-ratable hors ligne / échec), panneau Réessayer / Abandonner sur un refus
// définitif. Présentational (props). Le mapping état->libellé/ton est dans
// lib/syncLabels.ts (pur, testé au harnais).

const TONE: Record<SyncTone, { text: string; bg: string; ring: string }> = {
  ok: { text: 'text-gray-400', bg: 'hover:bg-gray-100', ring: '' },
  busy: { text: 'text-primary-600', bg: 'hover:bg-primary-50', ring: '' },
  warn: { text: 'text-warning-700', bg: 'bg-warning-50 hover:bg-warning-100', ring: 'ring-1 ring-warning-300' },
  error: { text: 'text-danger-700', bg: 'bg-danger-50 hover:bg-danger-100', ring: 'ring-1 ring-danger-400' },
};

function ToneIcon({ status }: { status: SyncInfo['status'] }) {
  const c = 'w-4 h-4';
  if (status === 'idle') return <Check className={c} />;
  if (status === 'sending') return <CloudUpload className={cn(c, 'animate-pulse')} />;
  if (status === 'offline') return <CloudOff className={c} />;
  if (status === 'failed') return <AlertTriangle className={c} />;
  return <RefreshCw className={c} />; // waiting
}

export function SyncIndicator({ info, onRetry, onAbandon }: {
  info: SyncInfo;
  onRetry: () => void;
  onAbandon: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = describeSync(info);
  const tone = TONE[d.tone];
  const hasPanel = info.status === 'failed';

  const abandon = async () => {
    if (!confirm('Abandonner cette modification ? Elle sera définitivement perdue et l\'écran sera réaligné sur les données du serveur.')) return;
    setBusy(true);
    try { await onAbandon(); setOpen(false); }
    finally { setBusy(false); }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => hasPanel && setOpen(o => !o)}
        title={d.label}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
          tone.text, tone.bg, tone.ring,
          d.prominent && 'animate-pulse',
          !hasPanel && 'cursor-default',
        )}
      >
        <ToneIcon status={info.status} />
        <span className="hidden sm:inline">{d.label}</span>
      </button>

      {hasPanel && open && info.failed && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-white rounded-lg border border-gray-200 shadow-lg p-3 text-left">
            <p className="text-sm font-semibold text-danger-700 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4" /> Modification non enregistrée
            </p>
            <p className="text-sm text-gray-800 mt-1.5">{info.failed.label}</p>
            {info.failed.error && <p className="text-xs text-gray-500 mt-0.5 break-words">{info.failed.error}</p>}
            {info.pending > 1 && (
              <p className="text-[11px] text-gray-400 mt-1">{info.pending - 1} autre(s) modification(s) attendent derrière celle-ci.</p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button onClick={() => { onRetry(); setOpen(false); }} disabled={busy} className="btn-primary btn-sm disabled:opacity-50">
                <RefreshCw className="w-3 h-3" /> Réessayer
              </button>
              <button onClick={abandon} disabled={busy} className="btn-ghost btn-sm text-danger-600 hover:bg-danger-50 disabled:opacity-50">
                {busy ? 'Abandon…' : 'Abandonner'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
