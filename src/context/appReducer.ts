import type { AppState, Lead, LeadAction, LeadStatus, MonthlyStat, Commercial, MessageTemplate, ActionType, CalendarEvent, CommercialGoal, GoalMetric, DefaultGoal, TemplateCategory, SocialStat, Campagne, CampagneLead } from '../data/types';
import type { TemplatePlacement } from '../lib/templateLayout';
import { applyObjectivePatch, carryOverObjective, newObjective, validateObjective, type ObjectivePatch } from '../lib/weeklyObjectives';
import { defaultSocialNetworks, mergeStats, newNetwork, statErrors, validateNetworkName } from '../lib/social';
import { DEFAULT_COMMERCIALS, DEFAULT_TEMPLATES, EMPTY_DEFAULT_GOAL } from '../data/constants';
import { loadState } from '../lib/storage';
import { statusMilestoneDates, toISODate } from '../lib/utils';
import { mergeAcquisition, type LegacyAcquisitionVolume } from '../lib/acquisition';
import {
  planNextAction, reschedulePlannedAction, completePlannedAction, cancelPendingAction,
  withNextActionSummary, pendingActionOf, defaultPeople, migrateLegacyNextActions,
  buildNoNextActionEntry, isRealizedAction, type PlanInput,
} from '../lib/plannedActions';

/** Ids fournis par le repository pour une programmation (action programmée + trace de report). */
export interface PlanIds { plannedId: string; reportEntryId: string }

// Module PUR (sans composant ni JSX) : initialisation du state + reducer.
// Separe de AppContext.tsx pour la regle react-refresh/only-export-components
// et pour le harnais (scripts/harness-reducer.ts) qui teste le vrai code.

export type Action =
  | { type: 'SET_STATE'; payload: AppState }
  | { type: 'ADD_LEAD'; payload: Lead }
  | { type: 'UPDATE_LEAD'; payload: { id: string; data: Partial<Lead> } }
  | { type: 'DELETE_LEAD'; payload: string }
  // quoteAmount / lossReason optionnels (B1/B2) : la confirmation de signature
  // (montant) ou de perte (motif) écrit la donnée DANS la même dispatch que la
  // bascule -> atomique (une seule op outbox, pas d'état intermédiaire "signé
  // sans montant" / "perdu sans motif").
  | { type: 'UPDATE_LEAD_STATUS'; payload: { id: string; status: LeadStatus; quoteAmount?: number; lossReason?: string } }
  // `plan` (lot 2) : ids générés par le repository pour l'action programmée et
  // l'éventuelle trace de report. Absent (harnais, anciens appels) -> ids
  // déterministes dérivés du state (voir planIdsOrFallback).
  | { type: 'ADD_ACTION'; payload: LeadAction; plan?: PlanIds }
  | { type: 'UPDATE_ACTION'; payload: { id: string; data: Partial<LeadAction> } }
  | { type: 'DELETE_ACTION'; payload: string }
  | { type: 'SET_NEXT_ACTION'; payload: { id: string; nextActionType: ActionType | ''; nextActionDate: string; nextActionTime?: string; nextActionEndTime?: string }; plan?: PlanIds }
  // --- Lot 2 : actions programmées ---
  | { type: 'PLAN_NEXT_ACTION'; payload: { leadId: string; input: PlanInput; authorId: string; today: string; ids: PlanIds } }
  | { type: 'RESCHEDULE_PLANNED_ACTION'; payload: { plannedId: string; date: string; time?: string; endTime?: string; authorId: string; today: string; reportEntryId: string } }
  | { type: 'COMPLETE_PLANNED_ACTION'; payload: { plannedId: string; action: LeadAction; doneAt: string } }
  | { type: 'SET_NO_NEXT_ACTION'; payload: { leadId: string; reason: string; authorId: string; today: string; at: string; entryId: string } }
  | { type: 'SAVE_MONTHLY_STATS'; payload: MonthlyStat[] }
  | { type: 'ADD_COMMERCIAL'; payload: Commercial }
  | { type: 'UPDATE_COMMERCIAL'; payload: { id: string; data: Partial<Commercial> } }
  | { type: 'TOGGLE_COMMERCIAL'; payload: string }
  | { type: 'ADD_TEMPLATE'; payload: MessageTemplate }
  | { type: 'UPDATE_TEMPLATE'; payload: { id: string; data: Partial<MessageTemplate> } }
  | { type: 'DELETE_TEMPLATE'; payload: string }
  // Lot 3 : liste COMPLÈTE des catégories + placements (catégorie, rang) des modèles concernés.
  | { type: 'SAVE_TEMPLATE_LAYOUT'; payload: { categories: TemplateCategory[]; placements: TemplatePlacement[] } }
  // Lot 4 : objectifs de la semaine (jamais de suppression). Dates passées en
  // charge utile : le reducer reste pur et rejouable au harnais.
  | { type: 'ADD_WEEKLY_OBJECTIVE'; payload: { id: string; weekStart: string; text: string; ownerId: string | null; todayISO: string; nowISO: string } }
  | { type: 'UPDATE_WEEKLY_OBJECTIVE'; payload: { id: string; patch: ObjectivePatch; todayISO: string; nowISO: string } }
  | { type: 'CARRY_OVER_WEEKLY_OBJECTIVE'; payload: { id: string; newId: string; todayISO: string; nowISO: string } }
  // Lot 5 : réseaux sociaux (jamais de suppression : archivage ; un mois se corrige).
  | { type: 'ADD_SOCIAL_NETWORK'; payload: { id: string; name: string } }
  | { type: 'RENAME_SOCIAL_NETWORK'; payload: { id: string; name: string } }
  | { type: 'SET_SOCIAL_NETWORK_ARCHIVED'; payload: { id: string; archived: boolean } }
  | { type: 'SAVE_SOCIAL_STATS'; payload: SocialStat[] }
  // Lot salons. AJOUT EN MASSE : les participations sont préparées par
  // lib/campagnes.preparerAjout (déjà dédoublonnées) ; le reducer refuse malgré
  // tout un lead déjà participant — l'index unique en base dit la même chose.
  | { type: 'ADD_CAMPAGNE_LEADS'; payload: CampagneLead[] }
  | { type: 'UPDATE_CAMPAGNE_LEAD'; payload: { id: string; data: Partial<CampagneLead> } }
  | { type: 'UPSERT_CAMPAGNE'; payload: Campagne }
  | { type: 'ADD_CALENDAR_EVENT'; payload: CalendarEvent }
  | { type: 'UPDATE_CALENDAR_EVENT'; payload: { id: string; data: Partial<CalendarEvent> } }
  | { type: 'DELETE_CALENDAR_EVENT'; payload: string }
  | { type: 'SAVE_GOALS'; payload: CommercialGoal[] }
  | { type: 'SAVE_DEFAULT_GOAL'; payload: DefaultGoal };

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

// Forme historique d'un goal (avant le lot objectifs-prospection) : pouvait
// porter `calls` et NE PAS porter `prospectsCreated` / `coldCalls`.
type StoredGoal = {
  id: string;
  commercialId: string;
  year: number;
  month: number;
  prospectsCreated?: GoalMetric;
  coldCalls?: GoalMetric;
  followups?: GoalMetric;
  meetings?: GoalMetric;
  revenue?: GoalMetric;
  conversionRate?: GoalMetric;
  calls?: GoalMetric; // legacy (objectif d'appels seuls) -> abandonne proprement
};

/**
 * Migration objectifs-prospection : on retire l'ancien metric `calls` (les appels
 * rejoignent `followups`) et on garantit les nouveaux metrics `prospectsCreated`
 * et `coldCalls`. Les anciennes cibles `calls` ne sont PAS reportees (les sommer
 * dans followups serait faux) ; les autres metrics restent intacts. Sans perte
 * sur ce qui est conserve, STORAGE_KEY intouchee.
 */
function hydrateGoals(stored: AppState): CommercialGoal[] {
  const empty = (): GoalMetric => ({ target: null, override: null });
  const raw = (stored.goals ?? []) as unknown as StoredGoal[];
  return raw.map((g) => ({
    id: g.id,
    commercialId: g.commercialId,
    year: g.year,
    month: g.month,
    prospectsCreated: g.prospectsCreated ?? empty(),
    coldCalls: g.coldCalls ?? empty(),
    followups: g.followups ?? empty(),
    meetings: g.meetings ?? empty(),
    revenue: g.revenue ?? empty(),
    conversionRate: g.conversionRate ?? empty(),
  }));
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
      // Migration refonte-acquisition : UNE seule source de verite. Les anciens
      // `acquisitionVolumes` (champ retire du modele) sont lus en legacy puis
      // replies dans monthlyStats (sans perte, idempotent : cf. mergeAcquisition).
      // Re-hydrater un state deja migre laisse monthlyStats inchange (volumes = []).
      monthlyStats: mergeAcquisition(
        stored.monthlyStats ?? [],
        (stored as AppState & { acquisitionVolumes?: LegacyAcquisitionVolume[] }).acquisitionVolumes ?? [],
      ),
      templates: hydrateTemplates(stored),
      // Migration v3.13 : tableau absent des anciens states -> [] (aucune perte).
      calendarEvents: stored.calendarEvents ?? [],
      // Migration objectifs : tableau absent -> [] ; sinon normalise (retrait
      // `calls`, ajout prospectsCreated/coldCalls) via hydrateGoals.
      goals: hydrateGoals(stored),
      // Migration objectifs par défaut : absent -> EMPTY_DEFAULT_GOAL (nulle).
      defaultGoal: stored.defaultGoal ?? EMPTY_DEFAULT_GOAL,
      // Lot 2 : actions programmées absentes des anciens states -> [] puis REPRISE
      // des prochaines actions déjà saisies sur les leads (idempotent : ids
      // déterministes, un lead déjà repris n'est jamais repris deux fois).
      plannedActions: hydratePlannedActions(stored),
      // Lot 3 : absent des anciens states -> aucune catégorie (tout « Non classés »).
      templateCategories: stored.templateCategories ?? [],
      // Lot 4 : absent des anciens states -> aucun objectif de la semaine.
      weeklyObjectives: stored.weeklyObjectives ?? [],
      // Lot 5 : absent des anciens states -> 3 réseaux par défaut, aucune stat.
      socialNetworks: stored.socialNetworks ?? defaultSocialNetworks(),
      socialStats: stored.socialStats ?? [],
      // Lot salons : absent des anciens states -> aucune campagne.
      campagnes: stored.campagnes ?? [],
      campagneLeads: stored.campagneLeads ?? [],
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
    templates: DEFAULT_TEMPLATES,
    calendarEvents: [],
    goals: [],
    defaultGoal: EMPTY_DEFAULT_GOAL,
    plannedActions: [],
    weeklyObjectives: [],
    socialNetworks: defaultSocialNetworks(),
    socialStats: [],
    campagnes: [],
    campagneLeads: [],
  };
}

function hydratePlannedActions(stored: AppState): AppState['plannedActions'] {
  const existing = stored.plannedActions ?? [];
  return [...existing, ...migrateLegacyNextActions(stored.leads ?? [], existing)];
}

// ---------------------------------------------------------------------------
// Lot 2 — helpers du reducer (la logique vit dans lib/plannedActions)
// ---------------------------------------------------------------------------

/** Ids fournis, sinon ids DÉTERMINISTES dérivés du state (harnais / anciens appels). */
function planIdsOrFallback(state: AppState, leadId: string, plan?: PlanIds): PlanIds {
  if (plan) return plan;
  const n = (state.plannedActions ?? []).length;
  return { plannedId: `pa-${leadId}-${n}`, reportEntryId: `rp-${leadId}-${n}-${state.actions.length}` };
}

/** Corps historique d'UPDATE_LEAD (jalons pilotés par le helper), hors champs nextAction*. */
function updateLeadFields(state: AppState, id: string, data: Partial<Lead>): AppState {
  return {
    ...state,
    leads: state.leads.map(l => {
      if (l.id !== id) return l;
      const merged = { ...l, ...data };
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
}

/** Recalcule le résumé nextAction* du lead depuis ses actions programmées. */
function syncLeadSummary(leads: Lead[], leadId: string, planned: AppState['plannedActions']): Lead[] {
  return leads.map(l => (l.id === leadId ? withNextActionSummary(l, planned) : l));
}

/**
 * Programme la prochaine action d'un lead depuis un appel « historique »
 * (formulaire d'action, éditeur de prochaine action, agenda) : personnes =
 * celles de l'action en cours, sinon le commercial du lead (éligible), sinon le
 * commercial du lead tel quel (écran existant, aucune perte de saisie).
 */
function planFromLegacy(
  state: AppState, lead: Lead,
  when: { type: ActionType | ''; date: string; time?: string; endTime?: string },
  ids: PlanIds, today: string,
): AppState {
  const planned = state.plannedActions ?? [];
  if (!when.type && !when.date) {
    const cancelled = cancelPendingAction(planned, lead.id);
    return { ...state, plannedActions: cancelled, leads: syncLeadSummary(state.leads, lead.id, cancelled) };
  }
  if (!when.date) return state; // type sans date : rien de programmable (écran existant)
  const pending = pendingActionOf(lead.id, planned);
  const people = pending?.people.length ? pending.people
    : defaultPeople(lead, state.commercials).length ? defaultPeople(lead, state.commercials)
    : [{ commercialId: lead.commercialId, role: 'responsable' as const }];
  const input: PlanInput = {
    type: (when.type || 'autre') as ActionType,
    customLabel: when.type ? '' : 'Prochaine action',
    date: when.date, time: when.time, endTime: when.endTime,
    note: pending?.note ?? '', people,
  };
  const out = planNextAction(planned, lead.id, input, ids, { authorId: lead.commercialId, today });
  return {
    ...state,
    plannedActions: out.planned,
    actions: out.report ? [out.report, ...state.actions] : state.actions,
    leads: syncLeadSummary(state.leads, lead.id, out.planned),
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_STATE':
      // Serveur d'avant le lot 2 (ou sauvegarde) : tableau absent -> [].
      return {
        ...action.payload,
        plannedActions: action.payload.plannedActions ?? [],
        weeklyObjectives: action.payload.weeklyObjectives ?? [],
        socialNetworks: action.payload.socialNetworks ?? [],
        socialStats: action.payload.socialStats ?? [],
        // Serveur d'avant le lot salons (ou base non migrée) : tableaux absents -> [].
        campagnes: action.payload.campagnes ?? [],
        campagneLeads: action.payload.campagneLeads ?? [],
      };

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

    case 'UPDATE_LEAD': {
      // Lot 2 : les champs nextAction* sont un RÉSUMÉ. S'ils arrivent dans le
      // patch (formulaire de lead existant), on ne les écrit pas tels quels : on
      // passe par la programmation, qui produit le résumé ET l'action programmée.
      const { nextActionType, nextActionDate, nextActionTime, nextActionEndTime, ...rest } = action.payload.data;
      const current = state.leads.find(l => l.id === action.payload.id);
      const touchesNext = nextActionType !== undefined || nextActionDate !== undefined;
      const nextChanged = !!current && touchesNext && (
        (nextActionType ?? current.nextActionType) !== current.nextActionType
        || (nextActionDate ?? current.nextActionDate) !== current.nextActionDate
        || (nextActionTime !== undefined && nextActionTime !== current.nextActionTime)
        || (nextActionEndTime !== undefined && nextActionEndTime !== current.nextActionEndTime));
      const updated = updateLeadFields(state, action.payload.id, rest);
      if (!current || !nextChanged) return updated;
      const lead = updated.leads.find(l => l.id === current.id)!;
      return planFromLegacy(updated, lead, {
        type: nextActionType ?? current.nextActionType,
        date: nextActionDate ?? current.nextActionDate,
        time: nextActionTime ?? current.nextActionTime,
        endTime: nextActionEndTime ?? current.nextActionEndTime,
      }, planIdsOrFallback(state, current.id), toISODate(new Date()));
    }

    case 'DELETE_LEAD':
      return {
        ...state,
        leads: state.leads.filter(l => l.id !== action.payload),
        actions: state.actions.filter(a => a.leadId !== action.payload),
        // Cascade miroir de la FK (planned_actions.leadId ON DELETE CASCADE).
        plannedActions: (state.plannedActions ?? []).filter(p => p.leadId !== action.payload),
      };

    case 'UPDATE_LEAD_STATUS':
      return {
        ...state,
        leads: state.leads.map(l =>
          l.id === action.payload.id
            ? {
                ...l,
                status: action.payload.status,
                // Absent (undefined) = ne pas toucher à la valeur existante ; les
                // clauses conditionnelles évitent d'écraser avec undefined.
                ...(action.payload.quoteAmount !== undefined ? { quoteAmount: action.payload.quoteAmount } : {}),
                ...(action.payload.lossReason !== undefined ? { lossReason: action.payload.lossReason } : {}),
                ...statusMilestoneDates(l, action.payload.status, toISODate(new Date())),
              }
            : l
        ),
      };

    case 'ADD_ACTION': {
      const act = action.payload;
      const realized = isRealizedAction(act);
      const withAction: AppState = {
        ...state,
        actions: [act, ...state.actions],
        leads: state.leads.map(l => {
          if (l.id !== act.leadId) return l;
          // lastActionDate = activite la plus recente : une action antidatee
          // (rattrapage d'historique) ne doit pas faire reculer la derniere
          // activite, sinon le lead bascule en fausse urgence. Comparaison de
          // chaines ISO (YYYY-MM-DD) ; '' perd toujours.
          // Lot 2 : une trace (report / sans suite) n'est PAS une activité.
          const lastActionDate =
            realized && act.date > (l.lastActionDate || '') ? act.date : l.lastActionDate;
          // Si l'action change le statut, on aligne les dates de jalon via le
          // helper en utilisant la date de l'action (date semantique de la
          // signature / perte / report / contact).
          const dates = act.newStatus
            ? statusMilestoneDates(l, act.newStatus, act.date)
            : null;
          return { ...l, ...(act.newStatus ? { status: act.newStatus } : {}), lastActionDate, ...dates };
        }),
      };
      // Prochaine action saisie dans le formulaire d'action (écran existant) :
      // programmée via le modèle lot 2 (résumé recalculé).
      if (!act.nextActionDate) return withAction;
      const lead = withAction.leads.find(l => l.id === act.leadId);
      if (!lead) return withAction;
      return planFromLegacy(withAction, lead, { type: act.nextActionType ?? '', date: act.nextActionDate },
        planIdsOrFallback(state, act.leadId, action.plan), act.date);
    }

    // --- Lot 2 : actions programmées -------------------------------------------

    case 'PLAN_NEXT_ACTION': {
      const { leadId, input, authorId, today, ids } = action.payload;
      if (!state.leads.some(l => l.id === leadId)) return state;
      const out = planNextAction(state.plannedActions ?? [], leadId, input, ids, { authorId, today });
      return {
        ...state,
        plannedActions: out.planned,
        actions: out.report ? [out.report, ...state.actions] : state.actions,
        leads: syncLeadSummary(state.leads, leadId, out.planned),
      };
    }

    case 'RESCHEDULE_PLANNED_ACTION': {
      const { plannedId, date, time, endTime, authorId, today, reportEntryId } = action.payload;
      const pa = (state.plannedActions ?? []).find(p => p.id === plannedId);
      if (!pa) return state;
      const out = reschedulePlannedAction(state.plannedActions, plannedId, { date, time, endTime }, { reportEntryId }, { authorId, today });
      return {
        ...state,
        plannedActions: out.planned,
        actions: out.report ? [out.report, ...state.actions] : state.actions,
        leads: syncLeadSummary(state.leads, pa.leadId, out.planned),
      };
    }

    case 'COMPLETE_PLANNED_ACTION': {
      const { plannedId, action: act, doneAt } = action.payload;
      const pa = (state.plannedActions ?? []).find(p => p.id === plannedId);
      if (!pa || pa.status !== 'a_faire') return state;
      // L'action réalisée suit EXACTEMENT le chemin ADD_ACTION (dernière action,
      // statut, jalons), liée à l'action programmée.
      const withAction = reducer(state, { type: 'ADD_ACTION', payload: { ...act, kind: 'realisee', plannedActionId: plannedId, nextActionType: undefined, nextActionDate: undefined } });
      const planned = completePlannedAction(withAction.plannedActions, plannedId, { doneAt, doneActionId: act.id });
      return { ...withAction, plannedActions: planned, leads: syncLeadSummary(withAction.leads, pa.leadId, planned) };
    }

    case 'SET_NO_NEXT_ACTION': {
      const { leadId, reason, authorId, today, at, entryId } = action.payload;
      if (!state.leads.some(l => l.id === leadId)) return state;
      const planned = cancelPendingAction(state.plannedActions ?? [], leadId);
      const entry = buildNoNextActionEntry({ id: entryId, leadId, reason, authorId, today });
      const leads = syncLeadSummary(state.leads, leadId, planned)
        .map(l => (l.id === leadId ? { ...l, noNextActionReason: reason, noNextActionAt: at } : l));
      return { ...state, plannedActions: planned, actions: [entry, ...state.actions], leads };
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

    // Definition/modification/effacement de la prochaine action (éditeur de la
    // fiche, agenda) : pas de jalons. Lot 2 : passe par la programmation — une
    // seule action à faire par lead, trace « report » si la date change,
    // effacement = action annulée (jamais supprimée) ; résumé recalculé.
    case 'SET_NEXT_ACTION': {
      const lead = state.leads.find(l => l.id === action.payload.id);
      if (!lead) return state;
      const p = action.payload;
      return planFromLegacy(state, lead,
        { type: p.nextActionType, date: p.nextActionType ? p.nextActionDate : '', time: p.nextActionTime, endTime: p.nextActionEndTime },
        planIdsOrFallback(state, lead.id, action.plan), toISODate(new Date()));
    }

    case 'SAVE_MONTHLY_STATS':
      return { ...state, monthlyStats: action.payload };

    case 'SAVE_GOALS':
      return { ...state, goals: action.payload };

    case 'SAVE_DEFAULT_GOAL':
      return { ...state, defaultGoal: action.payload };

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

    // Lot 3 : rangement. Retirer une catégorie qui contient encore un modèle est
    // REFUSÉ (state inchangé) — même règle que le serveur (409).
    case 'SAVE_TEMPLATE_LAYOUT': {
      const { categories, placements } = action.payload;
      const kept = new Set(categories.map(c => c.id));
      const byId = new Map(placements.map(p => [p.id, p]));
      const templates = state.templates.map(t => {
        const p = byId.get(t.id);
        return p ? { ...t, categoryId: p.categoryId && kept.has(p.categoryId) ? p.categoryId : undefined, position: p.position } : t;
      });
      if (templates.some(t => t.categoryId && !kept.has(t.categoryId))) return state;
      return { ...state, templateCategories: categories, templates };
    }

    // Lot 4 : objectifs de la semaine. Règles (5 actifs max, porteur valide,
    // texte) vérifiées ICI comme au serveur : une règle violée laisse l'état
    // inchangé (l'écran prévient avant). Aucune suppression possible.
    case 'ADD_WEEKLY_OBJECTIVE': {
      const list = state.weeklyObjectives ?? [];
      const { id, weekStart, text, ownerId, todayISO, nowISO } = action.payload;
      if (list.some(o => o.id === id)) return state;
      const o = newObjective({ id, weekStart, text, ownerId, list, todayISO, nowISO });
      if (validateObjective(o, list, state.commercials).length) return state;
      return { ...state, weeklyObjectives: [...list, o] };
    }

    case 'UPDATE_WEEKLY_OBJECTIVE': {
      const list = state.weeklyObjectives ?? [];
      const { id, patch, todayISO, nowISO } = action.payload;
      const current = list.find(o => o.id === id);
      if (!current) return state;
      const next = applyObjectivePatch(current, patch, todayISO, nowISO);
      if (next === current || validateObjective(next, list, state.commercials).length) return state;
      return { ...state, weeklyObjectives: list.map(o => (o.id === id ? next : o)) };
    }

    case 'CARRY_OVER_WEEKLY_OBJECTIVE': {
      const list = state.weeklyObjectives ?? [];
      const { id, newId, todayISO, nowISO } = action.payload;
      const r = carryOverObjective(list, id, newId, todayISO, nowISO);
      if (!r || !('objective' in r) || list.some(o => o.id === newId)) return state;
      return { ...state, weeklyObjectives: [...list, r.objective] };
    }

    // Lot 5 : réseaux sociaux. Règles (nom unique, stats valides) vérifiées ICI
    // comme au serveur : une règle violée laisse l'état inchangé.
    // --- Lot salons ---------------------------------------------------------
    // RIEN ICI N'ÉCRIT DANS UN LEAD. Embarquer un lead dans une campagne est une
    // opération commerciale ; sa source dit d'où il vient la première fois et
    // reste intacte.
    case 'ADD_CAMPAGNE_LEADS': {
      const list = state.campagneLeads ?? [];
      const dejaLa = new Set(list.map(p => `${p.campagneId}|${p.leadId}`));
      const nouvelles = action.payload.filter(p => {
        const cle = `${p.campagneId}|${p.leadId}`;
        if (dejaLa.has(cle)) return false; // ignoré EN SILENCE, jamais dupliqué
        dejaLa.add(cle);
        return true;
      });
      if (!nouvelles.length) return state;
      return { ...state, campagneLeads: [...list, ...nouvelles] };
    }

    case 'UPDATE_CAMPAGNE_LEAD': {
      const list = state.campagneLeads ?? [];
      if (!list.some(p => p.id === action.payload.id)) return state;
      return {
        ...state,
        campagneLeads: list.map(p => (p.id === action.payload.id ? { ...p, ...action.payload.data } : p)),
      };
    }

    case 'UPSERT_CAMPAGNE': {
      const list = state.campagnes ?? [];
      const existe = list.some(c => c.id === action.payload.id);
      return {
        ...state,
        campagnes: existe ? list.map(c => (c.id === action.payload.id ? { ...c, ...action.payload } : c)) : [...list, action.payload],
      };
    }

    case 'ADD_SOCIAL_NETWORK': {
      const list = state.socialNetworks ?? [];
      const { id, name } = action.payload;
      if (list.some(n => n.id === id) || validateNetworkName(name, list).length) return state;
      return { ...state, socialNetworks: [...list, newNetwork(list, id, name)] };
    }

    case 'RENAME_SOCIAL_NETWORK': {
      const list = state.socialNetworks ?? [];
      const { id, name } = action.payload;
      const current = list.find(n => n.id === id);
      if (!current || current.name === name.trim() || validateNetworkName(name, list, id).length) return state;
      return { ...state, socialNetworks: list.map(n => (n.id === id ? { ...n, name: name.trim() } : n)) };
    }

    case 'SET_SOCIAL_NETWORK_ARCHIVED': {
      const list = state.socialNetworks ?? [];
      const { id, archived } = action.payload;
      const current = list.find(n => n.id === id);
      if (!current || current.archived === archived) return state;
      return { ...state, socialNetworks: list.map(n => (n.id === id ? { ...n, archived } : n)) };
    }

    case 'SAVE_SOCIAL_STATS': {
      const networks = state.socialNetworks ?? [];
      if (action.payload.length === 0 || action.payload.some(r => statErrors(r, networks).length)) return state;
      return { ...state, socialStats: mergeStats(state.socialStats ?? [], action.payload) };
    }

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
