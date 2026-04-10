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
export type AlertLevel = 'none' | 'orange' | 'red';

export type ActionType =
  | 'appel'
  | 'email'
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
  nextActionType: ActionType | '';
  nextActionDate: string;
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
}
