import type { Dispatch } from 'react';
import type {
  AppState, Lead, LeadAction, LeadStatus, MonthlyStat, MessageTemplate,
  ActionType, CalendarEvent, CommercialGoal, DefaultGoal, Commercial,
} from '../data/types';
import type { Action } from '../context/appReducer';
import { getInitialState as loadInitialState } from '../context/appReducer';
import { saveState } from './storage';
import { generateId } from './utils';
import { EMPTY_DEFAULT_GOAL } from '../data/constants';

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
  // Hydratation ASYNCHRONE optionnelle (impl API, Lot 5) : charge l'état depuis
  // le serveur. Absente pour l'impl localStorage (hydratation synchrone via
  // getInitialState). AppProvider l'appelle au montage si présente (loading gate).
  hydrate?(): Promise<AppState>;

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

// ===========================================================================
// Implémentation API (chantier migration, Lot 5) — bascule derrière feature flag
// ===========================================================================
//
// Modèle OPTIMISTE (décision D10) : les mutations dispatchent d'abord (cache
// reducer -> UI immédiate), IDENTIQUES à l'impl localStorage (on réutilise ses
// méthodes). La synchronisation serveur se fait par DIFF RÉACTIF dans `persist`
// (déjà appelé dans un useEffect([state])) : on compare l'état courant au dernier
// état confirmé serveur et on émet les appels par entité. Le diff voit l'état
// FINAL (post-reducer) -> il envoie les champs DÉRIVÉS sans recalcul (serveur
// mince préservé). Échec d'un appel -> onError + re-hydratation (GET /state ->
// SET_STATE) : le cache se réaligne sur la vérité serveur (pas d'annulation
// inverse). Appels sérialisés (file de promesses) pour préserver l'ordre (FK).

/** AppState « vide » : état de départ (mode API) avant l'hydratation serveur. */
export function getEmptyState(): AppState {
  return {
    leads: [], actions: [], commercials: [], monthlyStats: [],
    templates: [], calendarEvents: [], goals: [], defaultGoal: EMPTY_DEFAULT_GOAL,
  };
}

interface ApiCall { method: string; path: string; body?: unknown }

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// Diff d'une collection par id : POST (nouveau), PATCH (modifié), DELETE (retiré).
// `del: false` -> pas de suppression (commerciaux). `skipDel` -> ids à ne pas
// supprimer (actions cascadées côté serveur par la suppression de leur lead).
function diffEntities<T extends { id: string }>(prev: T[], next: T[], base: string, opt: { del?: boolean; skipDel?: Set<string> } = {}): ApiCall[] {
  const prevById = new Map(prev.map(e => [e.id, e]));
  const nextIds = new Set(next.map(e => e.id));
  const calls: ApiCall[] = [];
  for (const e of next) {
    const p = prevById.get(e.id);
    if (!p) calls.push({ method: 'POST', path: base, body: e });
    else if (!eq(p, e)) calls.push({ method: 'PATCH', path: `${base}/${e.id}`, body: e });
  }
  if (opt.del !== false) {
    for (const e of prev) {
      if (!nextIds.has(e.id) && !opt.skipDel?.has(e.id)) calls.push({ method: 'DELETE', path: `${base}/${e.id}` });
    }
  }
  return calls;
}

// Diff de l'état complet -> appels ordonnés (parents avant enfants pour les FK).
function diffState(prev: AppState, next: AppState): ApiCall[] {
  const removedLeadIds = new Set(prev.leads.filter(l => !next.leads.some(n => n.id === l.id)).map(l => l.id));
  const skipActionDel = new Set(prev.actions.filter(a => removedLeadIds.has(a.leadId)).map(a => a.id));
  const calls: ApiCall[] = [
    ...diffEntities(prev.commercials, next.commercials, '/commercials', { del: false }),
    ...diffEntities(prev.templates, next.templates, '/templates'),
    ...diffEntities(prev.calendarEvents, next.calendarEvents, '/calendar-events'),
    ...diffEntities(prev.leads, next.leads, '/leads'),
    ...diffEntities(prev.actions, next.actions, '/actions', { skipDel: skipActionDel }),
  ];
  if (!eq(prev.goals, next.goals)) calls.push({ method: 'PUT', path: '/goals', body: next.goals });
  if (!eq(prev.monthlyStats, next.monthlyStats)) calls.push({ method: 'PUT', path: '/monthly-stats', body: next.monthlyStats });
  if (!eq(prev.defaultGoal, next.defaultGoal)) calls.push({ method: 'PUT', path: '/default-goal', body: next.defaultGoal });
  return calls;
}

export interface ApiRepositoryOptions {
  dispatch: Dispatch<Action>;
  onError: (message: string) => void;
  baseUrl?: string;                 // défaut '/api' (même origine sur Vercel)
  token?: string;                   // ⚠️ exposé dans le bundle (staging only, cf. Lot 7)
  fetchImpl?: typeof fetch;         // injectable pour le harnais (défaut : fetch global)
}

/**
 * Implémentation API : mêmes mutations que localStorage (dispatch optimiste,
 * réutilisées via createLocalStorageRepository) ; `persist` = diff-sync sérialisé ;
 * `hydrate`/`getInitialState` = chargement serveur / état vide. Le reducer et
 * l'impl localStorage NE SONT PAS modifiés.
 */
export function createApiRepository(opts: ApiRepositoryOptions): CrmRepository {
  const { dispatch, onError, baseUrl = '/api', token, fetchImpl = fetch } = opts;
  const base = createLocalStorageRepository(dispatch); // mutations = dispatch optimiste
  let lastSynced = getEmptyState();                    // dernier état confirmé serveur
  let chain: Promise<void> = Promise.resolve();        // file d'appels sérialisés

  async function apiFetch(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await fetchImpl(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}`);
    return res;
  }

  // Re-hydratation après échec : la base serveur redevient la source de vérité.
  async function resync(): Promise<void> {
    const res = await apiFetch('GET', '/state');
    const state = await res.json() as AppState;
    lastSynced = state;
    dispatch({ type: 'SET_STATE', payload: state });
  }

  const persist = (state: AppState): void => {
    const calls = diffState(lastSynced, state);
    if (calls.length === 0) return;
    // Marque optimiste : le prochain diff part de `state`. En cas d'échec, resync
    // réaligne lastSynced ET le cache sur le serveur.
    lastSynced = state;
    chain = chain
      .then(async () => { for (const c of calls) await apiFetch(c.method, c.path, c.body); })
      .catch((err) => {
        onError(err instanceof Error ? err.message : 'Erreur de synchronisation');
        return resync().catch(() => { /* resync KO : onError a déjà notifié */ });
      });
  };

  const hydrate = async (): Promise<AppState> => {
    const res = await apiFetch('GET', '/state');
    const state = await res.json() as AppState;
    lastSynced = state; // le persist qui suit SET_STATE diffe serveur vs serveur = no-op
    return state;
  };

  return { ...base, getInitialState: getEmptyState, persist, hydrate };
}
