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
// 'neutre' (lot 1, 2026-09) : valeur d'ENTRÉE de tout nouveau lead — « pas encore
// qualifié ». Se comporte exactement comme 'tiede' dans les alertes et risques
// (seul 'chaud' y porte une règle). froid/tiede/chaud restent valides : choix des
// commerciaux et anciennes sauvegardes restaurables.
export type Temperature = 'neutre' | 'froid' | 'tiede' | 'chaud';
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
  /**
   * Date de creation ISO (colonne d'audit de la base, exposee pour trier la
   * page Modeles du plus recent au plus ancien). OPTIONNELLE : absente des
   * modeles par defaut et des states hydrates d'avant ce lot — le tri
   * (lib/templates) les traite alors comme les plus anciens. Jamais affichee.
   */
  createdAt?: string;
  /**
   * Lot 3 — catégorie (TemplateCategory.id). Absente / inconnue = « Non classés »
   * (catégorie VIRTUELLE, toujours en tête, non renommable).
   */
  categoryId?: string;
  /**
   * Lot 3 — rang MANUEL dans sa catégorie (0 = en tête). Absent (anciens states,
   * sauvegardes d'avant le lot 3) = 0 : l'ordre retombe alors sur « plus récent
   * d'abord » (lib/templateLayout), c'est-à-dire l'ordre d'avant le lot.
   */
  position?: number;
}

/** Lot 3 — catégorie de modèles, créée / renommée / réordonnée par l'équipe. */
export interface TemplateCategory {
  id: string;
  name: string;
  /** Rang manuel des catégories (0 = première après « Non classés »). */
  position: number;
}

/**
 * Objectif de la semaine (lot 4) — COMMUN à l'équipe, 5 actifs au plus par
 * semaine, jamais supprimé (active=false = retiré). Règles : lib/weeklyObjectives.
 */
export interface WeeklyObjective {
  id: string;
  /** Lundi de la semaine, "YYYY-MM-DD". */
  weekStart: string;
  /** Ordre d'affichage dans la semaine. */
  position: number;
  /** 200 caractères au plus. */
  text: string;
  /** Porteur facultatif : commercial de l'Équipe (« Non attribué » exclu). */
  ownerId: string | null;
  done: boolean;
  /** Instant ISO où l'objectif a été coché atteint. */
  doneAt: string | null;
  /** false = retiré (jamais de suppression). */
  active: boolean;
  /** « Reprendre la semaine suivante » : objectif d'origine. */
  copiedFromId: string | null;
  /** Dernière modification faite APRÈS la fin de sa semaine (trace). */
  modifiedAfterWeekAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Nature d'une ligne d'historique (lot 2). Absent = 'realisee' (les actions
 * d'avant le lot 2).
 *  - realisee : une action vraiment faite (appel, email, RDV…) — met à jour la
 *    dernière action du lead et compte dans les objectifs ;
 *  - report : trace « prévue le X, reportée au Y » — ni dernière action, ni objectifs ;
 *  - sans_suite : « Aucune prochaine action — motif » — ni dernière action, ni objectifs.
 */
export type LeadActionKind = 'realisee' | 'report' | 'sans_suite';

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
  kind?: LeadActionKind;
  /** Action programmée que cette ligne a réalisée (« Fait » depuis l'agenda). */
  plannedActionId?: string;
}

// ---------------------------------------------------------------------------
// Actions programmées (lot 2) — la « prochaine action » devient une entité.
// ---------------------------------------------------------------------------

/**
 * a_faire : programmée, pas encore faite (en retard si la date est passée) ;
 * faite    : réalisée (reste visible, grisée, dans l'agenda) ;
 * annulee  : remplacée par « Aucune prochaine action » ou effacée — jamais
 *            supprimée (aucun DELETE), simplement plus « à faire ».
 */
export type PlannedActionStatus = 'a_faire' | 'faite' | 'annulee';
export type PlannedActionRole = 'responsable' | 'participant';

export interface PlannedActionPerson {
  commercialId: string;
  role: PlannedActionRole;
}

export interface PlannedAction {
  id: string;
  leadId: string;
  type: ActionType;
  /** Libellé libre quand type === 'autre' ; '' sinon. */
  customLabel: string;
  date: string;          // "YYYY-MM-DD"
  time?: string;         // "HH:mm" — absent = toute la journée
  endTime?: string;      // "HH:mm" — fin optionnelle
  /** Date de la PREMIÈRE programmation, jamais modifiée (les reports vont à l'historique). */
  originalDate: string;
  note: string;
  status: PlannedActionStatus;
  /** Instant ISO de la réalisation (status 'faite'). */
  doneAt?: string;
  /** Ligne d'historique créée par la réalisation. */
  doneActionId?: string;
  /** Au moins un responsable ; participants facultatifs. Chaque personne voit l'action dans son agenda. */
  people: PlannedActionPerson[];
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
  // LOT 2 : les quatre champs nextAction* ci-dessus sont désormais un RÉSUMÉ,
  // recalculé depuis l'action programmée « à faire » du lead
  // (lib/plannedActions.summarizeNextAction). Ils restent lus par les alertes,
  // la colonne Prochaine action, le tableau de bord et les relances.
  //
  // « Aucune prochaine action » choisie explicitement (motif + instant ISO).
  // Vidés dès qu'une action est programmée (le motif « expire »). Optionnels :
  // absents des leads d'avant le lot 2 (= '').
  noNextActionReason?: string;
  noNextActionAt?: string;
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
  // Prospection
  prospectsCreated: GoalMetric; // leads rentres (auto : createdAt du mois)
  coldCalls: GoalMetric;        // appels a froid (manuel : realise saisi via override)
  // Suivi
  followups: GoalMetric;     // relances (appel + relance + email + sms + whatsapp)
  meetings: GoalMetric;      // RDV/visites ('rdv' + 'visite')
  // Resultat
  revenue: GoalMetric;       // CA signe (somme quoteAmount ?? budget), en EUR
  conversionRate: GoalMetric; // taux de transformation, en %
}

/**
 * Objectifs PAR DÉFAUT de l'équipe (lot objectifs-defaut-equipe) : une seule cible
 * par indicateur, valable pour TOUS les commerciaux et TOUS les mois, réglée une
 * fois. Sert de repli quand un CommercialGoal n'a pas de `target` saisie pour
 * (commercial, mois) — cf. effectiveTarget (lib/goals). null = pas de défaut.
 */
export interface DefaultGoal {
  prospectsCreated: number | null;
  coldCalls: number | null;
  followups: number | null;
  meetings: number | null;
  revenue: number | null;
  conversionRate: number | null;
}

// ============================================================
// Import email — chantier « Boîte de réception prospects » (Étape A, maquette).
// Types VOLONTAIREMENT hors AppState : la démo vit en mémoire (fixtures +
// InboundDemoProvider, réinitialisée au rechargement). Rien n'est persisté tant
// que la collecte réelle (Microsoft Graph, Étape B) n'existe pas — seuls les
// leads ACCEPTÉS entrent dans le CRM, par le addLead normal.
// ============================================================

/**
 * Cycle de vie d'un email de la file d'import.
 *  - `a_traiter` : en attente d'une décision humaine ;
 *  - `accepte`   : un NOUVEAU lead a été créé ;
 *  - `rattache`  : la demande a été ajoutée à un lead EXISTANT (retour terrain
 *    2026-08 : un prospect qui refait la même demande ne doit pas créer de
 *    doublon, et son message ne doit pas être perdu) ;
 *  - `rejete`    : écarté. SEUL état réversible (« remettre en file »), parce
 *    qu'il n'a créé aucune donnée à défaire.
 */
export type InboundStatus = 'a_traiter' | 'accepte' | 'rejete' | 'rattache';

/** Champs extraits d'un email entrant — ÉDITABLES sur la carte avant acceptation. */
export interface InboundExtracted {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  boatInterest: string;   // modèle / annonce concernée
  brand: string;
}

/** Un email entrant analysé, en attente de validation humaine (spec §5-§6). */
export interface InboundEmail {
  id: string;
  receivedAt: string;      // "YYYY-MM-DD HH:mm" — tri et affichage en chaîne
  fromAddress: string;
  subject: string;
  /** Extrait du message (corps nettoyé) : affiché sur la carte, versé aux commentaires du lead. */
  excerpt: string;
  /** Famille de source détectée via l'expéditeur (libellé d'affichage, spec §1). */
  sourceLabel: string;
  /** Plateforme réelle quand la source la précise (ex. YachtWorld via boats.com). */
  sourceDetail?: string;
  /** Valeur versée dans Lead.source à l'acceptation — invariant : appartient à SOURCES (harnais). */
  leadSource: string;
  /** Score de pertinence 0..100 (spec §3) : la file est triée décroissant. */
  score: number;
  /** Signaux expliquant le score, affichés sur la carte (le score aide, l'humain décide). */
  scoreReasons: string[];
  extracted: InboundExtracted;
  status: InboundStatus;
  /** Id du lead créé à l'acceptation, ou du lead visé au rattachement. */
  leadId?: string;
  /**
   * Instant du DERNIER traitement (accepté / rejeté / rattaché), en ISO UTC.
   * Vient de `inbound_emails.updatedAt`, qui existait déjà en base mais n'était
   * pas exposé : la section « Traités » ne montrait donc que le statut, jamais
   * QUAND (retour terrain). Absent tant que l'email est « à traiter ».
   */
  processedAt?: string;
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
  // Objectifs par défaut de l'équipe (cibles communes). Absent des anciens states
  // -> hydrate en EMPTY_DEFAULT_GOAL (migration nulle, voir getInitialState).
  defaultGoal: DefaultGoal;
  // Actions programmées (lot 2). Absent des anciens states et des sauvegardes
  // d'avant le lot 2 -> hydraté en [] puis repris depuis les champs nextAction*
  // des leads (lib/plannedActions.migrateLegacyNextActions, idempotent).
  plannedActions: PlannedAction[];
  // Catégories de modèles (lot 3). Absent des anciens states et des sauvegardes
  // d'avant le lot 3 -> tous les modèles sont « Non classés ».
  templateCategories?: TemplateCategory[];
  // Objectifs de la semaine (lot 4). Absent des anciens states et des
  // sauvegardes d'avant le lot 4 -> [].
  weeklyObjectives?: WeeklyObjective[];
}
