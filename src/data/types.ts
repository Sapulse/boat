export type LeadStatus =
  | 'nouveau'
  | 'a_contacter'
  | 'contacte'
  | 'qualifie'
  | 'devis_envoye'
  | 'negociation'
  | 'en_conclusion'
  | 'signe'
  | 'perdu'
  | 'reporte';

export type BoatType = 'Moteur' | 'Voile' | 'Semi-rigide';
export type BoatCondition = 'Neuf' | 'BO' | 'DV';
export type Temperature = 'froid' | 'tiede' | 'chaud';
export type Priority = 'basse' | 'normale' | 'haute' | 'critique';
export type AlertLevel = 'none' | 'orange' | 'red';

export type ActionType =
  | 'appel'
  | 'email'
  | 'sms'
  | 'whatsapp'
  | 'rdv'
  | 'visite'
  | 'devis'
  | 'relance'
  | 'negociation'
  | 'conclusion'
  | 'note'
  | 'autre';

export interface Commercial {
  id: string;
  name: string;
  active: boolean;
  createdAt?: string;
  // Optionnels : absents des commerciaux crees avant le Lot 2 (migration-safe,
  // fallback '' partout ou ils sont consommes).
  email?: string;
  signature?: string;
}

export type TemplateType = 'email' | 'sms' | 'whatsapp';

/**
 * Modele de message (email, sms OU whatsapp). Les ids sont generes (generateId)
 * pour les nouveaux modeles ; les ids semantiques historiques ('contact',
 * 'relance', 'suivi') restent des strings valides. `subject` vaut '' pour les
 * SMS et WhatsApp (pas de sujet). Le type est fige a la creation.
 */
export interface MessageTemplate {
  id: string;
  type: TemplateType;
  title: string;
  subject: string;
  body: string;
}

export interface LeadAction {
  id: string;
  leadId: string;
  type: ActionType;
  date: string;
  result: string;
  notes: string;
  authorId: string;
  newStatus?: LeadStatus;
  nextActionType?: ActionType;
  nextActionDate?: string;
}

export interface Lead {
  id: string;
  createdAt: string;
  source: string;
  commercialId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  boatType: BoatType | '';
  boatCondition: BoatCondition | '';
  boatInterest: string;
  brand: string;
  budget: number | null;
  status: LeadStatus;
  contactDate: string;
  quoteAmount: number | null;
  probability: number | null;
  currentBoat: string;
  comments: string;
  deliveryDate: string;
  temperature: Temperature;
  priority: Priority;
  nextActionType: ActionType | '';
  nextActionDate: string;
  // Heure optionnelle de la prochaine action ("HH:mm"). Absente = "toute la
  // journee" (comportement historique). CHAMP SEPARE volontaire : nextActionDate
  // reste un "YYYY-MM-DD" compare en chaine (hasFutureNextAction, eventStatus,
  // groupEventsByDay, tris) — on n'y touche jamais.
  nextActionTime?: string;
  // Heure de FIN optionnelle ("HH:mm") -> donne une DUREE a l'action (bloc dans
  // la grille). N'a de sens que si nextActionTime (debut) est posee ET > debut.
  // Absente = action ponctuelle (occupe juste son creneau de debut). Champ
  // separe : on ne touche ni nextActionDate ni nextActionTime.
  nextActionEndTime?: string;
  lastActionDate: string;
  lossReason: string;
  signedAt: string;
  lostAt: string;
  reportedAt: string;
}

// Stat d'acquisition d'un (annee, mois, source) : budget (regies payantes) et/ou
// volume de leads (toutes sources). Le CPL n'est PAS stocke -> derive a la volee
// (computeCpl, lib/acquisition) pour ne jamais diverger de (budget, leads).
export interface MonthlyStat {
  id: string;
  year: number;
  month: number;
  source: string;
  budget: number | null;
  leads: number | null;
}

export type CalendarEventCategory = 'reunion' | 'conge' | 'deplacement' | 'perso' | 'autre';

/**
 * Evenement d'agenda INDEPENDANT des leads (reunion, conge, deplacement, bloc
 * perso). Memes conventions horaires que les actions (date "YYYY-MM-DD",
 * time/endTime "HH:mm") -> reutilise les helpers purs de lib/agenda. Entite
 * isolee (tableau + actions reducer dediees) pour rebranchement backend ulterieur
 * sans toucher au reste. `commercialId` absent = evenement general (equipe).
 */
export interface CalendarEvent {
  id: string;
  title: string;
  date: string;             // "YYYY-MM-DD"
  time?: string;            // "HH:mm" — absent = toute la journee
  endTime?: string;         // "HH:mm" — donne une duree
  commercialId?: string;    // assigne a un commercial, ou absent = general
  category?: CalendarEventCategory;
  note?: string;
}

/**
 * Objectif d'un commercial pour un mois (lot page-objectifs-commerciaux).
 * Chaque indicateur porte une CIBLE (`target`) et un OVERRIDE manuel facultatif
 * du realise (`override`) : quand `override` est renseigne il PRIME sur le calcul
 * automatique ; a null, le realise est compte automatiquement (lib/goals) et
 * n'est jamais persiste -> toujours a jour. Entite isolee, pensee pour un
 * rebranchement backend (seule la SOURCE des donnees changera).
 */
export interface GoalMetric {
  target: number | null;     // objectif (cible) ; null = pas d'objectif fixe
  override: number | null;   // realise saisi a la main ; null = realise automatique
}

export interface CommercialGoal {
  id: string;
  commercialId: string;
  year: number;
  month: number;             // 1..12 (objectifs mensuels)
  calls: GoalMetric;         // appels (ActionType 'appel')
  followups: GoalMetric;     // relances ('relance' + 'email' + 'sms' + 'whatsapp')
  meetings: GoalMetric;      // RDV/visites ('rdv' + 'visite')
  revenue: GoalMetric;       // CA signe (somme quoteAmount ?? budget), en EUR
  conversionRate: GoalMetric; // taux de transformation, en %
}

export interface AppState {
  leads: Lead[];
  actions: LeadAction[];
  commercials: Commercial[];
  monthlyStats: MonthlyStat[];
  // Avant v3.2 le champ s'appelait `emailTemplates` (templates email only) :
  // l'hydratation (appReducer.getInitialState) lit encore l'ancien nom.
  templates: MessageTemplate[];
  // Evenements d'agenda non lies aux leads (v3.13). Absent des anciens states
  // -> hydrate en [] (migration nulle, voir getInitialState).
  calendarEvents: CalendarEvent[];
  // Objectifs commerciaux mensuels (lot objectifs). Absent des anciens states
  // -> hydrate en [] (migration nulle, voir getInitialState).
  goals: CommercialGoal[];
}
