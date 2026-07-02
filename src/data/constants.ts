import type { LeadStatus, BoatType, BoatCondition, Temperature, ActionType, Commercial, Priority, MessageTemplate, CalendarEventCategory, DefaultGoal } from './types';

// Objectifs par défaut « vides » : aucune cible d'équipe fixée (repli neutre à
// l'hydratation d'un state sans defaultGoal — migration nulle).
export const EMPTY_DEFAULT_GOAL: DefaultGoal = {
  prospectsCreated: null,
  coldCalls: null,
  followups: null,
  meetings: null,
  revenue: null,
  conversionRate: null,
};

export const LEAD_STATUSES: { value: LeadStatus; label: string; color: string }[] = [
  { value: 'nouveau', label: 'Nouveau', color: 'bg-gray-100 text-gray-800' },
  { value: 'a_contacter', label: 'À contacter', color: 'bg-blue-100 text-blue-800' },
  { value: 'contacte', label: 'Contacté', color: 'bg-sky-100 text-sky-800' },
  { value: 'qualifie', label: 'Qualifié', color: 'bg-indigo-100 text-indigo-800' },
  { value: 'devis_envoye', label: 'Devis envoyé', color: 'bg-purple-100 text-purple-800' },
  { value: 'negociation', label: 'Négociation', color: 'bg-amber-100 text-amber-800' },
  { value: 'en_conclusion', label: 'En conclusion', color: 'bg-orange-100 text-orange-800' },
  { value: 'signe', label: 'Signé', color: 'bg-green-100 text-green-800' },
  { value: 'perdu', label: 'Perdu', color: 'bg-red-100 text-red-800' },
  { value: 'reporte', label: 'Reporté', color: 'bg-yellow-100 text-yellow-800' },
];

export const PIPELINE_STATUSES: LeadStatus[] = [
  'nouveau',
  'a_contacter',
  'contacte',
  'qualifie',
  'devis_envoye',
  'negociation',
  'en_conclusion',
  'signe',
  'perdu',
  'reporte',
];

export const ACTIVE_STATUSES: LeadStatus[] = [
  'nouveau',
  'a_contacter',
  'contacte',
  'qualifie',
  'devis_envoye',
  'negociation',
  'en_conclusion',
];

export const BOAT_TYPES: BoatType[] = ['Moteur', 'Voile', 'Semi-rigide'];

export const BOAT_CONDITIONS: BoatCondition[] = ['Neuf', 'BO', 'DV'];

export const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: 'basse', label: 'Basse', color: 'bg-gray-100 text-gray-600' },
  { value: 'normale', label: 'Normale', color: 'bg-blue-100 text-blue-700' },
  { value: 'haute', label: 'Haute', color: 'bg-orange-100 text-orange-700' },
  { value: 'critique', label: 'Critique', color: 'bg-red-100 text-red-700' },
];

export const TEMPERATURES: { value: Temperature; label: string; color: string; dot: string }[] = [
  { value: 'froid', label: 'Froid', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  { value: 'tiede', label: 'Tiède', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  { value: 'chaud', label: 'Chaud', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
];

export const ACTION_TYPES: { value: ActionType; label: string }[] = [
  { value: 'appel', label: 'Appel' },
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'rdv', label: 'Rendez-vous' },
  { value: 'visite', label: 'Visite' },
  { value: 'devis', label: 'Devis' },
  { value: 'relance', label: 'Relance' },
  { value: 'negociation', label: 'Négociation' },
  { value: 'conclusion', label: 'Conclusion' },
  { value: 'note', label: 'Note' },
  { value: 'autre', label: 'Autre' },
];

export const SOURCES = [
  'Site BOB',
  'Tel',
  'Passage',
  'BoatsGroup',
  'LBC',
  'Yachtworld',
  'boats.com',
  'Annonces du bateau',
  'Cosas de barcos',
  'Salon GP',
  'Salon CAN',
  'Salon PRS',
  'Band of Boats',
  'Beneteau',
  'Démarchage terrain',
  'Recommandation',
];

// Sources de PROSPECTION ACTIVE (le commercial va chercher le lead) — par
// opposition au flux entrant. Source de verite unique du classement, sur
// laquelle `countLeadsCreated` (lib/goals) filtre l'objectif « leads rentres ».
// INVARIANT : sous-ensemble de SOURCES (verifie au harnais goals).
export const PROSPECTION_SOURCES = [
  'Passage',
  'Salon GP',
  'Salon CAN',
  'Salon PRS',
  'Démarchage terrain',
  'Recommandation',
];

export const MONTHLY_STAT_SOURCES = [
  'Site web BOB',
  'Band of Boats',
  'Le Bon Coin',
  'Boats Wizard',
  'Instapage',
  'Google Ads',
  'Magnetis',
];

export const ACQUISITION_SOURCES = [
  'Annonce du bateau',
  'Boats and outboards',
  'Boats shop',
  'boats.com',
  'Boot24',
  'Botentekoop',
  'Cosas de barcos',
  'Inautia',
  'Top barcos',
  'Yachtworld',
  'Youboat',
];

// Categorie d'une source d'acquisition :
//  - 'regie'      : canal PAYANT (budget + leads -> CPL derive) ;
//  - 'plateforme' : plateforme d'annonces (volume de leads, pas de budget).
export type AcquisitionSourceCategory = 'regie' | 'plateforme';

export interface AcquisitionSourceDef {
  name: string;
  category: AcquisitionSourceCategory;
}

// Liste UNIFIEE des sources d'acquisition (refonte-acquisition) : une seule
// source de verite pour la saisie. Regies payantes d'abord, puis plateformes
// d'annonces. Noms repris A L'IDENTIQUE de MONTHLY_STAT_SOURCES / ACQUISITION_
// SOURCES pour rester aligne avec les donnees deja stockees (mergeAcquisition).
export const ACQUISITION_SOURCES_ALL: AcquisitionSourceDef[] = [
  ...MONTHLY_STAT_SOURCES.map((name) => ({ name, category: 'regie' as const })),
  ...ACQUISITION_SOURCES.map((name) => ({ name, category: 'plateforme' as const })),
];

export const DEFAULT_COMMERCIALS: Commercial[] = [
  { id: 'fred', name: 'Fred', active: true },
  { id: 'tom', name: 'Tom', active: true },
  { id: 'nicolas', name: 'Nicolas', active: true },
  { id: 'oceane', name: 'Océane', active: true },
  { id: 'camaret', name: 'Camaret', active: true },
];

export const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

// Amplitude des selecteurs d'annee (stats acquisition). Plage DYNAMIQUE calculee
// autour de l'annee courante par buildYearRange() (lib/utils) -> aucune annee en
// dur, l'horizon glisse chaque annee, jamais de plafond a reconduire. Large vers
// le futur pour ne JAMAIS bloquer une saisie a venir.
export const YEAR_RANGE_BACK = 5;
export const YEAR_RANGE_FORWARD = 50;

// Nom d'entreprise centralise (rapports PDF, en-tetes, branding, futur re-fork client).
export const COMPANY_NAME = 'Brest Ocean Boat';

// Plage horaire des vues Semaine/Journee en grille (lot agenda-grille-horaire).
// CONSTANTE pour l'instant (un onglet Parametres reglable = lot separe) :
// modifiable ici en une ligne. Plage affichee = [START:00, END:00), creneaux de
// AGENDA_SLOT_MIN minutes. La journee complete (0h->24h, lot agenda-24h) : aucune
// action horodatee n'atterrit plus dans "hors plage", tout est sur la grille ; le
// bandeau "toute la journee" ne recoit plus que les actions SANS heure.
export const AGENDA_HOUR_START = 0;
export const AGENDA_HOUR_END = 24;
export const AGENDA_SLOT_MIN = 30;

// Heure vers laquelle la grille (haute : 24h * 2 creneaux) defile a l'ouverture,
// pour ne pas apparaitre sur minuit. Offset VISUEL seulement, INDEPENDANT de la
// plage [START, END) : on ancre sur une heure ouvree sans restreindre l'amplitude.
export const AGENDA_SCROLL_TO_HOUR = 8;

// Palette deterministe pour identifier visuellement chaque commercial dans
// l'agenda. Attribuee par POSITION dans la liste des commerciaux (stable au
// rechargement, AUCUN champ a persister sur Commercial). >= 8 teintes pour
// absorber les ajouts d'equipe ; au-dela on cycle (modulo). Les classes sont
// ecrites EN TOUTES LETTRES (pas de concatenation) pour que le JIT Tailwind les
// detecte. Voir getCommercialColor (lib/agenda.ts).
export const COMMERCIAL_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300', dot: 'bg-blue-500' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300', dot: 'bg-emerald-500' },
  { bg: 'bg-violet-100', text: 'text-violet-800', border: 'border-violet-300', dot: 'bg-violet-500' },
  { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300', dot: 'bg-amber-500' },
  { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-300', dot: 'bg-rose-500' },
  { bg: 'bg-cyan-100', text: 'text-cyan-800', border: 'border-cyan-300', dot: 'bg-cyan-500' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-800', border: 'border-fuchsia-300', dot: 'bg-fuchsia-500' },
  { bg: 'bg-lime-100', text: 'text-lime-800', border: 'border-lime-300', dot: 'bg-lime-500' },
] as const;

// Repli neutre pour un commercialId introuvable (jamais de crash visuel).
export const NEUTRAL_COMMERCIAL_COLOR = {
  bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300', dot: 'bg-gray-400',
} as const;

// Categories d'evenement d'agenda libre (lot v3.13) : couleur + libelle. Teintes
// volontairement distinctes de la palette commerciaux (+ icone cote UI) pour
// distinguer un evenement d'une action de lead. Classes en toutes lettres (JIT).
export const CALENDAR_EVENT_CATEGORIES: { value: CalendarEventCategory; label: string; bg: string; text: string; border: string; dot: string }[] = [
  { value: 'reunion', label: 'Réunion', bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-300', dot: 'bg-indigo-500' },
  { value: 'conge', label: 'Congé', bg: 'bg-teal-100', text: 'text-teal-800', border: 'border-teal-300', dot: 'bg-teal-500' },
  { value: 'deplacement', label: 'Déplacement', bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300', dot: 'bg-orange-500' },
  { value: 'perso', label: 'Perso', bg: 'bg-pink-100', text: 'text-pink-800', border: 'border-pink-300', dot: 'bg-pink-500' },
  { value: 'autre', label: 'Autre', bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300', dot: 'bg-slate-500' },
];

export function getCategoryInfo(category?: CalendarEventCategory) {
  return CALENDAR_EVENT_CATEGORIES.find(c => c.value === category) ?? CALENDAR_EVENT_CATEGORIES[4];
}

// Variables interpolables dans les sujets / corps de templates — email ET sms
// (affichage de l'aide dans l'UI d'edition). Doit rester aligne avec buildLeadVars().
export const TEMPLATE_VARIABLES = [
  { key: 'prenom', label: 'Prénom du lead' },
  { key: 'nom', label: 'Nom du lead' },
  { key: 'bateau', label: 'Type de bateau' },
  { key: 'modele', label: 'Modèle / intérêt' },
  { key: 'commercial', label: 'Nom du commercial' },
  { key: 'signature', label: 'Signature du commercial' },
];

// Modeles par defaut (volontairement concis : un mailto: pre-rempli encode est
// limite a ~2000 caracteres, surtout sous Outlook/Windows). Servent de seed au
// premier lancement ; ensuite l'utilisateur gere ses modeles librement.
export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: 'contact',
    type: 'email',
    title: 'Premier contact',
    subject: 'Votre projet bateau — {{modele}}',
    body:
      'Bonjour {{prenom}} {{nom}},\n\n' +
      'Suite à votre intérêt pour un bateau de type {{bateau}} ({{modele}}), je reste à votre disposition pour échanger sur votre projet et répondre à vos questions.\n\n' +
      'Quand seriez-vous disponible pour en discuter ?\n\n' +
      'Cordialement,\n{{commercial}}\n{{signature}}',
  },
  {
    id: 'relance',
    type: 'email',
    title: 'Relance',
    subject: 'Suite à notre échange — {{modele}}',
    body:
      'Bonjour {{prenom}} {{nom}},\n\n' +
      'Je me permets de revenir vers vous concernant votre projet de bateau {{bateau}} ({{modele}}). Avez-vous pu avancer dans votre réflexion ?\n\n' +
      'Je reste disponible pour toute information complémentaire.\n\n' +
      'Cordialement,\n{{commercial}}\n{{signature}}',
  },
  {
    id: 'suivi',
    type: 'email',
    title: 'Suivi de dossier',
    subject: 'Suivi de votre dossier — {{modele}}',
    body:
      'Bonjour {{prenom}} {{nom}},\n\n' +
      'Je souhaitais faire un point sur l\'avancement de votre dossier pour le {{modele}} ({{bateau}}). N\'hésitez pas à me contacter si vous avez la moindre question.\n\n' +
      'Bien cordialement,\n{{commercial}}\n{{signature}}',
  },
];

export function getStatusLabel(status: LeadStatus): string {
  return LEAD_STATUSES.find(s => s.value === status)?.label ?? status;
}

export function getStatusColor(status: LeadStatus): string {
  return LEAD_STATUSES.find(s => s.value === status)?.color ?? 'bg-gray-100 text-gray-800';
}

export function getTemperatureInfo(temp: Temperature) {
  return TEMPERATURES.find(t => t.value === temp) ?? TEMPERATURES[0];
}

export function getPriorityInfo(p: Priority) {
  return PRIORITIES.find(pr => pr.value === p) ?? PRIORITIES[1];
}

export const STATUS_ORDER: LeadStatus[] = [
  'nouveau', 'a_contacter', 'contacte', 'qualifie',
  'devis_envoye', 'negociation', 'en_conclusion', 'signe',
];

export function getNextStatus(current: LeadStatus): LeadStatus | null {
  const idx = STATUS_ORDER.indexOf(current);
  if (idx === -1 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1];
}
