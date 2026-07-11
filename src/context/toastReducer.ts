// Cœur PUR des toasts (lot confort B3) — aucune dépendance React, testé par
// scripts/harness-toast.ts (même découpage que appReducer / submitGuard : le
// provider ne garde que le câblage timers/context).

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

export type ToastEvent =
  | { type: 'PUSH'; toast: Toast }
  | { type: 'DISMISS'; id: string };

// Pile plafonnée : au-delà, les plus ANCIENS sortent (un toast est un feedback
// éphémère — mieux vaut perdre le vieux que masquer le récent ou empiler).
export const TOAST_LIMIT = 3;

// Une erreur se lit plus longtemps qu'une confirmation ; les durées vivent ici
// (pur) pour être couvertes par le harnais.
export function toastDuration(kind: ToastKind): number {
  return kind === 'error' ? 6000 : 3000;
}

export function toastReducer(state: Toast[], event: ToastEvent): Toast[] {
  switch (event.type) {
    case 'PUSH': {
      // Dédoublonnage kind+message : re-déclencher le même feedback (ex. 2 appels
      // journalisés coup sur coup) REMPLACE l'existant (remonte en tête de pile,
      // nouvel id donc nouveau timer) au lieu d'empiler des doublons. Le timer de
      // l'ancien id retombera sur un DISMISS sans effet.
      const rest = state.filter(t => !(t.kind === event.toast.kind && t.message === event.toast.message));
      return [...rest, event.toast].slice(-TOAST_LIMIT);
    }
    case 'DISMISS':
      // Id inconnu (timer d'un toast déjà remplacé/fermé) -> MÊME référence,
      // pas de re-render.
      return state.some(t => t.id === event.id) ? state.filter(t => t.id !== event.id) : state;
  }
}
