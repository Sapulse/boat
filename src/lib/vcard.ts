import type { Lead } from '../data/types';
import { toISODate } from './utils';

export interface ParsedContact {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

export type DuplicateReason = 'email' | 'phone' | 'both';

export interface DuplicateMatch {
  contact: ParsedContact;
  reason: DuplicateReason;
  existing: Lead;
}

// ---------------------------------------------------------------------------
// Generation (vCard 3.0)
// ---------------------------------------------------------------------------

/** Echappe une valeur texte vCard : \ , ; et les retours a la ligne. */
function escapeText(v: string): string {
  return v
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * Genere une vCard 3.0 (UTF-8) pour un lead. Le type de bateau, le modele
 * d'interet et le commercial assigne vont dans NOTE (pas de champ natif vCard).
 * Helper pur.
 */
export function generateVCard(lead: Lead, commercialName: string): string {
  const fullName = `${lead.firstName} ${lead.lastName}`.trim();
  const note = [
    `Type de bateau: ${lead.boatType || '-'}`,
    `Modele d'interet: ${lead.boatInterest || '-'}`,
    `Commercial: ${commercialName || '-'}`,
  ].join('\n');

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeText(lead.lastName)};${escapeText(lead.firstName)};;;`,
    `FN:${escapeText(fullName)}`,
  ];
  if (lead.phone) lines.push(`TEL;TYPE=CELL:${escapeText(lead.phone)}`);
  if (lead.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeText(lead.email)}`);
  lines.push(`NOTE:${escapeText(note)}`);
  lines.push('END:VCARD');

  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Parsing (tolerant 2.1 / 3.0 / 4.0)
// ---------------------------------------------------------------------------

/** Inverse de escapeText. */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Decoupe sur les ';' NON echappes (pour le champ structure N). Scanner manuel
 * sans lookbehind regex -> compatible tous navigateurs (dont Safari < 16.4). Une
 * sequence echappee (\; \, \\) est conservee telle quelle dans la part courante,
 * unescapeText la normalisera ensuite.
 */
function splitUnescaped(v: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < v.length; i++) {
    const ch = v[i];
    if (ch === '\\' && i + 1 < v.length) {
      current += ch + v[i + 1];
      i++;
    } else if (ch === ';') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Parse un texte .vcf pouvant contenir plusieurs VCARD. Tolerant : depliage des
 * lignes "folded" (continuation commencant par espace/tab), CRLF ou LF, versions
 * 2.1/3.0/4.0, parametres TYPE= ignores, champs manquants, proprietes inconnues
 * ignorees. Une carte sans aucun nom/tel/email est ignoree.
 * Helper pur.
 */
export function parseVCards(text: string): ParsedContact[] {
  // Depliage : une ligne suivante commencant par espace/tab prolonge la precedente.
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const lines = unfolded.split(/\r\n|\r|\n/);

  const contacts: ParsedContact[] = [];
  let current: { n?: string; fn?: string; tel?: string; email?: string } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const upper = line.toUpperCase();

    if (upper === 'BEGIN:VCARD') { current = {}; continue; }
    if (upper === 'END:VCARD') {
      if (current) contacts.push(buildContact(current));
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const namePart = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const prop = namePart.split(';')[0].toUpperCase();

    if (prop === 'N' && current.n === undefined) current.n = value;
    else if (prop === 'FN' && current.fn === undefined) current.fn = value;
    else if (prop === 'TEL' && current.tel === undefined) current.tel = value;
    else if (prop === 'EMAIL' && current.email === undefined) current.email = value;
  }

  // Filtre : on ne garde que les cartes avec au moins une donnee exploitable.
  return contacts.filter(c => c.firstName || c.lastName || c.phone || c.email);
}

function buildContact(raw: { n?: string; fn?: string; tel?: string; email?: string }): ParsedContact {
  let firstName = '';
  let lastName = '';

  if (raw.n !== undefined) {
    const parts = splitUnescaped(raw.n).map(unescapeText);
    lastName = (parts[0] ?? '').trim();
    firstName = (parts[1] ?? '').trim();
  } else if (raw.fn !== undefined) {
    // Pas de N structure : on decoupe le nom complet (1er mot = prenom).
    const tokens = unescapeText(raw.fn).trim().split(/\s+/);
    firstName = tokens.shift() ?? '';
    lastName = tokens.join(' ');
  }

  return {
    firstName,
    lastName,
    phone: raw.tel ? unescapeText(raw.tel).trim() : '',
    email: raw.email ? unescapeText(raw.email).trim() : '',
  };
}

// ---------------------------------------------------------------------------
// Normalisation + detection de doublons
// ---------------------------------------------------------------------------

export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

/** Garde uniquement chiffres et '+' (retire espaces, points, tirets, parentheses). */
export function normalizePhone(s: string): string {
  return s.replace(/[^\d+]/g, '');
}

/**
 * Repartit les contacts importes en nouveaux vs doublons, par comparaison avec
 * les leads existants sur l'email OU le telephone normalises. Les valeurs vides
 * ne matchent jamais entre elles (pas de faux doublon). Helper pur.
 */
export function splitNewVsDuplicates(
  contacts: ParsedContact[],
  existingLeads: Lead[],
): { fresh: ParsedContact[]; duplicates: DuplicateMatch[] } {
  const emailMap = new Map<string, Lead>();
  const phoneMap = new Map<string, Lead>();
  for (const lead of existingLeads) {
    const ne = normalizeEmail(lead.email);
    const np = normalizePhone(lead.phone);
    if (ne && !emailMap.has(ne)) emailMap.set(ne, lead);
    if (np && !phoneMap.has(np)) phoneMap.set(np, lead);
  }

  const fresh: ParsedContact[] = [];
  const duplicates: DuplicateMatch[] = [];

  for (const contact of contacts) {
    const ne = normalizeEmail(contact.email);
    const np = normalizePhone(contact.phone);
    const emailMatch = ne ? emailMap.get(ne) : undefined;
    const phoneMatch = np ? phoneMap.get(np) : undefined;

    if (emailMatch || phoneMatch) {
      const reason: DuplicateReason = emailMatch && phoneMatch ? 'both' : emailMatch ? 'email' : 'phone';
      duplicates.push({ contact, reason, existing: (emailMatch ?? phoneMatch)! });
    } else {
      fresh.push(contact);
    }
  }

  return { fresh, duplicates };
}

// ---------------------------------------------------------------------------
// Factory : contact -> Lead (champs CRM aux valeurs par defaut)
// ---------------------------------------------------------------------------

/**
 * Construit un Lead (sans id) a partir d'un contact importe. Les champs CRM
 * (statut, source, bateau, commercial...) restent aux valeurs par defaut, a
 * completer par le commercial. commercialId reste vide : PAS de rattachement
 * automatique (evite les faux rattachements).
 */
export function createLeadFromContact(contact: ParsedContact): Omit<Lead, 'id'> {
  return {
    createdAt: toISODate(new Date()),
    source: '',
    commercialId: '',
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    email: contact.email,
    boatType: '',
    boatCondition: '',
    boatInterest: '',
    brand: '',
    budget: null,
    status: 'nouveau',
    contactDate: '',
    quoteAmount: null,
    probability: null,
    currentBoat: '',
    comments: '',
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
}
