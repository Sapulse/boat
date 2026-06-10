import { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { AppState, Lead, LeadAction, LeadStatus, MonthlyStat, AcquisitionVolume, Commercial, EmailTemplate, EmailTemplateId, ActionType } from '../data/types';
import { DEFAULT_COMMERCIALS, DEFAULT_EMAIL_TEMPLATES } from '../data/constants';
import { loadState, saveState } from '../lib/storage';
import { generateId, statusMilestoneDates, toISODate } from '../lib/utils';
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
  | { type: 'UPDATE_ACTION'; payload: { id: string; data: Partial<LeadAction> } }
  | { type: 'DELETE_ACTION'; payload: string }
  | { type: 'SET_NEXT_ACTION'; payload: { id: string; nextActionType: ActionType | ''; nextActionDate: string } }
  | { type: 'SAVE_MONTHLY_STATS'; payload: MonthlyStat[] }
  | { type: 'SAVE_ACQUISITION_VOLUMES'; payload: AcquisitionVolume[] }
  | { type: 'ADD_COMMERCIAL'; payload: Commercial }
  | { type: 'UPDATE_COMMERCIAL'; payload: { id: string; data: Partial<Commercial> } }
  | { type: 'TOGGLE_COMMERCIAL'; payload: string }
  | { type: 'UPDATE_EMAIL_TEMPLATE'; payload: { id: EmailTemplateId; data: Partial<EmailTemplate> } };

// Exporte pour le harnais (scripts/harness-reducer.ts) : teste le vrai code de
// restauration / seed, pas une copie.
export function getInitialState(): AppState {
  const stored = loadState();
  // Restauration des qu'un state existe (meme avec 0 lead) : le seed ne doit se
  // declencher QUE sur un vrai premier lancement (cle absente ou JSON invalide).
  // Supprimer son dernier lead puis recharger ne doit JAMAIS re-seeder ni
  // ecraser commerciaux / templates / stats.
  if (stored) {
    // Hydratation champ par champ avec fallback : un state partiel (version
    // ancienne ou corrompu mais parsable) se charge sans crash ni re-seed.
    // emailTemplates : undefined OU tableau vide -> defauts, pour ne jamais
    // laisser l'utilisateur sans aucun modele. Les champs optionnels de
    // Commercial (email/signature) restent geres par fallback '' a la lecture.
    return {
      leads: stored.leads ?? [],
      actions: stored.actions ?? [],
      commercials: stored.commercials ?? DEFAULT_COMMERCIALS,
      monthlyStats: stored.monthlyStats ?? [],
      acquisitionVolumes: stored.acquisitionVolumes ?? [],
      emailTemplates: stored.emailTemplates?.length ? stored.emailTemplates : DEFAULT_EMAIL_TEMPLATES,
    };
  }

  const leads = generateSeedLeads(35);
  const actions = generateSeedActions(leads);
  return {
    leads,
    actions,
    commercials: DEFAULT_COMMERCIALS,
    monthlyStats: generateSeedMonthlyStats(),
    acquisitionVolumes: generateSeedAcquisitionVolumes(),
    emailTemplates: DEFAULT_EMAIL_TEMPLATES,
  };
}

// Exporte pour le harnais d'isolation des effets de bord (UPDATE/DELETE/SET_NEXT).
export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_STATE':
      return action.payload;

    case 'ADD_LEAD': {
      // Un lead cree directement dans un statut avance (ex. "Signe" en mode
      // complet) doit avoir ses jalons poses des la creation, sinon signedAt/
      // contactDate restent vides et une edition ulterieure les "repare" avec
      // une date fausse. Date de reference = createdAt (pas la date du jour).
      // Le helper preserve une contactDate deja saisie au formulaire.
      const lead = action.payload;
      const withMilestones = {
        ...lead,
        ...statusMilestoneDates(lead, lead.status, lead.createdAt),
      };
      return { ...state, leads: [withMilestones, ...state.leads] };
    }

    case 'UPDATE_LEAD':
      return {
        ...state,
        leads: state.leads.map(l => {
          if (l.id !== action.payload.id) return l;
          const merged = { ...l, ...action.payload.data };
          // Les dates de jalon restent pilotees par le helper (source de verite).
          // On se base sur `merged` : pour signedAt/lostAt/reportedAt (non
          // editables au formulaire) c'est identique a `l` (le form recopie ces
          // valeurs), ce qui preserve une date historique ; pour contactDate
          // (editable au formulaire) cela respecte une saisie manuelle de
          // l'utilisateur tout en l'auto-remplissant si elle est laissee vide.
          const dates = statusMilestoneDates(merged, merged.status, toISODate(new Date()));
          return { ...merged, ...dates };
        }),
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
          l.id === action.payload.id
            ? {
                ...l,
                status: action.payload.status,
                ...statusMilestoneDates(l, action.payload.status, toISODate(new Date())),
              }
            : l
        ),
      };

    case 'ADD_ACTION': {
      const act = action.payload;
      const updates: Partial<Lead> = {};
      if (act.newStatus) updates.status = act.newStatus;
      if (act.nextActionType) updates.nextActionType = act.nextActionType;
      if (act.nextActionDate) updates.nextActionDate = act.nextActionDate;

      return {
        ...state,
        actions: [act, ...state.actions],
        leads: state.leads.map(l => {
          if (l.id !== act.leadId) return l;
          // lastActionDate = activite la plus recente : une action antidatee
          // (rattrapage d'historique) ne doit pas faire reculer la derniere
          // activite, sinon le lead bascule en fausse urgence. Comparaison de
          // chaines ISO (YYYY-MM-DD) ; '' perd toujours.
          const lastActionDate =
            act.date > (l.lastActionDate || '') ? act.date : l.lastActionDate;
          // Si l'action change le statut, on aligne les dates de jalon via le
          // helper en utilisant la date de l'action (date semantique de la
          // signature / perte / report / contact).
          const dates = act.newStatus
            ? statusMilestoneDates(l, act.newStatus, act.date)
            : null;
          return { ...l, ...updates, lastActionDate, ...dates };
        }),
      };
    }

    // Edition d'une action : confine au tableau `actions`. AUCUN effet de bord
    // sur le lead (pas de statusMilestoneDates, pas de recalcul lastActionDate /
    // nextAction / statut) -> state.leads est retourne inchange (meme reference).
    case 'UPDATE_ACTION':
      return {
        ...state,
        actions: state.actions.map(a =>
          a.id === action.payload.id ? { ...a, ...action.payload.data } : a
        ),
      };

    // Suppression d'une action : retire la ligne d'historique uniquement. Pas de
    // rollback du statut/des dates du lead (comportement voulu). state.leads inchange.
    case 'DELETE_ACTION':
      return {
        ...state,
        actions: state.actions.filter(a => a.id !== action.payload),
      };

    // Definition/modification/effacement de la prochaine action : touche
    // UNIQUEMENT nextActionType / nextActionDate du lead cible (pas de jalons).
    case 'SET_NEXT_ACTION':
      return {
        ...state,
        leads: state.leads.map(l =>
          l.id === action.payload.id
            ? { ...l, nextActionType: action.payload.nextActionType, nextActionDate: action.payload.nextActionDate }
            : l
        ),
      };

    case 'SAVE_MONTHLY_STATS':
      return { ...state, monthlyStats: action.payload };

    case 'SAVE_ACQUISITION_VOLUMES':
      return { ...state, acquisitionVolumes: action.payload };

    case 'ADD_COMMERCIAL':
      return { ...state, commercials: [...state.commercials, action.payload] };

    case 'UPDATE_COMMERCIAL':
      return {
        ...state,
        commercials: state.commercials.map(c =>
          c.id === action.payload.id ? { ...c, ...action.payload.data } : c
        ),
      };

    case 'TOGGLE_COMMERCIAL':
      return {
        ...state,
        commercials: state.commercials.map(c =>
          c.id === action.payload ? { ...c, active: !c.active } : c
        ),
      };

    case 'UPDATE_EMAIL_TEMPLATE':
      return {
        ...state,
        emailTemplates: state.emailTemplates.map(t =>
          t.id === action.payload.id ? { ...t, ...action.payload.data } : t
        ),
      };

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
  updateAction: (id: string, data: Partial<LeadAction>) => void;
  deleteAction: (id: string) => void;
  setNextAction: (id: string, nextActionType: ActionType | '', nextActionDate: string) => void;
  getLeadActions: (leadId: string) => LeadAction[];
  getCommercialName: (id: string) => string;
  saveMonthlyStats: (stats: MonthlyStat[]) => void;
  saveAcquisitionVolumes: (volumes: AcquisitionVolume[]) => void;
  updateEmailTemplate: (id: EmailTemplateId, data: Partial<EmailTemplate>) => void;
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

  const updateAction = (id: string, data: Partial<LeadAction>) => {
    dispatch({ type: 'UPDATE_ACTION', payload: { id, data } });
  };

  const deleteAction = (id: string) => {
    dispatch({ type: 'DELETE_ACTION', payload: id });
  };

  const setNextAction = (id: string, nextActionType: ActionType | '', nextActionDate: string) => {
    dispatch({ type: 'SET_NEXT_ACTION', payload: { id, nextActionType, nextActionDate } });
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

  const updateEmailTemplate = (id: EmailTemplateId, data: Partial<EmailTemplate>) => {
    dispatch({ type: 'UPDATE_EMAIL_TEMPLATE', payload: { id, data } });
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
        saveAcquisitionVolumes,
        updateEmailTemplate,
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
