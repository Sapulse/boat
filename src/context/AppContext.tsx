import { useReducer, useEffect, type ReactNode } from 'react';
import type { Lead, LeadAction, LeadStatus, MonthlyStat, MessageTemplate, ActionType, CalendarEvent, CommercialGoal } from '../data/types';
import { saveState } from '../lib/storage';
import { generateId } from '../lib/utils';
import { reducer, getInitialState } from './appReducer';
import { AppContext } from './useApp';

// Ce fichier ne contient QUE le composant AppProvider (react-refresh).
// Le reducer + l'initialisation vivent dans appReducer.ts (module pur, teste
// par scripts/harness-reducer.ts) ; le contexte + useApp dans useApp.ts.

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

  const updateAction = (id: string, data: Partial<LeadAction>) => {
    dispatch({ type: 'UPDATE_ACTION', payload: { id, data } });
  };

  const deleteAction = (id: string) => {
    dispatch({ type: 'DELETE_ACTION', payload: id });
  };

  const setNextAction = (id: string, nextActionType: ActionType | '', nextActionDate: string, nextActionTime?: string, nextActionEndTime?: string) => {
    dispatch({ type: 'SET_NEXT_ACTION', payload: { id, nextActionType, nextActionDate, nextActionTime, nextActionEndTime } });
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

  const saveGoals = (goals: CommercialGoal[]) => {
    dispatch({ type: 'SAVE_GOALS', payload: goals });
  };

  const addTemplate = (template: Omit<MessageTemplate, 'id'>): string => {
    const id = generateId();
    dispatch({ type: 'ADD_TEMPLATE', payload: { ...template, id } });
    return id;
  };

  const updateTemplate = (id: string, data: Partial<MessageTemplate>) => {
    dispatch({ type: 'UPDATE_TEMPLATE', payload: { id, data } });
  };

  const deleteTemplate = (id: string) => {
    dispatch({ type: 'DELETE_TEMPLATE', payload: id });
  };

  const addCalendarEvent = (event: Omit<CalendarEvent, 'id'>): string => {
    const id = generateId();
    dispatch({ type: 'ADD_CALENDAR_EVENT', payload: { ...event, id } });
    return id;
  };

  const updateCalendarEvent = (id: string, data: Partial<CalendarEvent>) => {
    dispatch({ type: 'UPDATE_CALENDAR_EVENT', payload: { id, data } });
  };

  const deleteCalendarEvent = (id: string) => {
    dispatch({ type: 'DELETE_CALENDAR_EVENT', payload: id });
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
        updateAction,
        deleteAction,
        setNextAction,
        getLeadActions,
        getCommercialName,
        saveMonthlyStats,
        saveGoals,
        addTemplate,
        updateTemplate,
        deleteTemplate,
        addCalendarEvent,
        updateCalendarEvent,
        deleteCalendarEvent,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
