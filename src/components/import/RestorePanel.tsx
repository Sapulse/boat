import { useRef, useState } from 'react';
import { RotateCcw, AlertTriangle, FileText, CheckCircle2, Download, Clock, Inbox } from 'lucide-react';
import { useApp } from '../../context/useApp';
import { USE_API } from '../../lib/flags';
import Modal from '../ui/Modal';
import { parseBackupFile, downloadBackup, type BackupEnvelope, type RestoreReport } from '../../lib/backup';
import { restorePreview, formatAge } from '../../lib/restoreGuard';

// Panneau de RESTAURATION d'une sauvegarde JSON (chantier import/export, Étape 5).
// DESTRUCTIF : remplace TOUTE la base. Mode API uniquement (restoreBackup absent
// en flag off -> panneau désactivé).
//
// Garde-fous (renforcés au lot améliorations, 2026-07-30) : la logique de friction
// vit dans src/lib/restoreGuard.ts (cœur pur, harnais dédié). L'action reste
// TOUJOURS possible — elle est seulement impossible à déclencher distraitement :
//  - les leads sont comparés PAR ID, pas par nombre (deux bases de même taille
//    peuvent n'avoir aucun lead en commun) ;
//  - ce qui DISPARAÎT est annoncé en clair, en tête de la confirmation ;
//  - quand des leads disparaissent, il faut taper LEUR NOMBRE (un mot fixe se
//    tape de mémoire sans lire) ;
//  - l'âge du fichier est affiché, et signalé s'il est ancien ou sans date ;
//  - les écritures encore en file d'envoi sont signalées : elles partiraient
//    APRÈS la restauration, donc par-dessus les données restaurées.

export default function RestorePanel() {
  const { state, restoreBackup, sync } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [envelope, setEnvelope] = useState<BackupEnvelope | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [report, setReport] = useState<RestoreReport | null>(null);
  // Trace PERSISTANTE de l'export de sécurité : pendant toute la manœuvre,
  // l'utilisateur doit pouvoir vérifier d'un coup d'œil qu'il est couvert.
  const [safetyExportAt, setSafetyExportAt] = useState<Date | null>(null);

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

  const exportSafety = () => {
    downloadBackup(state, __APP_VERSION__);
    setSafetyExportAt(new Date());
  };

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
  const preview = d ? restorePreview(state, d, envelope?.exportedAt, new Date()) : null;
  const pending = sync?.info.pending ?? 0;

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

      {d && preview && (
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-600">
            <p className="font-semibold text-gray-700 mb-1">Contenu du fichier</p>
            <p>
              {d.leads.length} leads · {d.commercials.length} commerciaux · {d.actions.length} actions ·
              {' '}{d.templates.length} modèles · {d.calendarEvents.length} événements · {d.monthlyStats.length} stats
            </p>
            <p className={`mt-1.5 inline-flex items-center gap-1 ${preview.stale ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>
              <Clock className="w-3.5 h-3.5" />
              {envelope?.exportedAt
                ? <>Exporté le {new Date(envelope.exportedAt).toLocaleString('fr-FR')} — {formatAge(preview.ageDays)}</>
                : <>Ce fichier ne porte aucune date d'export</>}
              {preview.stale && <span className="ml-1">⚠️ sauvegarde ancienne</span>}
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

      {/* Confirmation FORTE : ce qui disparaît en tête, saisie proportionnée aux dégâts. */}
      <Modal open={confirmOpen} onClose={() => { if (!restoring) setConfirmOpen(false); }} title="Restauration — action irréversible" size="md">
        {d && preview && (
          <div className="space-y-4 text-sm text-gray-700">
            {/* 1. L'information la plus importante, en premier et en clair. */}
            {preview.destructive ? (
              <div className="rounded-lg bg-red-50 border-2 border-red-400 px-4 py-3 text-red-900">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-6 h-6 shrink-0 text-red-600" />
                  <div>
                    <p className="text-base font-bold">
                      {preview.leadsRemoved} lead{preview.leadsRemoved > 1 ? 's' : ''} {preview.leadsRemoved > 1 ? 'vont' : 'va'} être définitivement supprimé{preview.leadsRemoved > 1 ? 's' : ''}
                    </p>
                    <p className="mt-1 text-xs">
                      Ces leads existent aujourd'hui et sont <strong>absents du fichier</strong>. Ils seront
                      perdus pour <strong>toute l'équipe</strong>, sans retour arrière possible.
                      {preview.leadsAdded > 0 && <> Le fichier en apporte {preview.leadsAdded} que la base ne connaît pas.</>}
                      {' '}{preview.leadsKept} lead{preview.leadsKept > 1 ? 's' : ''} en commun ser{preview.leadsKept > 1 ? 'ont' : 'a'} écrasé{preview.leadsKept > 1 ? 's' : ''} par la version du fichier.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-amber-900">
                <p className="font-semibold">Aucun lead ne sera supprimé.</p>
                <p className="mt-1 text-xs">
                  Les {preview.leadsKept} lead{preview.leadsKept > 1 ? 's' : ''} de la base {preview.leadsKept > 1 ? 'sont' : 'est'} {preview.leadsKept > 1 ? 'tous' : ''} présent{preview.leadsKept > 1 ? 's' : ''} dans le fichier
                  {preview.leadsAdded > 0 && <>, qui en apporte {preview.leadsAdded} de plus</>}.
                  {' '}Leur contenu sera néanmoins <strong>écrasé</strong> par la version du fichier, et les autres
                  données (actions, objectifs…) remplacées. Action <strong>irréversible</strong>.
                </p>
              </div>
            )}

            {/* 2. Tableau avant/après : la vue d'ensemble, baisses en rouge. */}
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="text-left font-medium px-3 py-1.5">Données</th>
                    <th className="text-right font-medium px-3 py-1.5">Actuel</th>
                    <th className="text-right font-medium px-3 py-1.5">Après</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.rows.map(r => {
                    const drop = r.after < r.before;
                    return (
                      <tr key={r.label} className={drop ? 'bg-red-50/60' : undefined}>
                        <td className="px-3 py-1.5 text-gray-700">{r.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{r.before}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${drop ? 'text-red-700' : 'text-gray-800'}`}>
                          {r.after}{drop && <span className="ml-1 font-normal">({r.after - r.before})</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 3. Identité du fichier : sur quoi on s'appuie, et depuis quand. */}
            <p className={`text-xs inline-flex items-center gap-1.5 ${preview.stale ? 'text-amber-800 font-medium' : 'text-gray-500'}`}>
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>
                Fichier : {fileName ?? '(sans nom)'} — {envelope?.exportedAt
                  ? <>exporté le {new Date(envelope.exportedAt).toLocaleString('fr-FR')}, {formatAge(preview.ageDays)}</>
                  : <>sans date d'export</>}
                {preview.stale && <> ⚠️ vérifiez que c'est bien la sauvegarde voulue</>}
              </span>
            </p>

            {/* 4. Écritures encore en vol : elles s'appliqueraient APRÈS la restauration. */}
            {pending > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-orange-50 border border-orange-300 px-3 py-2 text-xs text-orange-900">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  <strong>{pending} modification{pending > 1 ? 's' : ''} pas encore enregistrée{pending > 1 ? 's' : ''}</strong> sur le serveur.
                  La restauration ne passe pas par la file d'envoi : ces écritures partiraient
                  <strong> après</strong>, donc <strong>par-dessus</strong> les données restaurées.
                  Attendez que la synchro soit à jour avant de continuer.
                </span>
              </div>
            )}

            {/* 5. Filet de sécurité, avec preuve persistante qu'il a été pris. */}
            <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-600">Par sécurité, exportez d'abord la base actuelle :</span>
                <button onClick={exportSafety} className="btn-secondary btn-sm shrink-0">
                  <Download className="w-4 h-4" /> Exporter d'abord
                </button>
              </div>
              {safetyExportAt ? (
                <p className="text-xs text-green-700 font-medium inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Sauvegarde exportée à {safetyExportAt.toLocaleTimeString('fr-FR')} — vérifiez qu'elle est bien dans vos téléchargements.
                </p>
              ) : (
                <p className="text-xs text-gray-500">Aucun export effectué depuis l'ouverture de cet écran.</p>
              )}
              <p className="text-xs text-gray-400">
                Sauvegarde complète (incluant la file d'import email) : <code>npm run backup</code> côté poste technique.
              </p>
            </div>

            {/* 6. Ce que la restauration ne couvre PAS. */}
            <p className="text-xs text-gray-500 inline-flex items-start gap-1.5">
              <Inbox className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>La <strong>boîte de réception</strong> (file d'import email) n'est pas concernée : elle ne sera ni remplacée ni restaurée.</span>
            </p>

            {/* 7. Friction proportionnée aux dégâts. */}
            <div>
              <label htmlFor="restore-confirm" className="block text-xs font-medium text-gray-700 mb-1">
                Pour confirmer, tapez <strong>{preview.confirmHint}</strong> :
              </label>
              <input
                id="restore-confirm"
                className="input"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder={preview.confirmWord}
                autoComplete="off"
                inputMode={preview.destructive ? 'numeric' : 'text'}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setConfirmOpen(false)} disabled={restoring} className="btn-secondary btn-sm">Annuler</button>
              <button
                onClick={runRestore}
                disabled={restoring || confirmText.trim() !== preview.confirmWord}
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
