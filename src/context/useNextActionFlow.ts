import { createContext, useContext } from 'react';
import type { Lead, LeadAction, PlannedAction } from '../data/types';
import type { NextActionEntry } from '../lib/plannedActions';

// Contexte + hook (module sans composant, règle react-refresh) — le provider
// vit dans NextActionFlowContext.tsx.

export interface NextActionFlowApi {
  /** Ouvre la fenêtre Prochaine action SI la décision (lib/plannedActions) le demande. */
  decide(leadId: string, entry: NextActionEntry): void;
  /** Email / SMS / WhatsApp déjà ouvert : « Avez-vous bien envoyé le message ? ». Oui -> action + fenêtre. */
  confirmMessage(args: { lead: Lead; channel: 'email' | 'sms' | 'whatsapp'; detail: string; action: Omit<LeadAction, 'id'> }): void;
  /** Appel : note obligatoire, puis action + fenêtre. */
  askCallNote(lead: Lead): void;
  /** Agenda, « Fait » : appel (puces), envoi (confirmation) ou compte rendu, puis action faite + fenêtre. `authorId` = qui l'a réalisée. */
  markDone(lead: Lead, planned: PlannedAction, authorId: string): void;
  /** Toast « Lead créé — Planifier » (acceptation depuis la boîte de réception). */
  toastPlanifier(leadId: string, message: string): void;
}

export const NextActionFlowContext = createContext<NextActionFlowApi | null>(null);

export function useNextActionFlow(): NextActionFlowApi {
  const ctx = useContext(NextActionFlowContext);
  if (!ctx) throw new Error('useNextActionFlow doit être appelé sous <NextActionFlowProvider>');
  return ctx;
}
