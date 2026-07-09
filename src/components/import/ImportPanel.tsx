import { useRef, useState } from 'react';
import { Upload, Download, AlertTriangle, Users, FileText, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/useApp';
import { USE_API } from '../../lib/flags';
import { toISODate, formatCurrency } from '../../lib/utils';
import { exportCSV } from '../../lib/csv';
import Modal from '../ui/Modal';
import { parseImportCsv, buildPreview, toImportPayload, type ImportPreview, type ImportReport } from '../../lib/importLeads';

// Panneau d'IMPORT (chantier import/export). Étape 2 : lecture + aperçu. Étape 3 :
// écriture via l'endpoint bulk (importBulk du contexte, mode API uniquement) —
// appel DIRECT hors outbox, atomique, avec compte-rendu VISIBLE + ré-hydratation.

const PREVIEW_ROWS = 25; // nb de leads affichés dans le tableau d'aperçu

function StatTile({ label, value, tone }: { label: string; value: number; tone: 'default' | 'warn' | 'bad' }) {
  const color =
    tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-primary-600';
  return (
    <div className="card px-4 py-3">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

export default function ImportPanel() {
  const { state, importBulk } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Écriture (Étape 3).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de re-sélectionner le même fichier
    if (!file) return;
    setError(null);
    setImportError(null);
    setReport(null);
    setPreview(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const rows = parseImportCsv(text);
        setPreview(buildPreview(rows, state.commercials, toISODate(new Date())));
      } catch (err) {
        setError(`Lecture impossible : ${(err as Error).message}`);
      }
    };
    reader.onerror = () => setError('Échec de lecture du fichier.');
    reader.readAsText(file, 'UTF-8');
  };

  // Rapport téléchargeable : rejets + alertes (warnings) par ligne.
  const downloadReport = () => {
    if (!preview) return;
    const rows: string[][] = [];
    preview.rejected.forEach(r => rows.push([String(r.line), 'Rejet', r.reasons.join(' | ')]));
    preview.leads.forEach(l => l.warnings.forEach(w => rows.push([String(l.sourceLine), 'Alerte', w])));
    rows.sort((a, b) => Number(a[0]) - Number(b[0]));
    exportCSV('rapport-import.csv', ['Ligne', 'Type', 'Détail'], rows);
  };

  const runImport = async () => {
    if (!preview || !importBulk) return;
    setImporting(true);
    setImportError(null);
    try {
      const rep = await importBulk(toImportPayload(preview));
      setReport(rep);
      setPreview(null);
      setFileName(null);
      setConfirmOpen(false);
    } catch (e) {
      setImportError((e as Error).message);
      setConfirmOpen(false);
    } finally {
      setImporting(false);
    }
  };

  const warningCount = preview ? preview.leads.reduce((n, l) => n + l.warnings.length, 0) : 0;

  return (
    <div className="card p-6 space-y-5">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-primary-50 text-primary-600 shrink-0">
          <Upload className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">Import de leads (.csv)</h3>
          <p className="text-xs text-gray-500 mt-1">
            Chargez le fichier de suivi (CSV, séparateur « ; », UTF-8). L'aperçu applique le
            mapping sans rien écrire ; l'écriture se fait après confirmation.
          </p>
        </div>
      </div>

      {/* Compte-rendu d'import (bien visible, persiste jusqu'à fermeture). */}
      {report && (
        <div className="rounded-lg bg-green-50 border border-green-300 px-4 py-3 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
          <div className="text-sm text-green-800">
            <p className="font-semibold">Import terminé ✓</p>
            <p className="mt-0.5">
              <strong>{report.leadsCreated} leads créés</strong>
              {' · '}<strong>{report.commercialsCreated} commerciaux créés</strong>
              {report.commercialsExisting > 0 && ` · ${report.commercialsExisting} déjà présents`}.
            </p>
          </div>
          <button onClick={() => setReport(null)} className="ml-auto text-xs text-green-700 hover:underline">Fermer</button>
        </div>
      )}

      {importError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
          Import refusé : {importError} — <strong>rien n'a été écrit</strong> (transaction annulée).
        </div>
      )}

      {!USE_API && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong>Mode local (localStorage).</strong> L'import est désactivé : il ne peuplerait
            que ce navigateur. Faites l'import en mode API (flag on) pour la base partagée.
          </span>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
        <button onClick={() => fileInputRef.current?.click()} className="btn-secondary btn-sm">
          <Upload className="w-4 h-4" /> Choisir un fichier CSV
        </button>
        {fileName && <span className="text-xs text-gray-500 inline-flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{fileName}</span>}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {preview && (
        <div className="space-y-5">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile label="leads valides" value={preview.stats.valid} tone="default" />
            <StatTile label="non attribués" value={preview.stats.orphans} tone="warn" />
            <StatTile label="lignes rejetées" value={preview.stats.rejected} tone={preview.stats.rejected ? 'bad' : 'default'} />
            <StatTile label="alertes (warnings)" value={warningCount} tone={warningCount ? 'warn' : 'default'} />
          </div>

          {/* Commerciaux à créer */}
          <div className="flex items-start gap-2 text-xs text-gray-600">
            <Users className="w-4 h-4 shrink-0 mt-0.5 text-gray-400" />
            {preview.commercialsToCreate.length > 0 ? (
              <span>
                Commerciaux à créer avant les leads :{' '}
                {preview.commercialsToCreate.map((n) => (
                  <span key={n} className="inline-block bg-gray-100 rounded px-1.5 py-0.5 mr-1 font-medium text-gray-700">{n}</span>
                ))}
              </span>
            ) : (
              <span>Tous les commerciaux référencés existent déjà en base.</span>
            )}
          </div>

          {/* Aperçu des premiers leads mappés */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">
              Aperçu des {Math.min(PREVIEW_ROWS, preview.leads.length)} premiers leads mappés
              {preview.leads.length > PREVIEW_ROWS && <span className="text-gray-400"> (sur {preview.leads.length})</span>}
            </p>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    {['Ligne', 'Nom', 'Prénom', 'Commercial', 'Statut', 'État', 'Type', 'Budget', 'Source', 'Contact', '⚠'].map(h => (
                      <th key={h} className="text-left font-medium px-2.5 py-1.5 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.leads.slice(0, PREVIEW_ROWS).map((l) => {
                    const orphan = l.commercialName === 'Non attribué';
                    return (
                      <tr key={l.sourceLine} className="text-gray-700">
                        <td className="px-2.5 py-1.5 text-gray-400">{l.sourceLine}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{l.lead.lastName || '—'}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{l.lead.firstName || '—'}</td>
                        <td className={`px-2.5 py-1.5 whitespace-nowrap ${orphan ? 'text-amber-600 font-medium' : ''}`}>{l.commercialName}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{l.lead.status}</td>
                        <td className="px-2.5 py-1.5">{l.lead.boatCondition || '—'}</td>
                        <td className="px-2.5 py-1.5">{l.lead.boatType || '—'}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{l.lead.budget !== null ? formatCurrency(l.lead.budget) : '—'}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{l.lead.source || '—'}</td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">{l.lead.contactDate || '—'}</td>
                        <td className="px-2.5 py-1.5 text-center">{l.warnings.length > 0 ? <span className="text-amber-600" title={l.warnings.join('\n')}>{l.warnings.length}</span> : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Rapport + action d'import */}
          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <button
              onClick={downloadReport}
              disabled={preview.rejected.length === 0 && warningCount === 0}
              className="btn-secondary btn-sm disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> Rapport rejets/alertes ({preview.rejected.length + warningCount})
            </button>

            {importBulk ? (
              <button
                onClick={() => setConfirmOpen(true)}
                disabled={importing || preview.stats.valid === 0}
                className="btn-primary btn-sm disabled:opacity-50"
              >
                {importing ? 'Import en cours…' : `Importer ${preview.stats.valid} leads`}
              </button>
            ) : (
              <span className="text-xs text-gray-400">Import disponible en mode API</span>
            )}
          </div>
        </div>
      )}

      {/* Confirmation avant écriture (+ garde-fou anti-double-import). */}
      <Modal open={confirmOpen} onClose={() => { if (!importing) setConfirmOpen(false); }} title="Confirmer l'import" size="md">
        {preview && (
          <div className="space-y-4 text-sm text-gray-700">
            <p>Cet import va créer en base :</p>
            <ul className="list-disc pl-5 space-y-1">
              {preview.commercialsToCreate.length > 0 && (
                <li><strong>{preview.commercialsToCreate.length} commerciaux</strong> ({preview.commercialsToCreate.join(', ')})</li>
              )}
              <li>
                <strong>{preview.stats.valid} leads</strong>
                {preview.stats.orphans > 0 && ` (dont ${preview.stats.orphans} rattachés à « Non attribué »)`}
              </li>
            </ul>

            {state.leads.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  La base contient déjà <strong>{state.leads.length} leads</strong>. L'import va
                  {' '}<strong>AJOUTER</strong> {preview.stats.valid} leads — il ne remplace rien.
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setConfirmOpen(false)} disabled={importing} className="btn-secondary btn-sm">Annuler</button>
              <button onClick={runImport} disabled={importing} className="btn-primary btn-sm disabled:opacity-60">
                {importing ? 'Import en cours…' : "Confirmer l'import"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
