import { createContext, useContext } from 'react';
import type { InboundEmail, InboundExtracted } from '../data/types';

// Contexte + hook de la boîte de réception prospects (Étape A, maquette).
// Module sans composant (règle react-refresh/only-export-components) — le
// provider vit dans InboundDemoContext.tsx, même découpage que useApp/useToast.

export interface InboundDemoContextType {
  emails: InboundEmail[];
  /** Nombre d'emails « à traiter » — alimente le badge du menu. */
  pendingCount: number;
  /** true = fixtures RÉELLES (JSON local dérivé des .eml) ; false = fictives. */
  realData: boolean;
  /** Corrige un champ extrait avant acceptation (tél mal extrait, nom à compléter…). */
  updateExtracted(id: string, patch: Partial<InboundExtracted>): void;
  /** Marque accepté + mémorise le lead créé (la création du lead est faite par la page via addLead). */
  accept(id: string, leadId: string): void;
  reject(id: string): void;
}

export const InboundDemoContext = createContext<InboundDemoContextType | null>(null);

export function useInboundDemo(): InboundDemoContextType {
  const ctx = useContext(InboundDemoContext);
  if (!ctx) throw new Error('useInboundDemo must be used within InboundDemoProvider');
  return ctx;
}
