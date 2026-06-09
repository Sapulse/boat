import type { AppState } from '../data/types';
import { safeParseJSON } from './utils';

const STORAGE_KEY = 'crm-nautisme-data';

export function loadState(): AppState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return safeParseJSON<AppState | null>(raw, null);
}

export function saveState(state: AppState): void {
  // Encapsule l'ecriture : un echec (quota plein, navigation privee Safari,
  // stockage indisponible) ne doit pas faire planter l'action utilisateur en cours.
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Echec de sauvegarde locale (quota plein ou stockage indisponible) :', e);
  }
}

export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY);
}
