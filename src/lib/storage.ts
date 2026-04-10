import type { AppState } from '../data/types';
import { safeParseJSON } from './utils';

const STORAGE_KEY = 'crm-nautisme-data';

export function loadState(): AppState | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return safeParseJSON<AppState | null>(raw, null);
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState(): void {
  localStorage.removeItem(STORAGE_KEY);
}
