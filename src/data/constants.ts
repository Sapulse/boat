import type { LeadStatus, BoatType, BoatCondition, Temperature, ActionType, Commercial, Priority, EmailTemplate } from './types';

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

// Nom d'entreprise centralise (rapports PDF, en-tetes, branding, futur re-fork client).
export const COMPANY_NAME = 'Brest Ocean Boat';

// Variables interpolables dans les sujets / corps de templates (affichage de
// l'aide dans l'UI d'edition). Doit rester aligne avec buildLeadVars().
export const EMAIL_TEMPLATE_VARIABLES = [
  { key: 'prenom', label: 'Prénom du lead' },
  { key: 'nom', label: 'Nom du lead' },
  { key: 'bateau', label: 'Type de bateau' },
  { key: 'modele', label: 'Modèle / intérêt' },
  { key: 'commercial', label: 'Nom du commercial' },
  { key: 'signature', label: 'Signature du commercial' },
];

// Modeles par defaut (volontairement concis : un mailto: pre-rempli encode est
// limite a ~2000 caracteres, surtout sous Outlook/Windows).
export const DEFAULT_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'contact',
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
