import { useRef, useState } from 'react';
import { RotateCcw, AlertTriangle, FileText, CheckCircle2, Download } from 'lucide-react';
import { useApp } from '../../context/useApp';
import { USE_API } from '../../lib/flags';
import Modal from '../ui/Modal';
import { parseBackupFile, downloadBackup, type BackupEnvelope, type RestoreReport } from '../../lib/backup';

// Panneau de RESTAURATION d'une sauvegarde JSON (chantier import/export, Étape 5).
// DESTRUCTIF : remplace TOUTE la base. Garde-fou fort (contraste des comptes +
// saisie « REMPLACER » + conseil d'export préalable). Mode API uniquement
// (restoreBackup absent en flag off -> panneau désactivé).

const CONFIRM_WORD = 'REMPLACER';

export default function RestorePanel() {
  const { state, restoreBackup } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [envelope, setEnvelope] = useState<BackupEnvelope | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setRestoreError(null);
    setReport(null);
    setEnvelope(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        setEnvelope(parseBackupFile(typeof reader.result === 'string' ? reader.result : ''));
      } catch (err) {
        setError((err as Error).message);
      }
    };
    reader.onerror = () => setError('Échec de lecture du fichier.');
    reader.readAsText(file, 'UTF-8');
  };

  const openConfirm = () => { setConfirmText(''); setConfirmOpen(true); };

  const runRestore = async () => {
    if (!envelope || !restoreBackup) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const rep = await restoreBackup(envelope);
      setReport(rep);
      setEnvelope(null);
      setFileName(null);
      setConfirmOpen(false);
    } catch (e) {
      setRestoreError((e as Error).message);
      setConfirmOpen(false);
    } finally {
      setRestoring(false);
    }
  };

  const d = envelope?.data;

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-red-50 text-red-600 shrink-0">
          <RotateCcw className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Restaurer une sauvegarde (JSON)</h3>
          <p className="text-xs text-gray-500 mt-1">
            Recharge un fichier de sauvegarde. ⚠️ <strong>Remplace entièrement</strong> la base
            actuelle (action irréversible). Exportez d'abord une sauvegarde par sécurité.
          </p>
        </div>
      </div>

      {report && (
        <div className="rounded-lg bg-green-50 border border-green-300 px-4 py-3 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          <div className="text-sm text-green-800">
            <p className="font-semibold">Restauration terminée ✓</p>
            <p className="mt-0.5">
              Base remplacée : <strong>{report.leads} leads</strong>, {report.commercials} commerciaux,
              {' '}{report.actions} actions, {report.templates} modèles, {report.calendarEvents} événements.
            </p>
          </div>
          <button onClick={() => setReport(null)} className="ml-auto text-xs text-green-700 hover:underline">Fermer</button>
        </div>
      )}

      {restoreError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          Restauration refusée : {restoreError} — <strong>rien n'a été modifié</strong> (transaction annulée).
        </div>
      )}

      {!USE_API && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span><strong>Mode local (localStorage).</strong> La restauration n'est disponible qu'en mode API (flag on).</span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
        <button onClick={() => fileInputRef.current?.click()} className="btn-secondary btn-sm">
          <RotateCcw className="w-4 h-4" /> Choisir une sauvegarde JSON
        </button>
        {fileName && <span className="text-xs text-gray-500 inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{fileName}</span>}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {d && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-600">
            <p className="font-semibold text-gray-700 mb-1">Contenu du fichier</p>
            <p>
              {d.leads.length} leads · {d.commercials.length} commerciaux · {d.actions.length} actions ·
              {' '}{d.templates.length} modèles · {d.calendarEvents.length} événements · {d.monthlyStats.length} stats
              {envelope?.exportedAt && <> · exporté le {new Date(envelope.exportedAt).toLocaleString('fr-FR')}</>}
            </p>
          </div>

          {restoreBackup ? (
            <div className="flex justify-end">
              <button onClick={openConfirm} disabled={restoring} className="btn-primary btn-sm bg-red-600 hover:bg-red-700 disabled:opacity-50">
                <RotateCcw className="w-4 h-4" /> Restaurer (remplacer la base)
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-right">Restauration disponible en mode API</p>
          )}
        </div>
      )}

      {/* Confirmation FORTE : contraste + saisie obligatoire + export préalable. */}
      <Modal open={confirmOpen} onClose={() => { if (!restoring) setConfirmOpen(false); }} title="Restauration — action irréversible" size="md">
        {d && (
          <div className="space-y-4 text-sm text-gray-700">
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-300 px-3 py-2 text-red-800">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">La base actuelle sera entièrement remplacée.</p>
                <p className="mt-1 text-xs">
                  Actuel : <strong>{state.leads.length} leads</strong> / {state.commercials.length} commerciaux
                  {' → '}Fichier : <strong>{d.leads.length} leads</strong> / {d.commercials.length} commerciaux.
                  {' '}Les données actuelles seront <strong>définitivement supprimées</strong>. Action <strong>irréversible</strong>.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
              <span className="text-xs text-gray-600">Par sécurité, exportez d'abord la base actuelle :</span>
              <button onClick={() => downloadBackup(state, __APP_VERSION__)} className="btn-secondary btn-sm shrink-0">
                <Download className="w-4 h-4" /> Exporter d'abord
              </button>
            </div>

            <div>
              <label htmlFor="restore-confirm" className="block text-xs font-medium text-gray-700 mb-1">
                Tapez <strong>{CONFIRM_WORD}</strong> pour confirmer :
              </label>
              <input
                id="restore-confirm"
                className="input"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={CONFIRM_WORD}
                autoComplete="off"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setConfirmOpen(false)} disabled={restoring} className="btn-secondary btn-sm">Annuler</button>
              <button
                onClick={runRestore}
                disabled={restoring || confirmText !== CONFIRM_WORD}
                className="btn-primary btn-sm bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {restoring ? 'Restauration…' : 'Remplacer la base'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
