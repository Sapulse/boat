import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { AppState, Lead, LeadAction, LeadStatus, MonthlyStat, AcquisitionVolume } from '../data/types';
import { DEFAULT_COMMERCIALS } from '../data/constants';
import { loadState, saveState } from '../lib/storage';
import { generateId } from '../lib/utils';
import {
  generateSeedLeads,
  generateSeedActions,
  generateSeedMonthlyStats,
  generateSeedAcquisitionVolumes,
} from '../data/seed';

type Action =
  | { type: 'SET_STATE'; payload: AppState }
  | { type: 'ADD_LEAD'; payload: Lead }
  | { type: 'UPDATE_LEAD'; payload: { id: string; data: Partial<Lead> } }
  | { type: 'DELETE_LEAD'; payload: string }
  | { type: 'UPDATE_LEAD_STATUS'; payload: { id: string; status: LeadStatus } }
  | { type: 'ADD_ACTION'; payload: LeadAction }
  | { type: 'SAVE_MONTHLY_STATS'; payload: MonthlyStat[] }
  | { type: 'SAVE_ACQUISITION_VOLUMES'; payload: AcquisitionVolume[] };

function getInitialState(): AppState {
  const stored = loadState();
  if (stored && stored.leads && stored.leads.length > 0) return stored;

  const leads = generateSeedLeads(35);
  const actions = generateSeedActions(leads);
  return {
    leads,
    actions,
    commercials: DEFAULT_COMMERCIALS,
    monthlyStats: generateSeedMonthlyStats(),
    acquisitionVolumes: generateSeedAcquisitionVolumes(),
  };
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_STATE':
      return action.payload;

    case 'ADD_LEAD':
      return { ...state, leads: [action.payload, ...state.leads] };

    case 'UPDATE_LEAD':
      return {
        ...state,
        leads: state.leads.map(l =>
          l.id === action.payload.id ? { ...l, ...action.payload.data } : l
        ),
      };

    case 'DELETE_LEAD':
      return {
        ...state,
        leads: state.leads.filter(l => l.id !== action.payload),
        actions: state.actions.filter(a => a.leadId !== action.payload),
      };

    case 'UPDATE_LEAD_STATUS':
      return {
        ...state,
        leads: state.leads.map(l =>
          l.id === action.payload.id ? { ...l, status: action.payload.status } : l
        ),
      };

    case 'ADD_ACTION': {
      const act = action.payload;
      const updates: Partial<Lead> = {
        lastActionDate: act.date,
      };
      if (act.newStatus) updates.status = act.newStatus;
      if (act.nextActionType) updates.nextActionType = act.nextActionType;
      if (act.nextActionDate) updates.nextActionDate = act.nextActionDate;

      return {
        ...state,
        actions: [act, ...state.actions],
        leads: state.leads.map(l =>
          l.id === act.leadId ? { ...l, ...updates } : l
        ),
      };
    }

    case 'SAVE_MONTHLY_STATS':
      return { ...state, monthlyStats: action.payload };

    case 'SAVE_ACQUISITION_VOLUMES':
      return { ...state, acquisitionVolumes: action.payload };

    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  addLead: (lead: Omit<Lead, 'id'>) => string;
  updateLead: (id: string, data: Partial<Lead>) => void;
  deleteLead: (id: string) => void;
  updateLeadStatus: (id: string, status: LeadStatus) => void;
  addAction: (action: Omit<LeadAction, 'id'>) => void;
  getLeadActions: (leadId: string) => LeadAction[];
  getCommercialName: (id: string) => string;
  saveMonthlyStats: (stats: MonthlyStat[]) => void;
  saveAcquisitionVolumes: (volumes: AcquisitionVolume[]) => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, getInitialState);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const addLead = (lead: Omit<Lead, 'id'>): string => {
    const id = generateId();
    dispatch({ type: 'ADD_LEAD', payload: { ...lead, id } as Lead });
    return id;
  };

  const updateLead = (id: string, data: Partial<Lead>) => {
    dispatch({ type: 'UPDATE_LEAD', payload: { id, data } });
  };

  const deleteLead = (id: string) => {
    dispatch({ type: 'DELETE_LEAD', payload: id });
  };

  const updateLeadStatus = (id: string, status: LeadStatus) => {
    dispatch({ type: 'UPDATE_LEAD_STATUS', payload: { id, status } });
  };

  const addAction = (action: Omit<LeadAction, 'id'>) => {
    dispatch({ type: 'ADD_ACTION', payload: { ...action, id: generateId() } });
  };

  const getLeadActions = (leadId: string): LeadAction[] => {
    return state.actions
      .filter(a => a.leadId === leadId)
      .sort((a, b) => b.date.localeCompare(a.date));
  };

  const getCommercialName = (id: string): string => {
    return state.commercials.find(c => c.id === id)?.name ?? id;
  };

  const saveMonthlyStats = (stats: MonthlyStat[]) => {
    dispatch({ type: 'SAVE_MONTHLY_STATS', payload: stats });
  };

  const saveAcquisitionVolumes = (volumes: AcquisitionVolume[]) => {
    dispatch({ type: 'SAVE_ACQUISITION_VOLUMES', payload: volumes });
  };

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
        addLead,
        updateLead,
        deleteLead,
        updateLeadStatus,
        addAction,
        getLeadActions,
        getCommercialName,
        saveMonthlyStats,
        saveAcquisitionVolumes,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
