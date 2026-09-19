import { SOURCES } from '../data/constants.js';
// Suffixe .js : module aussi chargé par l'API (création de lead, import) en ESM Node.

// ===========================================================================
// Lot 3 — sources des leads : normalisation ANTI-RETOUR (module PUR, prouvé par
// scripts/harness-sources.ts). Appliquée à la saisie, à l'import Excel / CSV, à
// l'acceptation d'un email — côté client ET côté serveur (createLead / updateLead
// / import), pour que rien ne passe à côté.
//
//  - Référence : SOURCES (data/constants). Une valeur qui s'y rapporte malgré la
//    casse, les accents, les espaces, la ponctuation ou une forme d'adresse web
//    (« http://topbarcos.com/ ») est remplacée par le nom de référence.
//  - BoatsGroup est une source de RÉFÉRENCE à part entière, jamais un alias de
//    boats.com (décision du 17/09).
//  - Une source INCONNUE n'est pas refusée : elle est gardée, nettoyée (espaces).
// ===========================================================================

/** Clé de comparaison : minuscules, sans accents ni ponctuation ni espaces. */
export function sourceKey(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** « http://www.TopBarcos.com/annonces » -> « TopBarcos.com » ; autre texte : inchangé. */
function stripWebAddress(value: string): string {
  const m = value.trim().match(/^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:[/?#].*)?$/i);
  return m && /^https?:\/\/|^www\.|\/$/i.test(value.trim()) ? m[1] : value;
}

/**
 * Variantes ÉCRITES AUTREMENT d'une source de référence (clé -> nom de référence).
 *
 * La clé est la forme NORMALISÉE (minuscules, sans accents, sans espaces ni
 * ponctuation) et la comparaison porte sur la chaîne ENTIÈRE, jamais sur une
 * sous-chaîne : « gp » ne peut donc pas attraper « GPS ».
 *
 * Salons (lot salons, S0) : on couvre les ANCIENS libellés — des leads ou des
 * imports peuvent encore les porter — et les formes que l'équipe tape vraiment
 * au stand, où l'on saisit vite. Aucune année ici : le millésime appartient à la
 * campagne, pas à la source.
 */
const ALIASES: Record<string, string> = {
  leboncoin: 'LBC',

  // Grand Pavois — anciens libellés et raccourcis d'usage.
  salongp: 'Salon – Grand Pavois',
  gp: 'Salon – Grand Pavois',
  gp2026: 'Salon – Grand Pavois',
  grandpavois: 'Salon – Grand Pavois',
  pavois: 'Salon – Grand Pavois',
  larochelle2026: 'Salon – Nautique La Rochelle',

  // Cannes.
  saloncan: 'Salon – Cannes',
  cannes: 'Salon – Cannes',

  // Nautique de Paris.
  salonprs: 'Salon – Nautique Paris',
  paris2026: 'Salon – Nautique Paris',

  // Concessionnaire (19/09) : apporteur d'affaires. « concessionnaire » lui-même
  // n'a pas besoin d'alias — la référence se reconnaît d'elle-même ; on couvre
  // ce que l'équipe tape vraiment (pluriel, abréviation, le mot « apporteur »).
  concessionnaires: 'Concessionnaire',
  concession: 'Concessionnaire',
  apporteur: 'Concessionnaire',
  apporteurdaffaires: 'Concessionnaire',
};

/** Nom de référence d'une source, ou null si elle n'y correspond pas. */
export function referenceSource(value: string): string | null {
  const raw = stripWebAddress(value);
  const k = sourceKey(raw);
  if (!k) return null;
  const noTld = k.replace(/(com|fr|es|net|org)$/, '');
  for (const s of SOURCES) {
    const sk = sourceKey(s);
    if (sk === k) return s;
  }
  if (ALIASES[k]) return ALIASES[k];
  // Forme d'adresse web (« topbarcos.com ») : on compare sans l'extension, et
  // seulement contre les références qui n'en ont pas (« boats.com » reste boats.com,
  // « boatsgroup » ne devient jamais boats.com).
  if (raw !== value || /\.(com|fr|es|net|org)$/i.test(raw.trim())) {
    for (const s of SOURCES) {
      const sk = sourceKey(s);
      if (sk === noTld || sk.replace(/(com|fr|es|net|org)$/, '') === noTld) return s;
    }
    if (ALIASES[noTld]) return ALIASES[noTld];
  }
  return null;
}

/**
 * Source normalisée à enregistrer : nom de référence si reconnue, sinon la
 * valeur saisie nettoyée (espaces de bord et multiples). '' reste ''.
 */
export function normalizeSource(value: string | null | undefined): string {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return referenceSource(cleaned) ?? cleaned;
}
