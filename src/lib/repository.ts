import type { Dispatch } from 'react';
import type {
  AppState, Lead, LeadAction, LeadStatus, MonthlyStat, MessageTemplate,
  ActionType, CalendarEvent, CommercialGoal, DefaultGoal, Commercial,
} from '../data/types';
import type { Action } from '../context/appReducer';
import { getInitialState as loadInitialState } from '../context/appReducer';
import { saveState } from './storage';
import { generateId } from './utils';

// Couche d'accès aux données (chantier migration, Lot 3) — LA COUTURE.
//
// Interface unique entre l'app et le stockage. Aujourd'hui une seule
// implémentation (localStorage, ci-dessous) adossée au reducer + saveState
// EXISTANTS : REFACTOR ISO-COMPORTEMENT, rien ne change côté métier. Au Lot 5,
// une 2e implémentation "API/base" satisfera le MÊME contrat (les mutations
// dispatcheront pour le cache optimiste ET appelleront le serveur ;
// getInitialState chargera depuis le backend ; persist deviendra sans objet).
//
// Invariants préservés (cf. docs/migration/02-plan-migration.md, Lot 3) :
//  - Le REDUCER reste la source des effets dérivés (jalons de dates, cascade
//    DELETE_LEAD, garde-fou min-1 templates, lastActionDate non-régressif) : ce
//    module ne fait que DISPATCHER, il ne réplique aucune de ces logiques.
//  - La PERSISTANCE reste un effet réactif sur le state entier (persist appelé
//    dans un useEffect([state]) côté AppProvider), pas par mutation.
//  - La génération d'ID reste CÔTÉ CLIENT (generateId), inchangée.
/**
 * Bootstrap d'hydratation (couture stockage), INDÉPENDANT de `dispatch` : sert
 * l'initialisation paresseuse de useReducer, qui a lieu AVANT que `dispatch`
 * n'existe. Même source que l'impl localStorage ci-dessous. Au Lot 5, l'init
 * asynchrone (fetch backend) sera gérée à part (état de chargement).
 */
export function getInitialCrmState(): AppState {
  return loadInitialState();
}

export interface CrmRepository {
  // — Hydratation & persistance (couture stockage) —
  getInitialState(): AppState;
  persist(state: AppState): void;

  // — Leads —
  addLead(lead: Omit<Lead, 'id'>): string;
  updateLead(id: string, data: Partial<Lead>): void;
  deleteLead(id: string): void;
  updateLeadStatus(id: string, status: LeadStatus): void;

  // — Actions —
  addAction(action: Omit<LeadAction, 'id'>): void;
  updateAction(id: string, data: Partial<LeadAction>): void;
  deleteAction(id: string): void;
  setNextAction(id: string, nextActionType: ActionType | '', nextActionDate: string, nextActionTime?: string, nextActionEndTime?: string): void;

  // — Commerciaux (entrent dans la surface ; étaient en dispatch brut) —
  addCommercial(commercial: Omit<Commercial, 'id'>): string;
  updateCommercial(id: string, data: Partial<Commercial>): void;
  toggleCommercial(id: string): void;

  // — Modèles de message —
  addTemplate(template: Omit<MessageTemplate, 'id'>): string;
  updateTemplate(id: string, data: Partial<MessageTemplate>): void;
  deleteTemplate(id: string): void;

  // — Événements d'agenda libres —
  addCalendarEvent(event: Omit<CalendarEvent, 'id'>): string;
  updateCalendarEvent(id: string, data: Partial<CalendarEvent>): void;
  deleteCalendarEvent(id: string): void;

  // — Enregistrements par lot —
  saveMonthlyStats(stats: MonthlyStat[]): void;
  saveGoals(goals: CommercialGoal[]): void;
  saveDefaultGoal(defaultGoal: DefaultGoal): void;
}

/**
 * Implémentation localStorage = comportement ACTUEL à l'identique. Les mutations
 * dispatchent EXACTEMENT les mêmes actions qu'avant (mêmes payloads), la
 * génération d'ID et la logique dérivée restent inchangées (reducer). `dispatch`
 * est fourni par AppProvider (issu de useReducer).
 */
export function createLocalStorageRepository(dispatch: Dispatch<Action>): CrmRepository {
  return {
    getInitialState: loadInitialState,
    persist: saveState,

    addLead: (lead) => {
      const id = generateId();
      dispatch({ type: 'ADD_LEAD', payload: { ...lead, id } as Lead });
      return id;
    },
    updateLead: (id, data) => dispatch({ type: 'UPDATE_LEAD', payload: { id, data } }),
    deleteLead: (id) => dispatch({ type: 'DELETE_LEAD', payload: id }),
    updateLeadStatus: (id, status) => dispatch({ type: 'UPDATE_LEAD_STATUS', payload: { id, status } }),

    addAction: (action) => dispatch({ type: 'ADD_ACTION', payload: { ...action, id: generateId() } }),
    updateAction: (id, data) => dispatch({ type: 'UPDATE_ACTION', payload: { id, data } }),
    deleteAction: (id) => dispatch({ type: 'DELETE_ACTION', payload: id }),
    setNextAction: (id, nextActionType, nextActionDate, nextActionTime, nextActionEndTime) =>
      dispatch({ type: 'SET_NEXT_ACTION', payload: { id, nextActionType, nextActionDate, nextActionTime, nextActionEndTime } }),

    addCommercial: (commercial) => {
      const id = generateId();
      dispatch({ type: 'ADD_COMMERCIAL', payload: { ...commercial, id } });
      return id;
    },
    updateCommercial: (id, data) => dispatch({ type: 'UPDATE_COMMERCIAL', payload: { id, data } }),
    toggleCommercial: (id) => dispatch({ type: 'TOGGLE_COMMERCIAL', payload: id }),

    addTemplate: (template) => {
      const id = generateId();
      dispatch({ type: 'ADD_TEMPLATE', payload: { ...template, id } });
      return id;
    },
    updateTemplate: (id, data) => dispatch({ type: 'UPDATE_TEMPLATE', payload: { id, data } }),
    deleteTemplate: (id) => dispatch({ type: 'DELETE_TEMPLATE', payload: id }),

    addCalendarEvent: (event) => {
      const id = generateId();
      dispatch({ type: 'ADD_CALENDAR_EVENT', payload: { ...event, id } });
      return id;
    },
    updateCalendarEvent: (id, data) => dispatch({ type: 'UPDATE_CALENDAR_EVENT', payload: { id, data } }),
    deleteCalendarEvent: (id) => dispatch({ type: 'DELETE_CALENDAR_EVENT', payload: id }),

    saveMonthlyStats: (stats) => dispatch({ type: 'SAVE_MONTHLY_STATS', payload: stats }),
    saveGoals: (goals) => dispatch({ type: 'SAVE_GOALS', payload: goals }),
    saveDefaultGoal: (defaultGoal) => dispatch({ type: 'SAVE_DEFAULT_GOAL', payload: defaultGoal }),
  };
}
