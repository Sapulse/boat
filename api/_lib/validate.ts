import { HttpError } from './http.js';

// Validation applicative des ENUMS (décision D4 : enums en String, validés côté
// code, pas de CHECK en base). Défense en profondeur : le client envoie déjà des
// valeurs valides, mais l'API refuse toute valeur d'enum inconnue (400).
// On ne valide QUE les champs présents (compatible create ET patch partiel).
//
// ⚠️ Listes d'enums DUPLIQUÉES ici (valeurs figées) volontairement : `api/` ne
// doit RIEN importer de `src/` au runtime (sinon la fonction serverless casse au
// bundling/ESM sur Vercel). Source de vérité = src/data/types.ts. À garder en
// phase si un enum évolue (rare).

const STATUS = new Set(['nouveau', 'a_contacter', 'contacte', 'qualifie', 'devis_envoye', 'negociation', 'en_conclusion', 'signe', 'perdu', 'reporte']);
const ACTION = new Set(['appel', 'email', 'sms', 'whatsapp', 'rdv', 'visite', 'devis', 'relance', 'negociation', 'conclusion', 'note', 'autre']);
const TEMP = new Set(['froid', 'tiede', 'chaud']);
const PRIO = new Set(['basse', 'normale', 'haute', 'critique']);
const BOAT_TYPE = new Set(['Moteur', 'Voile', 'Semi-rigide', '']);        // '' autorisé (sentinelle)
const BOAT_COND = new Set(['Neuf', 'BO', 'DV', '']);
const CATEGORY = new Set(['reunion', 'conge', 'deplacement', 'perso', 'autre']);
const TEMPLATE = new Set(['email', 'sms', 'whatsapp']);

type Rec = Record<string, unknown>;

// Vérifie un champ enum s'il est présent. `optional` autorise null/absent
// (champs facultatifs) ; `emptyOk` autorise la chaîne vide (sentinelles).
function checkEnum(d: Rec, key: string, allowed: Set<string>, opt: { optional?: boolean; emptyOk?: boolean } = {}) {
  const v = d[key];
  if (v === undefined || (opt.optional && v === null)) return;
  if (opt.emptyOk && v === '') return;
  if (typeof v !== 'string' || !allowed.has(v)) {
    throw new HttpError(400, `Champ « ${key} » invalide: ${JSON.stringify(v)}`);
  }
}

export function validateLeadInput(d: Rec): void {
  checkEnum(d, 'status', STATUS);
  checkEnum(d, 'temperature', TEMP);
  checkEnum(d, 'priority', PRIO);
  checkEnum(d, 'boatType', BOAT_TYPE, { emptyOk: true });
  checkEnum(d, 'boatCondition', BOAT_COND, { emptyOk: true });
  checkEnum(d, 'nextActionType', ACTION, { emptyOk: true });
}

export function validateActionInput(d: Rec): void {
  checkEnum(d, 'type', ACTION);
  checkEnum(d, 'newStatus', STATUS, { optional: true });
  checkEnum(d, 'nextActionType', ACTION, { optional: true });
}

export function validateTemplateInput(d: Rec): void {
  checkEnum(d, 'type', TEMPLATE);
}

export function validateCalendarInput(d: Rec): void {
  checkEnum(d, 'category', CATEGORY, { optional: true });
}
