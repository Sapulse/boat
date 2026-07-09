import type { Lead, LeadStatus, BoatType, BoatCondition, Commercial } from '../data/types';

// ===========================================================================
// Import de leads depuis le fichier de suivi Ocean Boat (chantier import/export,
// Étape 1). MODULE PUR, sans React ni I/O réseau — testable au harnais comme
// vcard.ts / email.ts. Aucune ÉCRITURE ici : on parse le CSV et on FIGE un
// aperçu (leads mappés + lignes rejetées + commerciaux à créer). L'écriture via
// le repository/outbox viendra à l'Étape 3.
//
// Référence métier : MAPPING_IMPORT_LEADS.md (décisions validées Mickaël).
// Décisions appliquées ici :
//  - Commercial OBLIGATOIRE (FK) -> orphelins (Camaret/cmys/vide) rattachés à un
//    commercial « Non attribué », mention [Camaret]/[cmys] préfixée au commentaire.
//  - Statut = col « En conclusion » (labels FR) -> codes CRM (identité sémantique).
//  - États stockés en CODES BRUTS (Neuf/BO/DV), pas de traduction.
//  - Option SIMPLE (§6) : PAS d'actions générées. « Date de contact » -> champ
//    contactDate ; Relance 1/2/3, Négociation/Devis, Signé/Perdu -> RÉSUMÉES dans
//    le commentaire du lead. (Enrichissement en actions repoussé.)
//  - Chaque valeur mappée respecte la validation zod de l'API (api/_lib/validate.ts).
// ===========================================================================

/** Une ligne du CSV, clés = en-têtes (déjà trimmés). */
export type RawRow = Record<string, string>;

/** Lead mappé, prêt à écrire (id + commercialId ajoutés à l'Étape 3). */
export interface PreparedLead {
  lead: Omit<Lead, 'id' | 'commercialId'>;
  /** Nom canonique du commercial (résolu en id à l'écriture). */
  commercialName: string;
  /** Anomalies NON bloquantes (le lead est importé quand même). */
  warnings: string[];
  /** N° de ligne dans le fichier (en-tête = ligne 1). */
  sourceLine: number;
}

/** Ligne EXCLUE de l'import (aucun identifiant exploitable). */
export interface RejectedRow {
  line: number;
  reasons: string[];
  raw: RawRow;
}

export interface ImportPreview {
  leads: PreparedLead[];
  rejected: RejectedRow[];
  /** Noms des commerciaux référencés absents de la base (à créer avant les leads). */
  commercialsToCreate: string[];
  stats: {
    total: number;    // lignes de données non vides
    valid: number;    // leads mappés
    orphans: number;  // leads rattachés à « Non attribué »
    rejected: number; // lignes exclues
    actions: number;  // toujours 0 en option simple (pas d'actions générées)
  };
}

// --- Échange avec l'endpoint bulk (Étape 3) ---------------------------------
// Le client envoie les leads référençant leur commercial PAR NOM ; le serveur
// résout nom -> id (idempotence). Types dupliqués côté serveur (découplage api/↔src).

/** Corps envoyé à POST /api/import. */
export interface ImportPayload {
  /** Noms des commerciaux à garantir en base (les manquants). */
  commercials: string[];
  /** Leads mappés, chacun référençant son commercial par nom. */
  leads: Array<Omit<Lead, 'id' | 'commercialId'> & { commercialName: string }>;
}

/** Compte-rendu renvoyé par l'endpoint bulk. */
export interface ImportReport {
  commercialsCreated: number;
  commercialsExisting: number;
  leadsCreated: number;
}

/** Construit le corps d'import à partir d'un aperçu validé. */
export function toImportPayload(preview: ImportPreview): ImportPayload {
  return {
    commercials: preview.commercialsToCreate,
    leads: preview.leads.map(l => ({ ...l.lead, commercialName: l.commercialName })),
  };
}

/** Commercial spécial « boîte » pour les leads orphelins (FK oblige). */
export const NON_ATTRIBUE = 'Non attribué';
/** Roster canonique retenu (fusion de casse du fichier source). */
export const ROSTER = ['Tom', 'Fred', 'Océane', 'Nicolas'] as const;

// --- En-têtes attendus (déjà trimmés — le fichier a des espaces parasites :
// « Etat », « Budget (€) », « Date de contact »...). ---
const COL = {
  createdAt: 'Date de création',
  source: 'Source',
  commercial: 'Commercial',
  lastName: 'Nom',
  firstName: 'Prénom',
  phone: 'Téléphone',
  email: 'Email',
  boatType: 'Type de bateau',
  etat: 'Etat',
  boatInterest: 'Intérêt bateau',
  brand: 'Marque',
  budget: 'Budget (€)',
  status: 'En conclusion',
  dateContact: 'Date de contact',
  relance1: 'Relance 1',
  relance2: 'Relance 2',
  negoDevis: 'Négociation/Devis',
  relance3: 'Relance 3',
  signePerdu: 'Signé/Perdu',
  montantDevis: 'Montant devis (€)',
  comments: 'Commentaires',
} as const;

// ---------------------------------------------------------------------------
// Normalisation & petits parseurs (purs)
// ---------------------------------------------------------------------------

/** minuscules + sans accents + trim — clé de correspondance robuste. */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * Date FR `JJ/MM/AAAA` (aussi `.`/`-`, année sur 2 ou 4 chiffres) -> ISO
 * `AAAA-MM-JJ`. Renvoie null si illisible (dont l'anomalie connue `10:06:26`).
 * Valide la date réelle (rejette 31/02).
 */
export function parseFrDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Contrôle calendaire réel (rejette p.ex. 31/02, 30/02).
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * Montant `"64 900 €"` / `"34 000,00 €"` -> nombre. Retire espaces (dont
 * insécables), `€` et lettres ; gère les milliers `.`/espace et la virgule
 * décimale FR. Renvoie null si vide ou illisible.
 */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\u20ac\s\u00a0\u202f]/g, '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) s = s.replace(/\./g, '').replace(',', '.'); // FR : . milliers, , décimale
  else if (hasComma) s = s.replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Téléphone : nettoyage A MINIMA (trim + espaces multiples réduits). Pas de reformatage. */
export function cleanPhone(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

// --- Tables de correspondance (§4 du mapping) ---

const STATUS_MAP: Record<string, LeadStatus> = {
  nouveau: 'nouveau',
  'a contacter': 'a_contacter',
  contacte: 'contacte',
  'client relance': 'contacte',   // pas de statut « relancé » -> reste contacté
  qualifie: 'qualifie',
  'en cours': 'qualifie',         // « en cours » = lead travaillé
  'devis envoye': 'devis_envoye',
  negociation: 'negociation',
  'en conclusion': 'en_conclusion',
  signe: 'signe',
  perdu: 'perdu',
  reporte: 'reporte',
};

const TYPE_MAP: Record<string, BoatType> = {
  moteur: 'Moteur',
  moter: 'Moteur',              // faute connue du fichier
  voile: 'Voile',
  'semi-rigide': 'Semi-rigide',
  'semi rigide': 'Semi-rigide',
};

/** État -> code CRM brut (Neuf/BO/DV) + éventuel avertissement. */
function mapCondition(raw: string): { value: BoatCondition | ''; warning: string | null } {
  const k = norm(raw);
  if (!k) return { value: '', warning: null };
  if (k === 'dv') return { value: 'DV', warning: null };
  if (k === 'bo' || k === 'occasion' || k === 'ocassion') return { value: 'BO', warning: null };
  if (k === 'neuf' || k === 'bn') return { value: 'Neuf', warning: null };
  if (k === 'neuf ou occasion') return { value: 'Neuf', warning: `État ambigu « ${raw.trim()} » → « Neuf »` };
  if (k === 'location') return { value: '', warning: 'État « Location » non géré pour l’instant → vide' };
  return { value: '', warning: `État « ${raw.trim()} » inconnu → vide` };
}

/** Commercial source -> nom canonique (+ marqueur orphelin + avertissement). */
function resolveCommercial(raw: string): { name: string; tag: string | null; warning: string | null } {
  const k = norm(raw);
  if (k === 'tom') return { name: 'Tom', tag: null, warning: null };
  if (k === 'fred') return { name: 'Fred', tag: null, warning: null };
  if (k === 'oceane') return { name: 'Océane', tag: null, warning: null };
  if (k === 'nicolas') return { name: 'Nicolas', tag: null, warning: null };
  if (k === 'camaret') return { name: NON_ATTRIBUE, tag: 'Camaret', warning: null };
  if (k === 'cmys') return { name: NON_ATTRIBUE, tag: 'cmys', warning: null };
  if (!k) return { name: NON_ATTRIBUE, tag: null, warning: null };
  return { name: NON_ATTRIBUE, tag: null, warning: `Commercial « ${raw.trim()} » inconnu → Non attribué` };
}

// ---------------------------------------------------------------------------
// Parsing CSV (RFC 4180, séparateur ';') — zéro dépendance.
// ---------------------------------------------------------------------------

/** Découpe un texte délimité en grille de cellules (guillemets + `""` gérés). */
function parseGrid(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let started = false; // au moins un caractère/champ sur la ligne courante
  let str = text;
  if (str.charCodeAt(0) === 0xfeff) str = str.slice(1); // BOM UTF-8
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { rows.push(row); row = []; started = false; };
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inQuotes) {
      if (c === '"') {
        if (str[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; started = true; continue; }
    if (c === delimiter) { pushField(); started = true; continue; }
    if (c === '\r') continue;              // CRLF : le \n déclenche la fin de ligne
    if (c === '\n') { pushField(); pushRow(); continue; }
    field += c; started = true;
  }
  if (started || field !== '' || row.length > 0) { pushField(); pushRow(); }
  return rows;
}

/**
 * Parse le CSV Ocean Boat en lignes-objets (clés = en-têtes trimmés). Conserve
 * TOUTES les lignes de données (y compris vides) pour que la numérotation de
 * ligne reste exacte ; le tri du bruit se fait dans buildPreview.
 */
export function parseImportCsv(text: string): RawRow[] {
  const grid = parseGrid(text, ';');
  if (grid.length === 0) return [];
  const headers = grid[0].map(h => h.trim());
  const rows: RawRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const obj: RawRow = {};
    headers.forEach((h, idx) => { obj[h] = cells[idx] ?? ''; });
    rows.push(obj);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Mapping d'une ligne -> lead préparé (ou rejet)
// ---------------------------------------------------------------------------

const get = (row: RawRow, col: string): string => (row[col] ?? '').trim();

/** Ligne entièrement vide (bruit Excel au-delà des 294 leads réels). */
function isBlank(row: RawRow): boolean {
  return Object.values(row).every(v => v.trim() === '');
}

function mapRow(row: RawRow, today: string, line: number): { prepared: PreparedLead } | { rejected: RejectedRow } {
  const warnings: string[] = [];

  const lastName = get(row, COL.lastName);
  const firstName = get(row, COL.firstName);
  const phoneRaw = get(row, COL.phone);
  const emailRaw = get(row, COL.email);

  // Rejet DUR : rien pour identifier le lead.
  if (!lastName && !firstName && !phoneRaw && !emailRaw) {
    return { rejected: { line, reasons: ['aucun identifiant (nom, prénom, téléphone, email tous vides)'], raw: row } };
  }

  // createdAt — REQUIS côté zod (dateStr strict) : repli sur `today` si absent/illisible.
  const createdRaw = get(row, COL.createdAt);
  const createdAt = parseFrDate(createdRaw) ?? today;
  if (createdAt === today && norm(createdRaw) !== today) {
    warnings.push(createdRaw
      ? `Date de création « ${createdRaw} » illisible → date du jour`
      : 'Date de création absente → date du jour');
  }

  // Statut (col « En conclusion »).
  const statusRaw = get(row, COL.status);
  let status: LeadStatus = 'nouveau';
  if (!statusRaw) warnings.push("Statut (« En conclusion ») absent → « nouveau »");
  else {
    const mapped = STATUS_MAP[norm(statusRaw)];
    if (mapped) status = mapped;
    else warnings.push(`Statut « ${statusRaw} » inconnu → « nouveau »`);
  }

  // Type de bateau.
  const typeRaw = get(row, COL.boatType);
  let boatType: BoatType | '' = '';
  if (typeRaw) {
    const mapped = TYPE_MAP[norm(typeRaw)];
    if (mapped) boatType = mapped;
    else warnings.push(`Type de bateau « ${typeRaw} » inconnu → vide`);
  }

  // État (codes bruts).
  const cond = mapCondition(get(row, COL.etat));
  if (cond.warning) warnings.push(cond.warning);

  // Budget / montant devis.
  const budgetRaw = get(row, COL.budget);
  const budget = parseAmount(budgetRaw);
  if (budgetRaw && budget === null) warnings.push(`Budget « ${budgetRaw} » illisible → vide`);
  const quoteRaw = get(row, COL.montantDevis);
  const quoteAmount = parseAmount(quoteRaw);
  if (quoteRaw && quoteAmount === null) warnings.push(`Montant devis « ${quoteRaw} » illisible → vide`);

  // Date de contact -> champ contactDate.
  const contactRaw = get(row, COL.dateContact);
  const contactDate = parseFrDate(contactRaw) ?? '';
  if (contactRaw && !contactDate) warnings.push(`Date de contact « ${contactRaw} » illisible → ignorée`);

  // Commercial (+ orphelins).
  const commercial = resolveCommercial(get(row, COL.commercial));
  if (commercial.warning) warnings.push(commercial.warning);

  // Commentaire = [marqueur orphelin] + texte source + résumé de suivi (option simple).
  const suiviParts: string[] = [];
  const pushSuivi = (label: string, col: string) => { const v = get(row, col); if (v) suiviParts.push(`${label} : ${v}`); };
  pushSuivi('Relance 1', COL.relance1);
  pushSuivi('Relance 2', COL.relance2);
  pushSuivi('Relance 3', COL.relance3);
  pushSuivi('Négociation/Devis', COL.negoDevis);
  pushSuivi('Signé/Perdu', COL.signePerdu);
  const suivi = suiviParts.length ? `Suivi importé — ${suiviParts.join(' ; ')}` : '';

  let comments = get(row, COL.comments);
  if (commercial.tag) comments = comments ? `[${commercial.tag}] ${comments}` : `[${commercial.tag}]`;
  if (suivi) comments = comments ? `${comments}\n${suivi}` : suivi;

  const lead: Omit<Lead, 'id' | 'commercialId'> = {
    createdAt,
    source: get(row, COL.source),
    firstName,
    lastName,
    phone: cleanPhone(phoneRaw),
    email: emailRaw.toLowerCase(),
    boatType,
    boatCondition: cond.value,
    boatInterest: get(row, COL.boatInterest),
    brand: get(row, COL.brand),
    budget,
    status,
    contactDate,
    quoteAmount,
    probability: null,
    currentBoat: '',
    comments,
    deliveryDate: '',
    temperature: 'tiede',
    priority: 'normale',
    nextActionType: '',
    nextActionDate: '',
    lastActionDate: '',
    lossReason: '',
    signedAt: '',
    lostAt: '',
    reportedAt: '',
  };

  return { prepared: { lead, commercialName: commercial.name, warnings, sourceLine: line } };
}

/**
 * Construit l'aperçu d'import (lecture seule). `existing` = commerciaux déjà en
 * base (pour ne proposer à la création que les manquants). `today` INJECTÉ
 * (ISO `AAAA-MM-JJ`) -> déterminisme au harnais + repli createdAt.
 */
export function buildPreview(
  rows: RawRow[],
  existing: readonly Pick<Commercial, 'name'>[],
  today: string,
): ImportPreview {
  const leads: PreparedLead[] = [];
  const rejected: RejectedRow[] = [];

  rows.forEach((row, i) => {
    if (isBlank(row)) return;         // bruit Excel : ni compté ni rejeté
    const line = i + 2;               // en-tête = ligne 1
    const res = mapRow(row, today, line);
    if ('rejected' in res) rejected.push(res.rejected);
    else leads.push(res.prepared);
  });

  const orphans = leads.filter(l => l.commercialName === NON_ATTRIBUE).length;

  // Commerciaux à créer : ceux réellement utilisés et absents de la base.
  const existingNames = new Set(existing.map(c => norm(c.name)));
  const usedNames = new Set(leads.map(l => l.commercialName));
  const commercialsToCreate = [...ROSTER, NON_ATTRIBUE]
    .filter(name => usedNames.has(name) && !existingNames.has(norm(name)));

  return {
    leads,
    rejected,
    commercialsToCreate,
    stats: {
      total: leads.length + rejected.length,
      valid: leads.length,
      orphans,
      rejected: rejected.length,
      actions: 0,
    },
  };
}
