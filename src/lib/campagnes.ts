import type {
  AppState, Campagne, CampagneLead, CampagnePriorite, Commercial, Lead, LeadAction, PlannedAction,
} from '../data/types.js';
// Suffixe .js : module aussi chargé côté Node (harnais, et API si besoin).

// ===========================================================================
// LOT SALONS — règles des campagnes (module PUR, prouvé par
// scripts/harness-campagnes-lib.ts).
//
// DEUX RÈGLES STRUCTURANTES, à ne pas perdre de vue en relisant :
//
//  1. SOURCE ≠ CAMPAGNE. `Lead.source` dit d'où vient le lead la PREMIÈRE fois.
//     Rien ici ne la lit pour décider quoi que ce soit, et RIEN ne l'écrit.
//
//  2. AUCUN COMPTEUR N'EST STOCKÉ. Nombre d'appels, d'emails, date du dernier
//     contact, RDV sur le stand : tout est DÉRIVÉ de l'historique et des actions
//     programmées, sur la fenêtre de la campagne. Une saisie manuelle finirait
//     par mentir ; un calcul, non.
// ===========================================================================

/** Fenêtre d'ACTIVITÉ : borne les compteurs dérivés (préparation comprise). */
export interface Fenetre { debut: string; fin: string }

/**
 * Fenêtre d'activité d'une campagne. `dateFin` vide = toujours en cours, on
 * borne à aujourd'hui. `dateDebut` vide (ne devrait pas arriver) = pas de borne
 * basse, on prend tout ce qui précède la fin.
 */
export function fenetreActivite(c: Campagne, aujourdhui: string): Fenetre {
  return { debut: c.dateDebut || '0000-01-01', fin: c.dateFin || aujourdhui };
}

/**
 * Fenêtre des RDV du STAND. Si les dates du salon ne sont pas renseignées, on
 * retombe sur la fenêtre d'activité — et l'écran DOIT le dire (voir
 * `datesSalonARenseigner`) : jamais un chiffre silencieusement faux.
 */
export function fenetreSalon(c: Campagne, aujourdhui: string): Fenetre {
  if (c.dateSalonDebut && c.dateSalonFin) return { debut: c.dateSalonDebut, fin: c.dateSalonFin };
  return fenetreActivite(c, aujourdhui);
}

/** Vrai quand les jours du salon manquent : l'écran affiche « dates du salon à renseigner ». */
export function datesSalonARenseigner(c: Campagne): boolean {
  return c.type === 'salon' && !(c.dateSalonDebut && c.dateSalonFin);
}

const dans = (date: string, f: Fenetre) => !!date && date >= f.debut && date <= f.fin;

/**
 * Compteurs dérivés d'un lead sur une fenêtre. Seules les actions RÉALISÉES
 * comptent (`kind: 'realisee'`) : un report ou un « sans suite » n'est pas un
 * échange. Le canal vient du type d'action, comme partout dans le CRM.
 */
export interface CompteursLead {
  appels: number;
  dernierAppel: string;
  emails: number;
  dernierEmail: string;
  /** Tous canaux confondus (appel, email, sms, whatsapp, rdv, visite…). */
  echanges: number;
  dernierContact: string;
}

export function compteurs(actions: LeadAction[], leadId: string, f: Fenetre): CompteursLead {
  const c: CompteursLead = { appels: 0, dernierAppel: '', emails: 0, dernierEmail: '', echanges: 0, dernierContact: '' };
  for (const a of actions) {
    if (a.leadId !== leadId) continue;
    if ((a.kind ?? 'realisee') !== 'realisee') continue;
    if (!dans(a.date, f)) continue;
    c.echanges++;
    if (a.date > c.dernierContact) c.dernierContact = a.date;
    if (a.type === 'appel') { c.appels++; if (a.date > c.dernierAppel) c.dernierAppel = a.date; }
    if (a.type === 'email') { c.emails++; if (a.date > c.dernierEmail) c.dernierEmail = a.date; }
  }
  return c;
}

/** Contacté = au moins un appel OU un email sur la fenêtre (un lead compte une seule fois). */
export const estContacte = (c: CompteursLead): boolean => c.appels > 0 || c.emails > 0;

/**
 * RDV sur le stand : une action programmée de type `rdv` sur la fenêtre du
 * salon, à faire ou déjà faite. DÉRIVÉ — jamais saisi dans la participation.
 */
export function rdvStand(planned: PlannedAction[], leadId: string, f: Fenetre): PlannedAction | undefined {
  return planned.find(p => p.leadId === leadId && p.type === 'rdv' && p.status !== 'annulee' && dans(p.date, f));
}

/** Ordre de priorité : Haute d'abord. */
const RANG_PRIORITE: Record<CampagnePriorite, number> = { Haute: 0, Moyenne: 1, Basse: 2 };

/** Une ligne de la liste de travail : la participation + tout ce qui en est dérivé. */
export interface LigneCampagne {
  participation: CampagneLead;
  lead: Lead;
  responsable: Commercial | undefined;
  compteurs: CompteursLead;
  /** Date de la prochaine action DU LEAD (résumé v4), pas une date stockée dans la campagne. */
  prochaineAction: string;
  prochaineActionType: string;
  /** Prochaine action en retard : même règle que l'Agenda (hors Signé / Perdu). */
  enRetard: boolean;
  rdv: PlannedAction | undefined;
}

export interface OptionsLignes {
  campagne: Campagne;
  aujourdhui: string;
  /** Statuts « fermés » de la planification (Signé / Perdu) : pas de retard. */
  statutsFermes: readonly string[];
}

/**
 * Construit les lignes de la liste de travail, TRIÉES : priorité décroissante,
 * puis date de prochaine action croissante (les sans-date en dernier), puis nom.
 */
export function lignesCampagne(state: AppState, opts: OptionsLignes): LigneCampagne[] {
  const { campagne, aujourdhui, statutsFermes } = opts;
  const fAct = fenetreActivite(campagne, aujourdhui);
  const fSalon = fenetreSalon(campagne, aujourdhui);
  const leadById = new Map(state.leads.map(l => [l.id, l]));
  const comById = new Map(state.commercials.map(c => [c.id, c]));
  const planned = state.plannedActions ?? [];

  const lignes: LigneCampagne[] = [];
  for (const p of state.campagneLeads ?? []) {
    if (p.campagneId !== campagne.id) continue;
    const lead = leadById.get(p.leadId);
    if (!lead) continue; // lead supprimé : la participation suit (cascade en base)
    const prochaineAction = lead.nextActionDate ?? '';
    lignes.push({
      participation: p,
      lead,
      responsable: comById.get(p.responsableId),
      compteurs: compteurs(state.actions, lead.id, fAct),
      prochaineAction,
      prochaineActionType: lead.nextActionType ?? '',
      enRetard: !!prochaineAction && prochaineAction < aujourdhui && !statutsFermes.includes(lead.status),
      rdv: rdvStand(planned, lead.id, fSalon),
    });
  }

  return lignes.sort((a, b) => {
    const pa = RANG_PRIORITE[a.participation.priorite] ?? 1;
    const pb = RANG_PRIORITE[b.participation.priorite] ?? 1;
    if (pa !== pb) return pa - pb;
    // Sans date de prochaine action -> en dernier (et non en premier, ce que
    // ferait une comparaison de chaînes naïve avec '').
    const da = a.prochaineAction || '9999-99-99';
    const db = b.prochaineAction || '9999-99-99';
    if (da !== db) return da.localeCompare(db);
    return `${a.lead.lastName} ${a.lead.firstName}`.localeCompare(`${b.lead.lastName} ${b.lead.firstName}`);
  });
}

/** Filtres de la liste de travail. '' = pas de filtre. */
export interface FiltresCampagne {
  responsableId?: string;
  statutCampagne?: string;
  segment?: string;
  priorite?: string;
  /** 'oui' | 'non' | '' */
  rdv?: string;
  enRetardSeulement?: boolean;
  /** Recherche libre : nom, prénom, société (via boatInterest), téléphone, email. */
  recherche?: string;
}

export function filtrerLignes(lignes: LigneCampagne[], f: FiltresCampagne): LigneCampagne[] {
  const q = (f.recherche ?? '').trim().toLowerCase();
  return lignes.filter(l => {
    if (f.responsableId && l.participation.responsableId !== f.responsableId) return false;
    if (f.statutCampagne && l.participation.statutCampagne !== f.statutCampagne) return false;
    if (f.segment && l.participation.segment !== f.segment) return false;
    if (f.priorite && l.participation.priorite !== f.priorite) return false;
    if (f.rdv === 'oui' && !l.rdv) return false;
    if (f.rdv === 'non' && l.rdv) return false;
    if (f.enRetardSeulement && !l.enRetard) return false;
    if (q) {
      const champs = [l.lead.firstName, l.lead.lastName, l.lead.phone, l.lead.email, l.lead.boatInterest].join(' ').toLowerCase();
      if (!champs.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Prépare un ajout EN MASSE : une participation par lead RETENU.
 *
 * - les leads déjà participants sont écartés ICI aussi (l'index unique en base
 *   est le juge de paix, mais l'écran ne doit pas promettre N si M sont déjà là) ;
 * - `leads.source` n'est ni lu ni écrit ;
 * - le responsable est celui choisi pour le lot ; c'est l'appelant qui décide de
 *   reprendre le commercial du lead ou non (voir `leadsSansCommercial`).
 */
export interface AjoutEnMasse {
  campagneId: string;
  leadIds: string[];
  segment: string;
  priorite: CampagnePriorite;
  responsableId: string;
  statutParDefaut: CampagneLead['statutCampagne'];
}

export function preparerAjout(
  state: AppState,
  a: AjoutEnMasse,
  genererId: () => string,
): { nouvelles: CampagneLead[]; dejaParticipants: string[] } {
  // Deux ensembles DISTINCTS, et c'est important pour le message affiché :
  //  - `existants` = déjà dans la campagne AVANT ce lot -> à annoncer
  //    (« 3 leads étaient déjà dans la campagne, ils ont été ignorés ») ;
  //  - `vus` = doublons DANS le lot (le même lead coché deux fois via deux
  //    filtres) -> simple dédoublonnage, il n'y a rien à annoncer.
  const existants = new Set(
    (state.campagneLeads ?? []).filter(p => p.campagneId === a.campagneId).map(p => p.leadId),
  );
  const vus = new Set<string>();
  const nouvelles: CampagneLead[] = [];
  const dejaParticipants: string[] = [];
  for (const leadId of a.leadIds) {
    if (existants.has(leadId)) { if (!vus.has(leadId)) dejaParticipants.push(leadId); vus.add(leadId); continue; }
    if (vus.has(leadId)) continue; // même lot, deux fois le même lead : une seule participation
    vus.add(leadId);
    nouvelles.push({
      id: genererId(),
      campagneId: a.campagneId,
      leadId,
      responsableId: a.responsableId,
      segment: a.segment,
      priorite: a.priorite,
      statutCampagne: a.statutParDefaut,
      bateauxAVoir: '',
      notes: '',
    });
  }
  return { nouvelles, dejaParticipants };
}

/**
 * Leads d'une sélection SANS commercial réel (« Non attribué » ou commercial
 * inconnu). L'écran d'ajout en masse doit les annoncer et imposer un
 * responsable de campagne : sans cela, 25 leads du portefeuille entreraient dans
 * la campagne sans que personne ne les rappelle.
 */
export function leadsSansCommercial(state: AppState, leadIds: string[], estNonAttribue: (c: Commercial) => boolean): string[] {
  const comById = new Map(state.commercials.map(c => [c.id, c]));
  return leadIds.filter(id => {
    const lead = state.leads.find(l => l.id === id);
    if (!lead) return false;
    const c = comById.get(lead.commercialId);
    return !c || estNonAttribue(c);
  });
}

/** Campagne à ouvrir par défaut : la première active, sinon la plus récente. */
export function campagneParDefaut(campagnes: Campagne[] | undefined): Campagne | undefined {
  const list = campagnes ?? [];
  return list.find(c => c.active) ?? list[0];
}
