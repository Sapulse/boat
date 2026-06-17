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
  lastActionDate: string;
  lossReason: string;
  signedAt: string;
  lostAt: string;
  reportedAt: string;
}

export interface MonthlyStat {
  id: string;
  year: number;
  month: number;
  source: string;
  budget: number | null;
  leads: number | null;
  cpl: number | null;
}

export interface AcquisitionVolume {
  id: string;
  source: string;
  month: number;
  year: number;
  leadCount: number;
}

export interface AppState {
  leads: Lead[];
  actions: LeadAction[];
  commercials: Commercial[];
  monthlyStats: MonthlyStat[];
  acquisitionVolumes: AcquisitionVolume[];
  // Avant v3.2 le champ s'appelait `emailTemplates` (templates email only) :
  // l'hydratation (appReducer.getInitialState) lit encore l'ancien nom.
  templates: MessageTemplate[];
}
