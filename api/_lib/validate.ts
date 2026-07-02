import {
  LEAD_STATUSES, ACTION_TYPES, TEMPERATURES, PRIORITIES,
  BOAT_TYPES, BOAT_CONDITIONS, CALENDAR_EVENT_CATEGORIES,
} from '../../src/data/constants';
import { HttpError } from './http';

// Validation applicative des ENUMS (décision D4 : enums en String, validés côté
// code, pas de CHECK en base). Défense en profondeur : le client envoie déjà des
// valeurs valides, mais l'API refuse toute valeur d'enum inconnue (400).
// On ne valide QUE les champs présents (compatible create ET patch partiel).

const STATUS = new Set<string>(LEAD_STATUSES.map(s => s.value));
const ACTION = new Set<string>(ACTION_TYPES.map(a => a.value));
const TEMP = new Set<string>(TEMPERATURES.map(t => t.value));
const PRIO = new Set<string>(PRIORITIES.map(p => p.value));
const BOAT_TYPE = new Set<string>([...BOAT_TYPES, '']);        // '' autorisé (sentinelle)
const BOAT_COND = new Set<string>([...BOAT_CONDITIONS, '']);
const CATEGORY = new Set<string>(CALENDAR_EVENT_CATEGORIES.map(c => c.value));
const TEMPLATE = new Set<string>(['email', 'sms', 'whatsapp']);

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
