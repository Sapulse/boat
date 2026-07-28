import { SOURCES } from '../../data/constants.js';
import { htmlToText } from './htmlToText.js';
import { unwrapForwards, type EmailEnvelope } from './forward.js';
import { extractBoatscom, extractSite, extractLeboncoin, extractBandofboats, extractInconnu } from './extractors.js';
import { scoreEmail } from './score.js';
import type { RawInboundEmail, ParsedEmail, EmailSourceKind, ExtractResult } from './types.js';

export type { RawInboundEmail, ParsedEmail, EmailSourceKind } from './types.js';

// parseEmail — le « cerveau » de l'import prospects (spec §2, §3, §5).
// Fonction PURE : email décodé en entrée, fiche analysée en sortie. Les
// « mains » (collecte Microsoft Graph) viendront plus tard brancher leurs
// messages ici sans rien changer. Enchaînement : déballer les transferts ->
// reconnaître la source (expéditeur, repli marqueurs de corps) -> extracteur
// de la famille -> score.

const SOURCE_LABELS: Record<EmailSourceKind, string> = {
  boatscom: 'boats.com / BoatWizard',
  site: 'Formulaire du site',
  leboncoin: 'Leboncoin',
  bandofboats: 'Band of Boats',
  inconnu: 'Source inconnue',
};

const EXTRACTORS: Record<EmailSourceKind, (env: EmailEnvelope) => ExtractResult> = {
  boatscom: extractBoatscom,
  site: extractSite,
  leboncoin: extractLeboncoin,
  bandofboats: extractBandofboats,
  inconnu: extractInconnu,
};

function detectSource(env: EmailEnvelope): EmailSourceKind {
  const addr = env.fromAddress.toLowerCase();
  if (addr.endsWith('@leads.boats.com')) return 'boatscom';
  if (addr === 'noreply@brest-ocean-boat.fr') return 'site';
  if (addr.endsWith('@messagerie.leboncoin.fr')) return 'leboncoin';
  if (addr.endsWith('@bandofboats.com')) return 'bandofboats';
  // Repli sur les marqueurs de corps/objet (expéditeur réécrit ou transfert
  // que le déballage n'a pas su suivre) — ordre du plus spécifique au moins.
  if (/PROSPECT INDIVIDUEL\s*:/.test(env.body)) return 'boatscom';
  if (/Formulaire de contact/i.test(env.subject) && /brest[- ]ocean[- ]boat/i.test(env.body)) return 'site';
  if (/sur leboncoin/i.test(env.subject) || /messagerie\.leboncoin\.fr/i.test(env.body)) return 'leboncoin';
  if (/Band of Boats/i.test(env.body)) return 'bandofboats';
  return 'inconnu';
}

/** Clé de rapprochement : minuscules, sans accents ni ponctuation. */
function normKey(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Rapproche une « Origine du contact » boats.com de la liste SOURCES du CRM
 * (casse/accents/« .com » ignorés : « TopBarcos.com » -> « Top barcos »,
 * « Annonces du Bateau » -> « Annonces du bateau »). Origine hors liste ->
 * null (l'appelant retombe sur « boats.com »).
 */
export function matchCrmSource(value: string): string | null {
  const n = normKey(value);
  if (!n) return null;
  for (const s of SOURCES) {
    const k = normKey(s);
    if (k === n || k === n.replace(/com$/, '') || n === k.replace(/com$/, '')) return s;
  }
  return null;
}

function mapLeadSource(source: EmailSourceKind, sourceDetail?: string): string {
  switch (source) {
    case 'boatscom': return (sourceDetail && matchCrmSource(sourceDetail)) || 'boats.com';
    case 'site': return 'Site BOB';
    case 'leboncoin': return 'LBC';
    case 'bandofboats': return 'Band of Boats';
    default: return ''; // source obligatoire -> choix humain à la validation
  }
}

export function parseEmail(raw: RawInboundEmail): ParsedEmail {
  const text = raw.text?.trim() ? raw.text : htmlToText(raw.html ?? '');
  const env = unwrapForwards(raw.from, raw.subject, text);
  const source = detectSource(env);
  const ex = EXTRACTORS[source](env);
  const { score, reasons } = scoreEmail(source, ex);

  return {
    source,
    sourceLabel: SOURCE_LABELS[source],
    sourceDetail: ex.sourceDetail,
    leadSource: mapLeadSource(source, ex.sourceDetail),
    extracted: ex.extracted,
    excerpt: ex.excerpt,
    notes: ex.notes,
    score,
    scoreReasons: reasons,
  };
}
