import { createContext, useContext } from 'react';
import type { AppState, Lead, LeadAction, LeadStatus, MonthlyStat, MessageTemplate, ActionType, CalendarEvent, CommercialGoal, DefaultGoal, Commercial } from '../data/types';

// Module sans composant : contexte + hook d'acces. Separe de AppContext.tsx
// (qui ne garde que le composant AppProvider) pour la regle
// react-refresh/only-export-components.
//
// Depuis le Lot 3 : la surface d'ecriture est celle de CrmRepository (la
// couche d'acces). Plus de `dispatch` brut expose (le contournement est ferme) ;
// les commerciaux passent par addCommercial/updateCommercial/toggleCommercial.

export interface AppContextType {
  state: AppState;
  addLead: (lead: Omit<Lead, 'id'>) => string;
  updateLead: (id: string, data: Partial<Lead>) => void;
  deleteLead: (id: string) => void;
  updateLeadStatus: (id: string, status: LeadStatus) => void;
  addAction: (action: Omit<LeadAction, 'id'>) => void;
  updateAction: (id: string, data: Partial<LeadAction>) => void;
  deleteAction: (id: string) => void;
  setNextAction: (id: string, nextActionType: ActionType | '', nextActionDate: string, nextActionTime?: string, nextActionEndTime?: string) => void;
  addCommercial: (commercial: Omit<Commercial, 'id'>) => string;
  updateCommercial: (id: string, data: Partial<Commercial>) => void;
  toggleCommercial: (id: string) => void;
  getLeadActions: (leadId: string) => LeadAction[];
  getCommercialName: (id: string) => string;
  saveMonthlyStats: (stats: MonthlyStat[]) => void;
  saveGoals: (goals: CommercialGoal[]) => void;
  saveDefaultGoal: (defaultGoal: DefaultGoal) => void;
  addTemplate: (template: Omit<MessageTemplate, 'id'>) => string;
  updateTemplate: (id: string, data: Partial<MessageTemplate>) => void;
  deleteTemplate: (id: string) => void;
  addCalendarEvent: (event: Omit<CalendarEvent, 'id'>) => string;
  updateCalendarEvent: (id: string, data: Partial<CalendarEvent>) => void;
  deleteCalendarEvent: (id: string) => void;
}

export const AppContext = createContext<AppContextType | null>(null);

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
