import type { AppState, Lead, LeadAction, LeadStatus, MonthlyStat, AcquisitionVolume, Commercial, MessageTemplate, ActionType, CalendarEvent } from '../data/types';
import { DEFAULT_COMMERCIALS, DEFAULT_TEMPLATES } from '../data/constants';
import { loadState } from '../lib/storage';
import { statusMilestoneDates, toISODate } from '../lib/utils';
import { mergeAcquisition } from '../lib/acquisition';

// Module PUR (sans composant ni JSX) : initialisation du state + reducer.
// Separe de AppContext.tsx pour la regle react-refresh/only-export-components
// et pour le harnais (scripts/harness-reducer.ts) qui teste le vrai code.

export type Action =
  | { type: 'SET_STATE'; payload: AppState }
  | { type: 'ADD_LEAD'; payload: Lead }
  | { type: 'UPDATE_LEAD'; payload: { id: string; data: Partial<Lead> } }
  | { type: 'DELETE_LEAD'; payload: string }
  | { type: 'UPDATE_LEAD_STATUS'; payload: { id: string; status: LeadStatus } }
  | { type: 'ADD_ACTION'; payload: LeadAction }
  | { type: 'UPDATE_ACTION'; payload: { id: string; data: Partial<LeadAction> } }
  | { type: 'DELETE_ACTION'; payload: string }
  | { type: 'SET_NEXT_ACTION'; payload: { id: string; nextActionType: ActionType | ''; nextActionDate: string; nextActionTime?: string; nextActionEndTime?: string } }
  | { type: 'SAVE_MONTHLY_STATS'; payload: MonthlyStat[] }
  | { type: 'SAVE_ACQUISITION_VOLUMES'; payload: AcquisitionVolume[] }
  | { type: 'ADD_COMMERCIAL'; payload: Commercial }
  | { type: 'UPDATE_COMMERCIAL'; payload: { id: string; data: Partial<Commercial> } }
  | { type: 'TOGGLE_COMMERCIAL'; payload: string }
  | { type: 'ADD_TEMPLATE'; payload: MessageTemplate }
  | { type: 'UPDATE_TEMPLATE'; payload: { id: string; data: Partial<MessageTemplate> } }
  | { type: 'DELETE_TEMPLATE'; payload: string }
  | { type: 'ADD_CALENDAR_EVENT'; payload: CalendarEvent }
  | { type: 'UPDATE_CALENDAR_EVENT'; payload: { id: string; data: Partial<CalendarEvent> } }
  | { type: 'DELETE_CALENDAR_EVENT'; payload: string };

/**
 * Migration templates : double lecture (champ `templates` actuel, OU champ
 * legacy `emailTemplates` d'avant v3.2) + normalisation par item — les modeles
 * stockes avant l'introduction du type n'ont pas de champ `type` : ils
 * deviennent type 'email', ids et contenu STRICTEMENT intacts (aucune perte).
 * Liste vide ou absente -> defauts (ne jamais laisser l'utilisateur sans
 * modele ; le garde-fou min-1 de DELETE_TEMPLATE rend cet etat inatteignable
 * depuis l'UI).
 */
function hydrateTemplates(stored: AppState): MessageTemplate[] {
  const legacy = stored as AppState & { emailTemplates?: MessageTemplate[] };
  const raw = legacy.templates ?? legacy.emailTemplates;
  if (!raw?.length) return DEFAULT_TEMPLATES;
  // Normalisation du type : 'sms' et 'whatsapp' preserves tels quels ; tout
  // autre cas (legacy sans type, ou valeur inconnue) retombe sur 'email' — le
  // defaut historique sur, jamais une perte de modele.
  return raw.map(t => ({ ...t, type: t.type === 'sms' ? 'sms' : t.type === 'whatsapp' ? 'whatsapp' : 'email' }));
}

export function getInitialState(): AppState {
  const stored = loadState();
  // Restauration des qu'un state existe (meme avec 0 lead) : la base ne demarre
  // VIERGE que sur un vrai premier lancement (cle absente ou JSON invalide).
  // Supprimer son dernier lead puis recharger ne doit JAMAIS reintroduire de
  // donnees ni ecraser commerciaux / templates / stats (protection N1, v3.1.1).
  if (stored) {
    // Hydratation champ par champ avec fallback : un state partiel (version
    // ancienne ou corrompu mais parsable) se charge sans crash ni re-seed.
    // Les champs optionnels de Commercial (email/signature) restent geres par
    // fallback '' a la lecture.
    return {
      leads: stored.leads ?? [],
      actions: stored.actions ?? [],
      commercials: stored.commercials ?? DEFAULT_COMMERCIALS,
      // Migration refonte-acquisition (etape 1) : UNE seule source de verite.
      // Les anciens acquisitionVolumes sont replies dans monthlyStats (sans perte,
      // idempotent : cf. mergeAcquisition) puis le tableau legacy est vide. Re-
      // hydrater un state deja migre laisse monthlyStats inchange (volumes = []).
      monthlyStats: mergeAcquisition(stored.monthlyStats ?? [], stored.acquisitionVolumes ?? []),
      acquisitionVolumes: [],
      templates: hydrateTemplates(stored),
      // Migration v3.13 : tableau absent des anciens states -> [] (aucune perte).
      calendarEvents: stored.calendarEvents ?? [],
    };
  }

  // Premier lancement reel (cle absente ou JSON invalide) : base VIERGE pour le
  // deploiement client. Equipe et modeles par defaut conserves ; l'import Excel
  // (ou le seed de demo, fonctions gardees dans data/seed.ts mais plus appelees)
  // remplira la base.
  return {
    leads: [],
    actions: [],
    commercials: DEFAULT_COMMERCIALS,
    monthlyStats: [],
    acquisitionVolumes: [],
    templates: DEFAULT_TEMPLATES,
    calendarEvents: [],
  };
}

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
            ? { ...l, nextActionType: action.payload.nextActionType, nextActionDate: action.payload.nextActionDate, nextActionTime: action.payload.nextActionTime || undefined, nextActionEndTime: action.payload.nextActionEndTime || undefined }
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

    case 'ADD_TEMPLATE':
      return { ...state, templates: [...state.templates, action.payload] };

    case 'UPDATE_TEMPLATE':
      return {
        ...state,
        templates: state.templates.map(t =>
          t.id === action.payload.id ? { ...t, ...action.payload.data } : t
        ),
      };

    // Garde-fou min-1 : on ne supprime JAMAIS le dernier modele. Sinon
    // l'hydratation (liste vide -> defauts) ressusciterait les 3 modeles par
    // defaut au rechargement — comportement surprise. Double protection avec
    // l'UI (bouton supprimer desactive sur le dernier).
    case 'DELETE_TEMPLATE':
      if (state.templates.length <= 1) return state;
      return {
        ...state,
        templates: state.templates.filter(t => t.id !== action.payload),
      };

    // Evenements d'agenda libres : actions confinees a state.calendarEvents,
    // AUCUN effet de bord sur leads / actions / templates (entite isolee).
    // Contrairement aux leads, un evenement peut etre SUPPRIME librement.
    case 'ADD_CALENDAR_EVENT':
      return { ...state, calendarEvents: [...state.calendarEvents, action.payload] };

    case 'UPDATE_CALENDAR_EVENT':
      return {
        ...state,
        calendarEvents: state.calendarEvents.map(e =>
          e.id === action.payload.id ? { ...e, ...action.payload.data } : e
        ),
      };

    case 'DELETE_CALENDAR_EVENT':
      return {
        ...state,
        calendarEvents: state.calendarEvents.filter(e => e.id !== action.payload),
      };

    default:
      return state;
  }
}
