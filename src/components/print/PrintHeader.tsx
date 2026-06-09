import { COMPANY_NAME } from '../../data/constants';

/**
 * En-tete de rapport affiche UNIQUEMENT a l'impression (classe print-only).
 * Affiche le nom d'entreprise (centralise via COMPANY_NAME), le titre du rapport,
 * un sous-titre optionnel (periode / contexte) et la date de generation.
 */
export default function PrintHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const generatedAt = new Date().toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'long', year: 'numeric',
  });

  return (
    <div className="print-only mb-6 border-b border-gray-300 pb-3">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">{COMPANY_NAME}</p>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="text-sm text-gray-600 mt-0.5">{subtitle}</p>}
        </div>
        <p className="text-xs text-gray-500">Généré le {generatedAt}</p>
      </div>
    </div>
  );
}
