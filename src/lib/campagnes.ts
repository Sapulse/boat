import type {
  AppState, Campagne, CampagneLead, CampagnePriorite, CampagneStatut, Commercial, Lead, LeadAction,
  LeadStatus, PlannedAction,
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
  /**
   * Lead FERMÉ (Signé / Perdu) : la participation reste dans la campagne — on
   * n'efface pas un client signé au salon — mais elle sort de la liste de
   * travail par défaut (règle de l'Agenda v4, étendue aux campagnes le 19/09).
   */
  ferme: boolean;
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
      ferme: statutsFermes.includes(lead.status),
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
  /**
   * Leads FERMÉS (Signé / Perdu) : masqués PAR DÉFAUT. Un lead signé n'a plus
   * rien à faire dans la file d'appels du salon, et un lead perdu non plus ;
   * ils restent consultables en cochant la case, pour les revoir sans avoir à
   * les retrouver ailleurs.
   */
  inclureFermes?: boolean;
  /** Recherche libre : nom, prénom, société (via boatInterest), téléphone, email. */
  recherche?: string;
}

export function filtrerLignes(lignes: LigneCampagne[], f: FiltresCampagne): LigneCampagne[] {
  const q = (f.recherche ?? '').trim().toLowerCase();
  return lignes.filter(l => {
    if (l.ferme && !f.inclureFermes) return false;
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

// ===========================================================================
// STATUT DE CAMPAGNE DÉDUIT (S2c)
//
// LE PROBLÈME QU'ON ÉVITE : si le statut est un geste manuel séparé, il ne sera
// pas fait. Tom passe 40 appels lundi, les enregistre, et mardi l'écran affiche
// « Contactés : 0 » parce que les lignes sont restées à « À contacter ». C'est le
// tableau de bord faux du fichier Excel, reproduit chez nous.
//
// DONC : le statut se DÉDUIT de ce qui a été fait, et l'édition manuelle sert à
// CORRIGER. Trois règles de sûreté :
//  1. on ne devine JAMAIS une intention : « Injoignable », « Pas intéressé »,
//     « À relancer après salon » restent strictement manuels et ne sont jamais
//     écrasés par une déduction (« Projet reporté » est sorti de cette liste le
//     19/09 : il se déduit du lead Reporté — voir plus bas) ;
//  2. la déduction ne REGRESSE jamais : un « RDV confirmé » ne redevient pas
//     « Contacté sans retour » parce qu'on rappelle ;
//  3. elle s'applique quel que soit le point de saisie (liste de travail OU fiche
//     lead), parce qu'elle vit dans le reducer, pas dans un écran.
// ===========================================================================

/** Statuts que la déduction peut poser. */
export const STATUTS_DEDUITS = [
  'À contacter',
  'Contacté sans retour',
  'Projet reporté',
  'Échange en cours',
  'RDV confirmé',
] as const;

/**
 * AVANCEMENT de chaque statut déductible — c'est LUI qui interdit la régression,
 * pas l'ordre du tableau ci-dessus.
 *
 * « Projet reporté » est au MÊME niveau que « Contacté sans retour » (décision
 * du 19/09) : pendant un salon, un projet reporté qu'on rappelle et qui se
 * réveille est exactement la matière qu'on cherche. Au-dessus, il gèlerait le
 * lead au moment où il redevient chaud ; au même niveau, un échange ultérieur le
 * fait progresser tout seul vers « Échange en cours ».
 */
const RANG_DEDUIT: Record<string, number> = {
  'À contacter': 0,
  'Contacté sans retour': 1,
  'Projet reporté': 1,
  'Échange en cours': 2,
  'RDV confirmé': 3,
};

/**
 * Statuts de JUGEMENT : seul un humain les pose, aucune déduction n'y touche.
 *
 * « À relancer après salon » en particulier est le marqueur du cercle 2 : un
 * appel ne doit JAMAIS le ramener dans la file urgente. « Projet reporté » n'en
 * fait plus partie depuis le 19/09 (voir RANG_DEDUIT) : il se déduit du statut
 * Reporté du lead, et se laisse dépasser par un échange.
 */
export const STATUTS_MANUELS = [
  'À relancer après salon',
  'Injoignable',
  'Pas intéressé',
] as const;

const rang = (s: string): number => RANG_DEDUIT[s] ?? -1;

/**
 * L'action prouve-t-elle qu'on a PARLÉ au client ?
 *
 * Mapping sur les puces existantes de la fenêtre d'appel (lib/plannedActions,
 * CALL_RESULTS), enregistrées dans `result` sous la forme « Appel — Joint » :
 *   Joint, Rappel demandé          -> OUI, on a eu quelqu'un au téléphone ;
 *   Message laissé, Pas de réponse,
 *   Mauvais numéro                 -> NON, l'appel est passé mais sans échange.
 *
 * Les autres types : un rendez-vous, une visite, une négociation ou une
 * conclusion supposent un échange. Un email, un SMS, un WhatsApp, une relance ou
 * une note ne prouvent RIEN d'un retour du client — envoyer n'est pas parler.
 */
const SANS_ECHANGE = ['Message laissé', 'Pas de réponse'];
const TYPES_AVEC_ECHANGE = ['rdv', 'visite', 'negociation', 'conclusion'];

/**
 * « Mauvais numéro » ne déduit RIEN : le statut reste ce qu'il était.
 *
 * Un numéro mort n'est pas un contact. Le compter comme « Contacté sans retour »
 * ferait deux dégâts : le « Contactés » que lit la direction gonflerait de
 * non-événements, et ces leads sortiraient de la file des urgents alors qu'ils
 * réclament justement une action — retrouver le bon numéro. Si le commercial
 * abandonne, il pose « Injoignable » À LA MAIN : c'est un jugement.
 *
 * NB : l'appel reste compté comme appel dans les compteurs et dans les objectifs
 * (il a bien été passé) ; seule la DÉDUCTION du statut l'ignore.
 */
const SANS_DEDUCTION = ['Mauvais numéro'];

export function actionSansDeduction(a: Pick<LeadAction, 'type' | 'result'>): boolean {
  return a.type === 'appel' && SANS_DEDUCTION.some(x => (a.result ?? '').includes(x));
}

export function actionProuveUnEchange(a: Pick<LeadAction, 'type' | 'result'>): boolean {
  if (TYPES_AVEC_ECHANGE.includes(a.type)) return true;
  if (a.type !== 'appel') return false;
  const r = (a.result ?? '').trim();
  if (!r) return false;                                   // appel sans résultat : on ne présume pas
  if (SANS_ECHANGE.some(x => r.includes(x))) return false; // puce « sans réponse »
  return true;                                            // « Joint », « Rappel demandé », ou un compte rendu libre
}

/**
 * Statut déduit d'UNE participation. Renvoie le statut à écrire — qui peut être
 * celui déjà en place (aucun changement).
 */
export function statutDeduitParticipation(
  p: CampagneLead,
  campagne: Campagne,
  actions: LeadAction[],
  planned: PlannedAction[],
  aujourdhui: string,
): CampagneLead['statutCampagne'] {
  // Règle 1 : un statut de jugement n'est jamais touché.
  if ((STATUTS_MANUELS as readonly string[]).includes(p.statutCampagne)) return p.statutCampagne;

  const fAct = fenetreActivite(campagne, aujourdhui);
  const fSalon = fenetreSalon(campagne, aujourdhui);
  let cible = 'À contacter';

  for (const a of actions) {
    if (a.leadId !== p.leadId) continue;
    if ((a.kind ?? 'realisee') !== 'realisee') continue;
    if (!dans(a.date, fAct)) continue;
    if (actionSansDeduction(a)) continue; // « Mauvais numéro » : ni contact, ni jugement
    if (rang('Contacté sans retour') > rang(cible)) cible = 'Contacté sans retour';
    if (actionProuveUnEchange(a) && rang('Échange en cours') > rang(cible)) cible = 'Échange en cours';
  }

  // Un RDV programmé dans la fenêtre du salon : c'est l'objectif de la campagne.
  if (rdvStand(planned, p.leadId, fSalon)) cible = 'RDV confirmé';

  // Règle 2 : jamais de régression — on garde le plus avancé des deux.
  return (rang(cible) > rang(p.statutCampagne) ? cible : p.statutCampagne) as CampagneLead['statutCampagne'];
}

// ===========================================================================
// DÉDUCTION DEPUIS LE STATUT DU LEAD (19/09) — LE TROU DE S2c.
//
// CE QU'ON A RATÉ HIER : la déduction ne se déclenchait qu'à l'enregistrement
// d'une ACTION. Or l'équipe ne journalise pas ses actions — 30 appels
// enregistrés en 11 mois — elle fait avancer les STATUTS depuis la fiche
// (« Passer à : Qualifié »). Cas vérifié : un lead « Contacté », participation
// « À contacter », 0 appel 0 email. La déduction était câblée sur le chemin que
// personne n'emprunte.
//
// RÈGLE D'OR : le statut du LEAD est la vérité, le statut de CAMPAGNE en dérive.
// Jamais l'inverse — rien ici n'écrit `leads.status`, et le harnais le prouve.
//
// LA FRONTIÈRE, ET C'EST LE POINT DÉLICAT (arbitrage du 19/09) : le statut de
// campagne ne dit pas où en est le lead, il dit où en est le lead POUR CETTE
// OPÉRATION. Sur la grille du salon, 132 des 208 prospects actifs sont déjà
// « Contacté » : déduire depuis l'état afficherait « Contactés : 132 sur 157 »
// dès la constitution de la campagne, avant le moindre appel, et le commercial
// ouvrirait son écran en croyant le travail fait aux trois quarts.
//
// DONC : cette déduction-ci est un ÉVÉNEMENT, pas un calcul d'état. Elle
// s'applique aux changements de statut SURVENUS APRÈS l'entrée du lead dans la
// campagne, et à eux seuls — le reducer compare le statut d'avant à celui
// d'après et n'appelle cette fonction que pour les leads qui ont bougé. À
// l'ajout (unitaire ou en masse), personne ne change de statut : tout le monde
// entre à « À contacter », quel que soit l'état du lead. Même frontière que les
// compteurs d'appels et d'emails, bornés eux à la fenêtre de campagne.
// ===========================================================================

/**
 * Statut de campagne DÉRIVÉ du statut du lead. `null` = ce statut ne dit rien
 * de l'avancement dans la campagne, on ne touche à rien.
 *
 *   Contacté                     -> Contacté sans retour
 *   Qualifié                     -> Échange en cours
 *   Devis envoyé / Négociation /
 *   En conclusion                -> Échange en cours
 *   Reporté                      -> Projet reporté
 *   Signé / Perdu                -> null (INCHANGÉ)
 *   Nouveau / À contacter        -> null (rien à déduire)
 *
 * Signé et Perdu ne deviennent PAS « Pas intéressé » : ce serait un jugement, et
 * un client qui signe n'est pas un client qui refuse. À la place, ces leads
 * sortent de la liste de travail par défaut (voir `LigneCampagne.ferme`) et ne
 * comptent plus dans « Relances en retard ».
 */
export function statutCampagneDepuisLead(statutLead: LeadStatus): CampagneStatut | null {
  switch (statutLead) {
    case 'contacte': return 'Contacté sans retour';
    case 'qualifie':
    case 'devis_envoye':
    case 'negociation':
    case 'en_conclusion': return 'Échange en cours';
    case 'reporte': return 'Projet reporté';
    // Signé / Perdu : statut de campagne inchangé, la participation sort de la
    // liste par défaut. Nouveau / À contacter : rien à déduire.
    default: return null;
  }
}

/**
 * ÉVÉNEMENT « le lead vient de changer de statut » : ses participations aux
 * campagnes ACTIVES suivent.
 *
 * Trois garde-fous, les mêmes qu'hier :
 *  1. un statut de JUGEMENT posé à la main n'est jamais écrasé ;
 *  2. pas de RÉGRESSION : un « RDV confirmé » ne retombe pas parce que le lead
 *     repasse en « Contacté » ;
 *  3. à avancement ÉGAL, la dérivation du lead l'emporte (« Contacté sans
 *     retour » devient « Projet reporté » quand le lead passe Reporté) : c'est
 *     la même marche de l'échelle, mieux renseignée, pas un recul.
 *
 * Renvoie le tableau d'ORIGINE (même référence) si rien ne change.
 */
export function appliquerChangementStatutLead(
  campagnes: Campagne[] | undefined,
  participations: CampagneLead[] | undefined,
  leadId: string,
  statutLead: LeadStatus,
): CampagneLead[] | undefined {
  if (!participations?.length || !campagnes?.length) return participations;
  const cible = statutCampagneDepuisLead(statutLead);
  if (!cible) return participations;
  const actives = new Set(campagnes.filter(c => c.active).map(c => c.id));
  let change = false;
  const suivant = participations.map(p => {
    if (p.leadId !== leadId || !actives.has(p.campagneId)) return p;
    if ((STATUTS_MANUELS as readonly string[]).includes(p.statutCampagne)) return p;
    if (p.statutCampagne === cible) return p;
    if (rang(cible) < rang(p.statutCampagne)) return p; // régression : on garde
    change = true;
    return { ...p, statutCampagne: cible };
  });
  return change ? suivant : participations;
}

/**
 * Applique la déduction à TOUTES les participations des campagnes ACTIVES.
 * Idempotente : rappelée à chaque écriture, elle ne fait rien s'il n'y a rien à
 * faire — et renvoie alors le tableau d'origine (même référence), pour ne pas
 * provoquer de rendu inutile.
 */
export function appliquerDeductions(
  campagnes: Campagne[] | undefined,
  participations: CampagneLead[] | undefined,
  actions: LeadAction[],
  planned: PlannedAction[],
  aujourdhui: string,
): CampagneLead[] | undefined {
  if (!participations?.length || !campagnes?.length) return participations;
  const parId = new Map(campagnes.map(c => [c.id, c]));
  let change = false;
  const suivant = participations.map(p => {
    const campagne = parId.get(p.campagneId);
    if (!campagne || !campagne.active) return p;
    const statut = statutDeduitParticipation(p, campagne, actions, planned, aujourdhui);
    if (statut === p.statutCampagne) return p;
    change = true;
    return { ...p, statutCampagne: statut };
  });
  return change ? suivant : participations;
}
