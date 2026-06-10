import { createContext, useContext } from 'react';
import type { AppState, Lead, LeadAction, LeadStatus, MonthlyStat, AcquisitionVolume, EmailTemplate, EmailTemplateId, ActionType } from '../data/types';
import type { Action } from './appReducer';

// Module sans composant : contexte + hook d'acces. Separe de AppContext.tsx
// (qui ne garde que le composant AppProvider) pour la regle
// react-refresh/only-export-components.

export interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  addLead: (lead: Omit<Lead, 'id'>) => string;
  updateLead: (id: string, data: Partial<Lead>) => void;
  deleteLead: (id: string) => void;
  updateLeadStatus: (id: string, status: LeadStatus) => void;
  addAction: (action: Omit<LeadAction, 'id'>) => void;
  updateAction: (id: string, data: Partial<LeadAction>) => void;
  deleteAction: (id: string) => void;
  setNextAction: (id: string, nextActionType: ActionType | '', nextActionDate: string) => void;
  getLeadActions: (leadId: string) => LeadAction[];
  getCommercialName: (id: string) => string;
  saveMonthlyStats: (stats: MonthlyStat[]) => void;
  saveAcquisitionVolumes: (volumes: AcquisitionVolume[]) => void;
  updateEmailTemplate: (id: EmailTemplateId, data: Partial<EmailTemplate>) => void;
}

export const AppContext = createContext<AppContextType | null>(null);

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
