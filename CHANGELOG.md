# Changelog

Toutes les évolutions notables de **CRM Brest Ocean Boat**.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/) ; versionnage [SemVer](https://semver.org/lang/fr/).

App : SPA React + Vite + TypeScript, persistance localStorage, déployée sur GitHub Pages.

---

## [3.21.2] — 2026-07-02 — Lot 4 complet : API portier déployée (Vercel + Turso UE)

### Technique
- **Chantier migration — Lot 4 terminé** : l'**API portier est en ligne sur Vercel**
  (compte client BrestOceanBoat, option A même origine que l'app) et la **base Turso
  région UE (Irlande `aws-eu-west-1`)** est opérationnelle (schéma poussé, base vierge
  D9). Smoke test vert (`GET /api/state` renvoie les collections vides depuis Turso).
  Le CRM des commerciaux (GitHub Pages) reste inchangé (base path conditionnel).
- **API regroupée en 1 fonction** (`api/[...slug].ts`, catch-all) pour tenir sous la
  limite Hobby (12 fonctions) — mêmes URLs publiques, mêmes réponses (24→37 assertions
  de contrat au harnais, dont routage).
- **Corrections de déploiement** :
  - `vercel.json` sans propriété hors-schéma (`//`).
  - **Compatibilité ESM** (`"type":"module"` → Vercel exécute en ESM strict) : extensions
    `.js` sur les imports relatifs de `api/` + **découplage runtime de `src/`** (enums et
    `EMPTY_DEFAULT_GOAL` réinlinés ; seuls les types sont importés). Corrige
    `ERR_MODULE_NOT_FOUND`.
  - **Routage via `req.url`** (et non `req.query.slug`, non peuplé pour une fonction
    `@vercel/node` brute) — corrige le « Ressource manquante » généralisé. Le harnais
    teste désormais le **mécanisme réel** (parse d'URL Vercel) → plus de décalage
    test/prod.
- **Suivi sécurité** consigné : régénérer `TURSO_AUTH_TOKEN` + `API_SHARED_TOKEN` à froid
  avant le go-live (cf. `docs/migration/02-plan-migration.md`).
- **Non-régression** : API **non branchée** au client (le CRM tourne toujours sur
  localStorage — bascule = Lot 5). build + lint + api:typecheck + 8 harnais verts.

---

## [3.21.1] — 2026-07-02 — Préparation déploiement Vercel (base path conditionnel)

### Technique
- **Chantier migration — Lot 4 (prépa déploiement)** : ajustements de build pour héberger
  l'app **et** l'API sur Vercel (même origine), **sans casser GitHub Pages** pendant la
  transition.
- **Base path conditionnel** (`vite.config.ts`) : `process.env.VERCEL ? '/' : '/boat/'`.
  Sur Vercel l'app est servie à la racine (`'/'`) ; sur GitHub Pages / local elle reste
  sous `'/boat/'` (inchangé). Les **deux cibles restent correctes en même temps** →
  aucune fenêtre de casse (le CRM des commerciaux sur Pages ne bouge pas). Le `HashRouter`
  fonctionne à la racine (routing par hash, indépendant du base path).
- **Script `vercel-build`** (`package.json`) : `prisma generate && …build` — Vercel
  l'utilise à la place de `build`, garantissant la génération du client Prisma pour les
  fonctions `/api` (Pages continue d'utiliser `build`, inchangé).
- **Prouvé** : `npm run build` → assets en `/boat/assets/…` ; `VERCEL=1 npm run build` →
  assets à la racine `/assets/…`. lint + 8 harnais verts.

---

## [3.21.0] — 2026-07-02 — API par entité, portier Turso (Lot 4 migration, partie code)

### Technique
- **Chantier migration — Lot 4 (partie code, local)** : mise en place de l'**API par
  entité** qui servira de **portier** entre l'app et la base (décision **D10** : synchro
  **optimiste**, **API par entité**, conflits **last-write-wins**). L'app ne parlera
  **jamais** directement à Turso : elle passera par l'API, seule détentrice du secret.
- **`api/`** (Vercel Functions, hors bundle Vite) : factory Prisma **adaptateur libSQL**
  (Turso si `TURSO_*`, sinon `file:./dev.db` en local) ; enveloppe de route avec **garde
  par jeton `API_SHARED_TOKEN`** (en attendant l'auth du Lot 7) ; validation applicative
  des enums ; couche d'accès + **mappers domaine↔Prisma** (audit masqué, `GoalMetric`
  aplati, `null`/`undefined`, sentinelles `''`). Routes **CRUD par entité** + **batch**
  (goals, monthly-stats, default-goal) + **`/api/state`** (hydratation).
- **Serveur mince** : la logique métier dérivée (jalons, `lastActionDate`, min-1 modèles)
  reste dans le **reducer partagé** côté client ; seuls invariants côté base = **cascade
  FK** et **clés UNIQUE**.
- **Prouvé en local, sans cloud** : harnais de contrat (`scripts/harness-api.ts`, base
  libSQL fichier jetable) — **24 assertions** (CRUD, cascade, UNIQUE, batch, garde d'enum).
  build + lint + `api:typecheck` + **8 harnais (451 assertions)** verts.
- **Zéro impact** : API **non branchée** (le CRM reste sur localStorage / GitHub Pages),
  aucun fichier `src/` touché, bundle applicatif inchangé. **Aucune base Turso ni projet
  Vercel créés** à ce stade (étape web à venir : base **région UE — Paris `cdg`**).

---

## [3.20.1] — 2026-07-02 — Couche repository (Lot 3 migration)

### Technique
- **Chantier migration — Lot 3** : introduction d'une **couche d'abstraction
  `CrmRepository`** (`src/lib/repository.ts`) entre l'application et le stockage.
  **Refactor iso-comportement** : aucune donnée, aucune source, aucun comportement
  ne change — seule l'indirection est ajoutée. `AppContext` route désormais **toutes**
  les opérations de données par cette interface (plus d'appel direct au stockage ni de
  `dispatch` inline), avec une implémentation localStorage adossée au **reducer +
  `saveState` existants**. C'est la **couture** qui permettra, au Lot 5, de brancher
  une implémentation « API/base » derrière le **même** contrat.
- **`dispatch` brut retiré** de la surface du contexte (contournement fermé) ; la
  gestion des commerciaux passe par de nouveaux hooks
  `addCommercial`/`updateCommercial`/`toggleCommercial`. Le **reducer est inchangé**
  → tous les effets dérivés (jalons de dates, cascade suppression, garde-fou min-1
  modèles, `lastActionDate` non-régressif) sont préservés.
- **Décision produit actée (D9)** : la base démarrera **vierge** (données de dev
  jetables) ; les vraies données viendront via un **import Excel post-bascule**. En
  conséquence le **Lot 2** (export/réimport localStorage) est **supprimé** et le
  **Lot 6** (cutover) devient trivial. Cf. `docs/migration/`.
- **Iso-comportement prouvé** : build + lint + 7 harnais (427 assertions) verts.

---

## [3.20.0] — 2026-07-02 — Infra : schéma Prisma des 8 modèles (Lot 1 migration)

### Technique
- **Chantier migration — Lot 1** : mise en place de l'infrastructure base de données
  **en parallèle**, sans aucun impact sur le CRM (qui continue de tourner à 100 % sur
  localStorage). **Zéro-impact prouvé** : build + lint + 7 harnais verts, bundle
  applicatif **byte-identique** (rien de Prisma n'entre dans `src/` ni dans le bundle).
- **`prisma/schema.prisma`** : traduction fidèle de la cartographie en 8 modèles
  (`Commercial`, `Lead`, `LeadAction`, `MessageTemplate`, `MonthlyStat`,
  `CalendarEvent`, `CommercialGoal`, `DefaultGoal`) sur provider Turso/libSQL
  (Prisma 7). IDs `TEXT`, enums en `String`, sentinelles `''` conservées, dates
  métier en `String` ISO, audit `createdAt`/`updatedAt`, FK + cascade
  `lead → lead_actions`, clés uniques naturelles, `GoalMetric` aplati en 12 colonnes.
- **Outillage isolé** : `prisma`/`@prisma/client` en devDependencies, scripts `db:*`
  (build non touché), `prisma.config.ts`, `.env.example`, migration **locale** de dev
  (`dev.db`) générée. **Aucune base Turso de production créée** à ce stade.
- Cf. `docs/migration/` (cartographie, décisions, plan séquencé).

---

## [3.19.3] — 2026-07-02 — Finitions UX (audit fraîcheur)

### Ajouté
- **Recherche Pipeline alignée sur la liste Leads** : le Pipeline matche désormais aussi
  **email, téléphone et marque** (en plus du nom et du bateau recherché). Prédicat de
  recherche **factorisé** dans un helper partagé (`leadMatchesSearch`) pour que les deux
  écrans ne divergent plus.
- **Envoi de message vierge toujours possible** : dans les menus Email / SMS / WhatsApp de
  la fiche lead, l'entrée « … vierge (sans modèle) » est désormais **toujours proposée**,
  en plus des modèles existants (auparavant visible uniquement en l'absence de modèle).

### Modifié
- **Doublon de boutons nettoyé** : sur la liste Leads, le bouton crayon « Modifier »
  (identique à « Voir ») est retiré — l'édition reste accessible depuis la fiche. Sur la
  fiche lead, « Relancer » ouvre maintenant l'**éditeur de prochaine action** (planifier),
  distinct de « Ajouter action » (journaliser une action réalisée).

---

## [3.19.2] — 2026-07-02 — Agenda : grille horaire sur 24h

### Modifié
- **Grille horaire de l'Agenda sur 24h** (0h → 24h) dans les vues **Semaine** et
  **Journée**, au lieu de la plage limitée 8h–18h. Les actions **tôt matin / soir**
  qui tombaient auparavant dans le bandeau « hors plage » s'affichent désormais
  **positionnées sur la grille** ; le bandeau ne reçoit plus que les actions **sans
  heure** (« toute la journée »). La vue **Mois** est inchangée.
- **Conteneur scrollable** : la grille (plus haute) défile dans une zone bornée avec
  **en-tête de colonnes figé** (sticky), et **s'ouvre sur les heures ouvrées** (ancrage
  à 8h) pour ne pas apparaître sur minuit.

### Technique
- Plage pilotée par `AGENDA_HOUR_START = 0` / `AGENDA_HOUR_END = 24` ; nouvelle
  constante `AGENDA_SCROLL_TO_HOUR = 8` (offset visuel du scroll, indépendant de la
  plage). Aucun changement de modèle : les helpers purs (`buildTimeSlots`,
  `layoutDayGrid`, `startSlotIndex`, `shift`/`resize`) dérivent des constantes.
  Section Agenda du harnais réécrite pour la plage 0–24 (+ cas START=0) ; 418
  assertions vertes.

---

## [3.19.1] — 2026-07-02 — Liste Leads : colonne « Prochaine action »

### Ajouté
- **Colonne « Prochaine action » triable** dans la liste Leads (entre « Dern. action »
  et « Actions »), affichant **type + date** (`formatDateShort`). Le **1er clic trie en
  ascendant** : échéances les plus proches en haut, leads sans date en dernier
  (« qui relancer en premier »).

### Modifié
- Cellule « Dern. action » **nettoyée** : le type de prochaine action y était dupliqué,
  retiré (ne reste que les jours). Cas sans prochaine action : **tiret discret**, rangé
  en dernier au tri.

---

## [3.19.0] — 2026-06-19 — Objectifs par défaut de l'équipe

### Ajouté
- **Objectifs par défaut communs à l'équipe** : une **cible par indicateur** réglée une seule
  fois (nouvel écran **Paramètres → « Objectifs par défaut »**, route `/objectifs-defaut`),
  **reconduite automatiquement chaque mois pour chaque commercial**.
  - **Cascade à 2 niveaux pour la cible** : une cible saisie sur la page Objectifs
    (un commercial, un mois) **prime** ; sinon le **défaut équipe** s'applique. `0` est une
    surcharge explicite (exemption) qui prime aussi.
  - **Affichage** : sur Objectifs et Espace commercial, la **progression (barre / %) utilise la
    cible effective** ; une case de cible vide montre le **défaut équipe** (placeholder grisé +
    mention discrète « · défaut équipe »).

### Technique
- Nouvelle entité `AppState.defaultGoal` (`DefaultGoal` : 6 cibles `number | null`) +
  `EMPTY_DEFAULT_GOAL`, action `SAVE_DEFAULT_GOAL`, hook `saveDefaultGoal` ; hydratation
  `defaultGoal ?? EMPTY_DEFAULT_GOAL` (**migration nulle**, `STORAGE_KEY` intouchée). Logique
  **pure** `effectiveTarget(target, defaultTarget)` (`lib/goals`) **réutilisée partout** —
  aucun recalcul, le **réalisé (auto + override) est inchangé**. Harnais `goals` porté à **49**
  (surcharge prime, défaut seul, les deux null, `0` des deux côtés).

---

## [3.18.0] — 2026-06-19 — Menu en sections repliables

### Modifié
- **Menu de gauche réorganisé en 3 sections** à titre cliquable (chevron) :
  **Pilotage** (Dashboard, Performance, Objectifs, Acquisition) et **Commercial**
  (Espace commercial, Leads/Prospects, Clients, Pipeline, À relancer, Agenda)
  ouvertes par défaut ; **Paramètres** (Équipe, Modèles, Exports) repliée.
  - État repli/déplié **par session** (pas de persistance) : repart du défaut au
    chargement. Routes, libellés, icônes et état actif (`NavLink`) inchangés.

### Technique
- `Sidebar.tsx` uniquement : `mainNav`/`settingsNav` remplacés par une structure
  `sections[]` (`{ id, label, defaultOpen, items[] }`) + état local `useState`.
  `renderItem`, logo, pied de page et overlay mobile conservés. Aucune logique
  métier → aucun harnais impacté.

---

## [3.17.0] — 2026-06-19 — Espace commercial

### Ajouté
- **Nouvelle page « Espace commercial »** (menu + route `/espace-commercial`) : une vue de
  **synthèse par commercial** qui regroupe, pour le commercial sélectionné, ses **Objectifs**,
  ses **Performances**, son **Pipeline** et son **Agenda** sur un mois choisi.
  - **Objectifs** : les 6 indicateurs condensés (réalisé / objectif / %), lecture seule.
  - **Performances** : CA signé + taux de transformation du mois.
  - **Pipeline** (état courant) : compteurs de leads par statut + leads chauds.
  - **Agenda** (à venir) : prochaines actions/RDV + événements libres du commercial.
  - Sélecteur de commercial mis en avant (en-tête + pastille couleur) ; le mois pilote
    Objectifs/Performances, le Pipeline reste l'état courant, l'Agenda le à-venir.

### Technique
- **Page d'agrégation pure** : elle réutilise et filtre l'existant (`lib/goals`,
  `buildAgendaEvents`, `LEAD_STATUSES`, helpers de filtrage), **aucune logique métier
  nouvelle**. Au backend, seule la source changera (poste → base partagée) + le sélecteur
  deviendra le login. **Extraction de composants partagés** : `CommercialHeader` (en-tête
  commercial) et `MetricCard` (+ mode `compact`) / `metricsConfig`, consommés par Objectifs
  ET Espace commercial — `ObjectifsPage` refactorisée à comportement identique. Les 6 harnais
  restent verts (389) : la page n'agrège que de la logique déjà testée.

---

## [3.16.0] — 2026-06-19 — Objectifs : prospection & auto-log

### Modifié
- **Objectifs refondus en 6 indicateurs / 3 familles** : **Prospection**
  (Leads rentrés, Appels à froid) · **Suivi** (Relances, RDV/visites) · **Résultat**
  (CA signé, Taux de transformation). L'ancien indicateur « Appels » seul disparaît
  (fondu dans Relances). Page réorganisée par sections, carte « Appels à froid »
  avec **saisie manuelle du réalisé**.
- **« Leads rentrés » = prospection active uniquement** : ne comptent que les leads
  créés dans le mois dont la source ∈ `PROSPECTION_SOURCES` (Passage, Salons,
  Démarchage terrain, Recommandation). Le flux entrant et les leads sans source
  ne comptent pas.

### Ajouté
- **2 sources** : `Démarchage terrain`, `Recommandation`. **Source obligatoire** à la
  création d'un lead (validation `LeadForm`, 2 rendus).
- **Auto-log de l'appel** : cliquer « Appeler » crée une action `appel` (comme
  email/SMS/WhatsApp le font déjà) → alimente l'indicateur **Relances** sans saisie
  manuelle. Tentative supprimable, sans confirmation.

### Technique
- `CommercialGoal` : `calls` retiré, `prospectsCreated`/`coldCalls` ajoutés ;
  migration `hydrateGoals` (anciennes cibles `calls` abandonnées proprement, défauts,
  `STORAGE_KEY` intouchée). `FOLLOWUP_TYPES += 'appel'` (un seul compteur recontact).
  Helper **pur** `buildCommunicationAction` (`lib/communication`) factorise les 3
  handlers de communication (comportement identique — harnais reducer inchangé).
  Logique de calcul **pure** (`lib/goals`) — cœur réutilisable au backend. Harnais :
  **goals 43**, **communication 14** (nouveau). ⚠️ *Classement de « Recommandation »
  en prospection active à confirmer (rebasculable en flux entrant sans migration).*

---

## [3.15.0] — 2026-06-19 — Objectifs commerciaux

### Ajouté
- **Nouvelle page « Objectifs »** (menu + route `/objectifs`, icône `Target`) :
  Nicolas définit des **cibles par commercial et par mois** (appels, relances,
  RDV/visites, CA signé, taux de transformation) et un **suivi visuel** montre la
  réalisation.
  - **Réalisé calculé AUTOMATIQUEMENT** depuis les données du poste (actions du
    pipeline + leads signés), **corrigeable à la main** (override par indicateur
    qui prime, sans écraser le calcul auto).
  - **Tableau de bord par cartes** : en-tête commercial mis en avant (pastille
    avatar + nom + période), une carte par indicateur avec **réalisé en gros
    chiffre coloré**, barre de progression et **% en code couleur**
    (vert ≥100 / orange ≥70 / rouge <70). Zone de **saisie repliable** séparée.
  - **Garde anti-perte** : confirmation au changement de mois/commercial et
    `beforeunload` tant que des modifications sont en attente.

### Technique
- Entité **`CommercialGoal`** (cible + override par indicateur) ajoutée à
  `AppState.goals` + action `SAVE_GOALS` ; hydratation `goals: stored.goals ?? []`
  (**migration nulle**, `STORAGE_KEY` intouchée). Toute la logique de calcul est
  **PURE** (`lib/goals` : `computeAutoRealized`, `applyOverrides`, `progressPct`,
  `progressLevel`, comptage par type d'action, CA signé, taux de transfo) —
  **cœur réutilisable au backend** : seule la SOURCE des données changera (poste →
  base partagée), pas les calculs ni l'UI. Données **mono-poste** assumées en
  démonstration. Couvert par un nouveau harnais **`harness-goals` (35)**.

---

## [3.14.0] — 2026-06-19 — Refonte Acquisition (source de vérité unique)

### Modifié
- **Page Acquisition refondue** : **2 onglets** (Saisie / Tableau de bord) au lieu
  de 3, plus de **double saisie** des leads.
  - **Saisie par mois sélectionné** (navigation ‹ ›) : **une ligne par source**,
    regroupées **Régies** (budget + leads → CPL) puis **Plateformes d'annonces**
    (leads seuls), avec **totaux du mois** (budget, leads, CPL moyen). Fini la
    grille 12 mois × 36 colonnes qui débordait.
  - **Tableau de bord unifié** sur **toutes les sources** (régies + plateformes) :
    KPI, graphes mensuels, récap par source. CPL **moyen = budget / leads payants**.

### Ajouté
- **Garde anti-perte de saisie** : confirmation avant de quitter l'onglet Saisie
  avec des modifications non enregistrées, et avertissement natif (`beforeunload`)
  avant fermeture/rechargement. (Navigation interne SPA hors périmètre : HashRouter
  sans data router.)

### Technique
- **UNE seule source de vérité** par (année, mois, source) : `acquisitionVolumes`
  **fusionné dans** `monthlyStats` via `mergeAcquisition` — migration **idempotente,
  sans perte**, `STORAGE_KEY` intouchée. Champ `cpl` **retiré du modèle** (DÉRIVÉ via
  `computeCpl`, jamais stocké). `AcquisitionVolume` / `SAVE_ACQUISITION_VOLUMES` /
  `saveAcquisitionVolumes` supprimés (type *legacy* conservé pour la lecture des
  anciens states). Export Acquisition sort enfin **toutes** les sources. Logique
  **pure** (`lib/acquisition` : `computeCpl` / `acquisitionTotals` / `mergeAcquisition`
  / `isPaidSource`) couverte par un nouveau harnais **`harness-acquisition` (33)**.

---

## [3.13.1] — 2026-06-19 — Horizon des années dynamique

### Corrigé
- **Sélecteur d'année** (stats acquisition) borné à ±1 an (plafonnait toute saisie
  future) → **plage DYNAMIQUE glissante** (année courante −5 / +50) via la fonction
  pure `buildYearRange`. Plus aucune année en dur, plus jamais de plafond à
  reconduire. Couvert par un harnais **`harness-dates` (14)**.

---

## [3.13.0] — 2026-06-17 — Événements d'agenda libres

### Ajouté
- **Événements d'agenda non liés à un lead** (réunion, congé, déplacement, bloc
  perso) : nouvelle entité `CalendarEvent` indépendante, affichée dans la même
  grille horaire que les actions, **distinguée par catégorie** (couleur + icône)
  et **assignable à un commercial ou générale** (équipe).
  - **Création** : clic sur un créneau → choix « Action de lead » / « Événement ».
  - **Modale** : titre, date, heure, fin, commercial, catégorie, note +
    **suppression** (un événement se supprime librement, contrairement à un lead).
  - **Gestes** : drag par créneau (change jour + heure, durée préservée) et
    resize à la poignée (change la fin), comme les actions ; en Journée le drag
    change l'heure sans toucher au commercial. Présents dans les 3 vues
    (Semaine/Mois/Journée) ; all-day et hors-plage non perdus (bandeau).

### Technique
- Entité **isolée** (tableau `state.calendarEvents` + actions reducer dédiées
  `ADD/UPDATE/DELETE_CALENDAR_EVENT`, confinées) pour un **rebranchement backend**
  ultérieur — seul le lieu de lecture/écriture changera ; données **mono-poste**
  assumées en test localStorage. Migration **nulle** (tableau absent → `[]`, N1
  préservé). Affichage unifié via un `GridItem` (`kind: 'lead' | 'event'`) ;
  `layoutDayGrid`/`groupEventsByDay` rendus génériques ; gestes routés par `kind`
  (`setNextAction` vs `updateCalendarEvent`), helpers purs réutilisés. Harnais
  reducer porté à **198** (migration, CRUD confiné, drag/resize via gesture).

---

## [3.12.0] — 2026-06-17 — Redimensionner un bloc à la poignée

### Ajouté
- **Poignée de redimensionnement** en bas de chaque bloc de la grille horaire
  (vues Semaine et Journée) : tirer vers le bas **allonge** la durée, vers le
  haut la **raccourcit** (par pas de 30 min), avec **aperçu en direct**.
  **Souris et tactile** (Pointer Events + capture du pointeur). L'heure de
  **début ne bouge pas** (seule la fin change) ; durée **minimale 30 min** ;
  la fin est **clampée à 18h**. Plus besoin de passer par le champ « Fin ».

### Technique
- Poignée = élément dédié (frère du chip) avec ses propres pointer events +
  `stopPropagation`/`touch-action:none` → cohabite sans conflit avec les 3 gestes
  existants (clic-fiche, clic-création, drag-déplacement). Helper pur
  `resizeEventBySlots` (min 1 créneau, clamp fin de plage, début fixe). Écriture
  via la seule action `SET_NEXT_ACTION` (seul `nextActionEndTime` change). Harnais
  reducer porté à **176** (étirer/raccourcir/min/clamp/ponctuel + contrat ; cas
  existants verts).

---

## [3.11.0] — 2026-06-17 — Drag par créneau (jour + heure)

### Ajouté
- **Glisser-déposer par créneau** dans la grille horaire : déplacer un bloc change
  désormais le **jour ET l'heure** (avant : le jour seul). La **durée est
  préservée** — un bloc 10:00–11:00 déposé à 13:00 devient 13:00–14:00. Un
  glisser horizontal pur change le jour en gardant l'heure. Si le bloc
  déborderait après 18h, il est **calé** pour rentrer (fin = 18h max, durée
  intacte).
- **Drag activé en vue Journée** : glisser verticalement un bloc change son
  **heure** (la date reste le jour affiché ; le **commercial ne change jamais**).
  Le bouton re-sélecteur de date reste disponible sur le bloc pour changer le
  jour. Les actions « toute la journée » / hors-plage ne changent que de jour.
- Les trois gestes cohabitent sans conflit : clic court → fiche, clic sur une
  cellule vide → création, glisser réel → déplacement.

### Technique
- 1 droppable par colonne (le jour) + créneau déduit du déplacement vertical
  (`Math.round(event.delta.y / SLOT_PX)`) — pas de multiplication des droppables.
  Helpers purs `startSlotIndex` et `shiftEventBySlots` (décalage, durée préservée,
  clamp dans la plage). Écriture via la seule action `SET_NEXT_ACTION`. Harnais
  reducer porté à **166** (décalage / clamp haut-bas / ponctuel / hors-plage /
  contrat drag + non-régression drag inter-jours ; cas existants verts).

---

## [3.10.0] — 2026-06-17 — Durée des actions (blocs horaires)

### Ajouté
- **Heure de fin optionnelle** sur la prochaine action d'un lead → lui donne une
  **durée**. L'éditeur (fiche lead) et le créateur (agenda) gagnent un champ
  « Fin » (grisé tant qu'aucune heure de début) ; l'enregistrement est **bloqué
  avec un message** si la fin n'est pas postérieure au début. Affichage
  « de 14:00 à 16:00 ». Absence de fin = action ponctuelle (comportement
  inchangé).
- **Blocs horaires dans la grille** (vues Semaine/Journée) : une action avec
  durée s'affiche comme un **bloc qui s'étire** sur ses créneaux (8h→10h = 4
  créneaux). Fin au-delà de la plage **clampée à 18h**. Les actions qui se
  **chevauchent** dans le temps se placent **côte à côte en couloirs** (largeurs
  égales). Le drag (replanification) **préserve l'heure et la durée**.

### Technique
- Champ **séparé** `Lead.nextActionEndTime?: "HH:mm"` — `nextActionDate` et
  `nextActionTime` intouchés. Écriture via la seule action `SET_NEXT_ACTION`
  (`setNextAction(id, type, date, time?, endTime?)`). Migration localStorage
  **nulle**. `TimeGrid` réécrit en **column-major + positionnement absolu** ;
  helper pur `layoutDayGrid` (span, clamp, fallback span 1, couloirs de
  chevauchement) + `isEndAfterStart`. Drag = une droppable par colonne (niveau
  jour). Harnais reducer porté à **148** (durée + grille + validation ; isolation
  et cas existants verts).

---

## [3.9.0] — 2026-06-17 — Agenda en grille horaire

### Ajouté
- **Vues Semaine et Journée en grille horaire** (type Google Agenda) : axe
  vertical des heures **8h-18h**, créneaux de 30 min. La **Journée** reste
  **comparative** (une colonne par commercial, « réunion du lundi » + créneaux) ;
  la **Semaine** affiche 7 colonnes jour × heures, défilable horizontalement sur
  mobile. La vue **Mois** est inchangée (pastilles).
- **Bandeau « toute la journée »** en haut de la grille pour les actions sans
  heure, et **report des actions hors plage** (avant 8h / après 18h) dans ce même
  bandeau avec leur heure réelle — aucune action n'est jamais masquée.
- **Clic sur un créneau → création avec heure pré-remplie** (modifiable) : le
  créateur (lead + type) s'ouvre avec l'heure du créneau cliqué ; clic sur le
  bandeau → action « toute la journée ». Le sélecteur reste filtré sur les leads
  sans action planifiée. Création active en Semaine **et** Journée.
- Le **drag** de replanification (Semaine) est conservé au **niveau jour** :
  glisser vers un autre jour change la date, l'heure est préservée. (Le drag
  par créneau pour changer l'heure est un raffinement futur.)

### Technique
- Plage horaire en **constantes** (`AGENDA_HOUR_START`, `AGENDA_HOUR_END`,
  `AGENDA_SLOT_MIN`) — réglage en une ligne (un onglet Paramètres serait un lot
  séparé). Helpers purs `lib/agenda.ts` : `buildTimeSlots`, `eventSlot`
  (détection hors-plage), `layoutDayEvents` (sans perte). Composant `TimeGrid`
  réutilisable (Semaine + Journée). Écriture toujours via la seule action
  `SET_NEXT_ACTION`. Harnais reducer porté à **121** (grille + création depuis
  un créneau ; isolation et cas existants verts).

---

## [3.8.0] — 2026-06-17 — Heure sur les actions

### Ajouté
- **Heure optionnelle sur la prochaine action d'un lead** : l'éditeur « Prochaine
  action » (fiche lead) gagne un champ heure facultatif à côté de la date (grisé
  tant qu'aucune date n'est posée). Absence d'heure = « toute la journée »
  (comportement historique strictement inchangé).
- **Agenda — affichage et tri horaires** : l'heure apparaît dans les pastilles
  (`14:00 · RDV`), et les actions d'un même jour sont triées **sans-heure
  d'abord puis par heure croissante** (convention Google/Outlook), dans les 3
  vues. La replanification (glisser en Semaine, re-sélecteur en Mois/Journée)
  **conserve l'heure** (seule la date change).

### Technique
- Champ **séparé** `Lead.nextActionTime?: "HH:mm"` — `nextActionDate` reste un
  `"YYYY-MM-DD"` comparé en chaîne (`hasFutureNextAction`, `eventStatus`,
  `groupEventsByDay`, tris) : aucune de ces comparaisons n'est touchée. Écriture
  toujours via la seule action `SET_NEXT_ACTION` (signature `setNextAction(id,
  type, date, time?)`). Migration localStorage **nulle** (champ optionnel,
  absent = all-day). Harnais reducer porté à **103** (créer avec/sans heure,
  replanifier type+heure préservés, effacer date+heure ensemble ; isolation et
  cas agenda existants verts).

---

## [3.7.0] — 2026-06-17 — Agenda

### Ajouté
- **Page Agenda** (entrée de menu dédiée, `CalendarDays`) avec **3 vues
  commutables** des prochaines actions planifiées des leads (les actions échues
  sont signalées) :
  - **Semaine** : 7 jours lundi→dimanche, navigation semaine.
  - **Mois** : grille calendaire classique, pastilles compactes par jour avec
    repli « +N de plus ».
  - **Journée comparative** : une colonne par commercial côte à côte (vue
    « réunion du lundi »), colonnes vides affichées, colonne « Autres » de
    secours pour un événement dont le commercial n'est plus dans les colonnes
    (aucune action masquée).
- **Couleur par commercial** déterministe (palette par position, rien à
  persister) + **filtre par commercial** et légende, partagés par les 3 vues.
- **Interactif** (écriture exclusivement via `SET_NEXT_ACTION`, aucune nouvelle
  action reducer) :
  - **Créer** : clic sur une date → sélecteur type + lead. Le lead ne propose
    que les leads actifs **sans action déjà planifiée** → l'écrasement du créneau
    unique est impossible par construction (pas de confirmation). Message clair
    si aucun lead éligible.
  - **Replanifier** : glisser-déposer (`@dnd-kit/core`) en vue Semaine ;
    re-sélecteur de date en vues Mois et Journée (cellule unique / cellules
    denses). Le type d'action est préservé, seule la date change.
- Le clic sur un événement (clic court, distinct du glisser) ouvre la fiche lead.

### Technique
- `lib/agenda.ts` (helpers purs) : `getCommercialColor`, `eventStatus`,
  `buildAgendaEvents` (leads actifs uniquement), `groupEventsByDay`,
  `getCreatableLeads`. Grilles construites avec date-fns (aucune dépendance
  calendrier ajoutée). Harnais reducer porté à 91 assertions (créer /
  replanifier / éligibles, isolation `SET_NEXT_ACTION` préservée).

---

## [3.6.0] — 2026-06-17 — Bouton WhatsApp

### Ajouté
- **Bouton WhatsApp sur la fiche lead**, miroir strict des boutons Email et SMS :
  menu déroulant des modèles de type WhatsApp (repli « WhatsApp vierge (sans
  modèle) » si aucun), interpolation des variables du lead via les modèles, et
  **journalisation d'une action `whatsapp`** dans l'historique. Le bouton est
  grisé (avec libellé explicatif) en l'absence de numéro. Le lien `wa.me` ouvre
  un **nouvel onglet** (`window.open`), le CRM reste ouvert — contrairement aux
  schémas `mailto:`/`sms:` qui délèguent à une app externe.
- **Modèles de type WhatsApp** (`TemplatesPage`) : bouton « + Modèle WhatsApp »,
  badge vert distinct (icône bulle), pas de champ sujet (comme le SMS). Le type
  est figé à la création et persisté.
- **`lib/whatsapp.ts`** : `buildWhatsApp(phone, body)` →
  `https://wa.me/<numéro_international>?text=<corps_encodé>`. Helper `toWaNumber`
  convertit le numéro au format international **sans `+` ni `0`** exigé par
  wa.me : `06… → 336…`, `+33… → 33…`, `0033… → 33…`, numéro déjà international
  inchangé. Indicatif par défaut **33 (France)** ; limite documentée : un numéro
  national étranger sans indicatif est présumé français (à saisir en `+xx`).

### Technique
- `ActionType` et `TemplateType` étendus de `'whatsapp'` ; `ACTION_TYPES` enrichi
  (propagation automatique aux formulaires et à l'historique).
- **Migration sûre** (`hydrateTemplates`) : un modèle WhatsApp stocké est
  **préservé** au rechargement (jamais réécrit en email) ; tout type inconnu ou
  legacy retombe sur `email` sans perte de contenu. Couvert au harnais reducer
  (porté à 80 assertions, dont le constat `toWaNumber`).

---

## [3.5.0] — 2026-06-17 — Démarrage sur base vierge

### Ajouté
- **Première installation sur base vierge** : à un vrai premier lancement
  (localStorage absent ou JSON illisible), l'app démarre désormais **sans aucune
  donnée de démo** — `leads`, `actions`, `monthlyStats` et `acquisitionVolumes`
  vides. L'**équipe** (`DEFAULT_COMMERCIALS`) et les **modèles** email/SMS
  (`DEFAULT_TEMPLATES`) restent fournis par défaut. Prépare le déploiement chez
  le client : la base se remplit par la saisie ou l'import. Les fonctions
  `generateSeed*` (`src/data/seed.ts`) sont conservées (démo / réutilisation
  future) mais ne sont plus appelées à l'initialisation.

### Inchangé (non-régression)
- **Protection N1 (v3.1.1) intacte** : seule la branche « premier lancement »
  bascule en base vierge. Un état déjà persisté — même réduit à `leads: []` après
  suppression manuelle — est toujours **restauré tel quel, sans re-seed** ni
  écrasement de l'équipe / des modèles / des stats. Les installations existantes
  (dont les bases de test déjà seedées) conservent leurs données ; repartir
  vierge en test suppose de vider le localStorage. Harnais reducer maintenu à
  67/67 (cas N1, migration templates et hydratation partielle inclus).

---

## [3.4.1] — 2026-06-11 — Confort mobile & dette

### Corrigé
- **Graphes lisibles sur écran étroit** : les 4 graphes à barres horizontales
  (Dashboard, Performance ×2, Acquisition) réduisent l'axe des libellés
  (120-130 px → 76 px) et tronquent les noms (`…`) sous 640 px — le nom complet
  reste affiché au tap dans le tooltip. Desktop strictement inchangé. Hook
  `useIsCompact` (`useSyncExternalStore` sur media query, réactif à la rotation).
- **Cibles tactiles** : sur pointeur grossier (doigt), tous les boutons — y
  compris les icônes nues des lignes et de l'historique — passent à 40×40 px
  minimum, les champs/selects à 44 px (`@media (pointer: coarse)`, symétrique
  du `pointer-fine:` de v3.4.0). L'UI desktop souris garde sa densité.

### Retiré
- **`@dnd-kit/sortable` et `@dnd-kit/utilities`** déposés des dépendances :
  plus importés nulle part depuis le passage du Kanban en draggable pur
  (v3.4.0) — vérifié par grep, build et harnais.

---

## [3.4.0] — 2026-06-11 — Suivi d'action & mobile

### Corrigé
- **Une action future planifiée suspend les alertes d'inactivité (sauf leads
  chauds)** : un lead avec un rappel planifié dans le futur n'est plus affiché
  « en retard » (alertes 7/14 j, risques devis sans relance / critique / dernière
  action, KPI « Sans action >7j » et vue Inactifs). Exception métier : un lead
  **chaud** silencieux reste signalé même avec une action future. Une date
  échue ou du jour ne suspend rien. Source de vérité unique
  `hasFutureNextAction` ; harnais risques porté à 66 assertions.
- **Drop du Kanban fiabilisé** : le statut appliqué est désormais toujours
  celui de la **colonne visée** — les cartes ne sont plus des cibles de drop
  (déposer près d'une carte d'une colonne voisine appliquait son statut),
  détection « colonne sous le pointeur », annulation propre hors zone, et plus
  d'overlay fantôme après un drag annulé (Échap).
- **Kanban utilisable au doigt** : appui long (250 ms) pour saisir une carte,
  un glissement court reste un scroll du board — avant, tout glissement sur une
  carte devenait un drag, rendant le défilement tactile impossible. Souris
  inchangée (drag dès 5 px).
- **Responsive — les écrans cassés** : tableau Équipe scrollable horizontalement
  (il était coupé sur mobile) ; les actions « au survol » (lignes Leads,
  modifier/supprimer une action sur la fiche) sont visibles en permanence sur
  écran tactile (variante `pointer-fine:` — souris inchangée) et apparaissent
  au focus clavier ; l'en-tête de la fiche lead passe à la ligne au lieu de
  déborder sous ~500 px.

---

## [3.3.0] — 2026-06-10 — Bouton « Envoyer SMS »

### Ajouté
- **Bouton SMS sur la fiche lead**, miroir du bouton Email : menu déroulant des
  modèles de type SMS (livrés en v3.2.0), corps interpolé avec les mêmes variables
  que l'email (`{{prenom}}`…, pas de sujet), ouverture d'un lien `sms:` pré-rempli
  et journalisation d'une action « SMS » (modèle utilisé en résultat, corps rendu
  en notes). Repli « SMS vierge (sans modèle) » s'il n'existe aucun modèle SMS.
  Bouton désactivé si le lead n'a pas de numéro (infobulle explicative).
- **Helper `buildSms`** (`lib/sms.ts`) : numéro nettoyé via `normalizePhone`
  (espaces, points, tirets), corps encodé ; forme `sms:<numéro>?&body=...` —
  le compromis iOS/Android de l'état de l'art web (la RFC 5724 ne prévoit pas
  de corps).
- **Type d'action « SMS »** : disponible dans l'historique, la saisie d'action
  et la prochaine action (propagation automatique via `ACTION_TYPES`).

---

## [3.2.0] — 2026-06-10 — Modèles de message (email + SMS)

### Ajouté
- **Gestion libre des modèles** (page Modèles) : création (« + Modèle email » /
  « + Modèle SMS »), renommage (titre éditable), suppression avec confirmation —
  fini les 3 templates fixes. Garde-fou à deux niveaux : impossible de supprimer le
  dernier modèle (bouton désactivé **et** refus dans le reducer), pour ne jamais se
  retrouver sans modèle.
- **Type de modèle email | sms** : les SMS n'ont pas de sujet (champ masqué, note
  160 caractères) ; mêmes variables d'interpolation (`{{prenom}}`…) pour les deux
  types. Le type est figé à la création. **Prépare le bouton « Envoyer SMS »**
  (lot suivant) : le menu email de la fiche lead ne liste que les modèles email,
  avec repli « Email vierge » s'il n'en reste aucun.

### Modifié
- **Modèle de données** : `MessageTemplate` (`id` généré, `type`), champ d'état
  `templates` (ex-`emailTemplates`), actions reducer `ADD/UPDATE/DELETE_TEMPLATE`
  (ex-`UPDATE_EMAIL_TEMPLATE` update-only). Navigation : « Modèles » / « Modèles
  de message ».
- **Migration localStorage sans perte** (point critique, prouvé au harnais —
  63 assertions désormais) : double lecture `templates` puis legacy
  `emailTemplates` ; les modèles stockés avant l'introduction du type reçoivent
  `type: "email"`, ids et contenus strictement intacts ; liste vide/absente →
  modèles par défaut (comportement historique conservé).

---

## [3.1.5] — 2026-06-10 — Lot petits & moyens (6 étapes)

### Corrigé
- **Commentaire vue Prospects (N14)** : documente le comportement réel (seuls les
  signés sont exclus ; perdus/reportés visibles) — aucun changement de code.
- **Lockfile resynchronisé** : `name` (« boat-temp ») et `version` (« 0.0.0 »)
  réalignés sur package.json.
- **Lint React Compiler : 11 → 0 erreur** : contexte découpé (`appReducer.ts` module
  pur testé par le harnais, `useApp.ts`, `AppContext.tsx` réduit au Provider),
  `SortIcon` en composant module, calcul de période sorti du render
  (`isoDateDaysAgo`, calcul strictement identique), `location.assign`. Comportement
  visible inchangé (harnais 47/47 + 43/43).
- **Dépendances : 4 → 0 vulnérabilité** (`npm audit fix`) : react-router 7.14.0 →
  7.17.0, postcss, brace-expansion. Routes validées en preview.
- **Import vCard : QUOTED-PRINTABLE décodé (N11)** : les exports vCard 2.1 (anciens
  Android/Outlook) arrivent désormais avec leurs accents (`=C3=A9` → é) — charset
  déclaré respecté (fallback UTF-8), soft line breaks gérés uniquement sur les
  propriétés QP (padding base64 préservé), normalisation champ par champ vers le
  pipeline d'échappement existant.
- **Accessibilité (N12)** : modale fermable à Échap, focus-trap basique et
  restauration du focus ; lignes cliquables (Leads, Clients, À relancer, Dashboard)
  atteignables au clavier (Tab + Entrée/Espace), souris inchangée.

### Ajouté
- **Liens KPI filtrés + vue « Inactifs >7j » (N8)** : les liens du Dashboard
  propagent les filtres actifs (commercial/source/période) vers les listes — le
  compteur cliqué correspond exactement à la liste ouverte. Nouveau select
  « Période » et nouvelle vue « Inactifs >7j » sur la page Leads (prédicat partagé
  `isInactiveOverWeek` avec le KPI « Sans action >7j », désormais cliquable) ;
  page Clients pré-filtrable par l'URL.
- **Harnais vCard** (`scripts/harness-vcard.ts`, 36 assertions) : cas QP +
  non-régression complète du parser (échappements, folding, multi-cartes,
  doublons). Trois harnais committés au total (126 assertions).

---

## [3.1.4] — 2026-06-10 — Finition

### Corrigé
- **Accents résiduels (N9)** : 14 libellés affichés ratés par la passe v3.0.2 —
  options de filtres (« Toute période », « Température », « Tous les états »), titres
  (« Détail par commercial »), messages d'état vide (« Aucune donnée… », « Aucun lead
  trouvé », « Aucune action enregistrée », « Tous relancés », « Tous planifiés »), vue
  « Devis à relancer ». Comme en v3.0.2 : uniquement les libellés visibles — valeurs de
  statut internes, clés techniques et `dataKey` de graphes inchangés.
- **Encodage de l'adresse dans les liens mailto (N10)** : l'adresse est désormais
  encodée (le `@` restant lisible) — une adresse contenant `?` ou `&` ne peut plus
  casser le lien ni injecter de paramètres (`cc`, `bcc`…). Lien strictement identique
  pour une adresse normale ; sujet et corps encodés comme avant.

---

## [3.1.3] — 2026-06-10 — Résilience

### Ajouté
- **ErrorBoundary racine** : toute erreur de rendu (y compris un crash du provider au
  montage, ex. state localStorage corrompu à la main) affiche désormais un écran de
  secours propre — message rassurant (les données locales ne sont pas perdues), bouton
  « Recharger la page », détail technique repliable — au lieu d'une page blanche.
  Volontairement sans bouton de réinitialisation des données (pas d'action destructive
  sous la main d'un utilisateur paniqué).
- **Page 404** : une URL inconnue (`#/nimporte`) affiche une page « Page introuvable »
  dans le layout (sidebar et header restent disponibles) avec retour au tableau de
  bord, au lieu d'un layout vide. Les routes existantes sont prioritaires (matching
  par spécificité).

---

## [3.1.2] — 2026-06-10 — Cohérence relances

### Corrigé
- **Alerte et risques divergeaient sur la prochaine action (N4)** : un lead chaud avec
  un type de prochaine action mais **sans date** était compté « Urgence » (Dashboard,
  cloche, filtres rouges) mais absent de la vue À relancer. Nouveau helper
  `hasPlannedNextAction` — **source de vérité unique** : une prochaine action n'est
  « planifiée » que si elle a une date. `getAlertLevel`, `getLeadRisks` et tous les
  prédicats UI (KPI Dashboard « Sans prochaine action », vue Leads « Sans action »,
  fiche lead) passent par ce helper — plus aucune condition en dur, impossible de
  re-diverger. Libellé dédié « Prochaine action sans date » quand un type est saisi
  sans date.
- **Aucune détection de prochaine action échue (N5)** : un rappel planifié dans le
  passé n'apparaissait nulle part si l'activité du lead était par ailleurs récente.
  Nouveau risque « Action planifiée dépassée de Xj » dans `getLeadRisks` (warning
  jusqu'à 3 jours de retard, danger au-delà), mutuellement exclusif avec le risque
  « manquante ». La vue À relancer en bénéficie sans modification (passe-plat de
  `getLeadRisks`). Les compteurs d'Urgence (`getAlertLevel`) restent volontairement
  inchangés : risques et alertes sont deux échelles distinctes.

### Ajouté
- **Harnais risques/alertes** (`scripts/harness-risks.ts`, `npx tsx`) : 43 assertions —
  cohérence N4, bornes et exclusivité N5, non-régression des risques historiques et de
  `getFollowUpLeads`.

---

## [3.1.1] — 2026-06-10 — Intégrité des données

### Corrigé
- **Re-seed destructif sur liste vide (N1)** : supprimer son dernier lead puis recharger
  faisait croire à un premier lancement → 35 leads bidon régénérés et commerciaux /
  modèles d'email / stats écrasés. Le state stocké est désormais restauré dès qu'il
  existe (hydratation champ par champ avec fallback) ; le seed ne se déclenche que sur
  un vrai premier lancement (clé absente ou JSON invalide).
- **Action antidatée faisait reculer `lastActionDate` (N2)** : saisir a posteriori une
  action ancienne (rattrapage d'historique) faisait reculer la dernière activité du lead
  → fausse urgence (alerte rouge, vue À relancer). `lastActionDate` retient maintenant
  la date la plus récente ; les jalons d'un changement de statut restent posés à la date
  sémantique de l'action.
- **Lead créé en statut avancé sans jalons (N3)** : un lead créé directement « Signé »
  (mode complet) restait sans `signedAt`/`contactDate` (exclu du délai moyen de
  signature, date vide à l'export Clients, puis « auto-réparé » avec une date fausse à
  la première édition). `ADD_LEAD` pose désormais les jalons selon le statut choisi,
  date de référence = date de création ; une date de contact saisie est préservée.

### Ajouté
- **Harnais committé** (`scripts/harness-reducer.ts`, `npx tsx`) : 47 assertions —
  cas N1/N2/N3 + non-régression de l'isolation `UPDATE_ACTION` / `DELETE_ACTION` /
  `SET_NEXT_ACTION` du lot précédent. Hors typecheck app et hors bundle.

---

## [3.1.0] — 2026-06-09 — Gestion des actions d'un lead

### Ajouté
- **Prochaine action éditable** depuis la fiche lead : définir / modifier / effacer le
  type et la date (action reducer dédiée `SET_NEXT_ACTION`, confinée à
  `nextActionType`/`nextActionDate` — aucun effet de bord sur les jalons).
- **Historique des actions modifiable et supprimable** : édition d'une action
  (type, date, auteur, résultat, notes) via le formulaire existant en mode édition ;
  suppression d'une ligne avec confirmation. Les actions `UPDATE_ACTION` / `DELETE_ACTION`
  sont **confinées au tableau des actions** — pas de rollback du statut ni des dates du
  lead (comportement voulu). Couvert par un harnais d'isolation des effets de bord (18/18).

---

## [3.0.2] — 2026-06-09 — Finition UI

### Corrigé
- **Libellés KPI tronqués** sur le Dashboard (« Lead… », « Volu… », « Sans… ») : suppression
  du `truncate` sur le titre des cartes — les libellés tiennent désormais en entier.
- **Accents manquants** harmonisés sur l'ensemble des libellés affichés (navigation, KPI et
  graphes Dashboard/Performance, fiche lead, libellés de risque, modale Équipe, boutons
  « Réinitialiser », options « État ») **et** les en-têtes d'export CSV (Leads, Performance).
  Les valeurs de statut internes et les noms de champs restent inchangés.

---

## [3.0.1] — 2026-06-09 — Correctifs d'audit

### Corrigé
- **Lien Dashboard « Signés »** : le KPI ouvrait la liste Leads en vue « Prospects » (qui
  exclut les signés) → liste vide. La vue passe désormais à « Tous » quand l'URL porte un
  statut terminal (signe/perdu/reporté).
- **Robustesse `saveState`** : `try/catch` autour de l'écriture localStorage — un échec
  (quota plein, navigation privée Safari, stockage indisponible) n'interrompt plus l'action
  en cours.
- **Compatibilité vCard / Safari < 16.4** : remplacement du lookbehind regex du parser vCard
  par un scanner manuel équivalent (gère l'échappement `\;` `\,` `\\`).

---

## [3.0.0] — 2026-06-09 — Première version complète « Brest Ocean Boat »

### Ajouté
- **Emails** : modèles éditables (page « Modèles d'email »), signature par commercial
  (page Équipe), envoi pré-rempli `mailto:` interpolé + journalisation d'une action.
- **Vue « À relancer »** : liste des leads à relancer basée sur la détection existante
  (`getLeadRisks`), filtres commercial + sévérité, tri urgence → ancienneté.
- **Export PDF** des rapports Dashboard / Performance / Acquisition via `window.print()`
  (CSS print dédié, sans dépendance).
- **vCard** : export d'un contact `.vcf` (vCard 3.0) depuis la fiche lead ; import multiple
  avec détection de doublons (email/téléphone normalisés) et récapitulatif avant création.
- **Branding** : logo Brest Ocean Boat, sidebar réorganisée (groupe « Paramètres »),
  renommage de l'application, version affichée (lue depuis `package.json`).

### Corrigé
- **Cohérence des dates de statut** : centralisation dans `statusMilestoneDates` (les dates
  de jalon — contact, signé, perdu, reporté — sont posées de façon cohérente quel que soit
  le chemin de changement de statut).
- **Sécurité — injection de formule CSV (M1)** : neutralisation des champs commençant par
  `= + - @` dans les exports CSV.
- **Unification de l'export CSV** : un seul helper correctement échappé (BOM UTF-8, `;`, CRLF).

### Modifié (UX)
- Cartes Pipeline cliquables (sans casser le drag & drop), jalon « Contact » horodaté
  automatiquement, retour visuel sur l'export, titre de page = nom du lead sur la fiche,
  tooltip explicite sur la cloche d'alertes.

---

[3.4.1]: https://github.com/Sapulse/boat/releases/tag/v3.4.1
[3.4.0]: https://github.com/Sapulse/boat/releases/tag/v3.4.0
[3.3.0]: https://github.com/Sapulse/boat/releases/tag/v3.3.0
[3.2.0]: https://github.com/Sapulse/boat/releases/tag/v3.2.0
[3.1.5]: https://github.com/Sapulse/boat/releases/tag/v3.1.5
[3.1.4]: https://github.com/Sapulse/boat/releases/tag/v3.1.4
[3.1.3]: https://github.com/Sapulse/boat/releases/tag/v3.1.3
[3.1.2]: https://github.com/Sapulse/boat/releases/tag/v3.1.2
[3.1.1]: https://github.com/Sapulse/boat/releases/tag/v3.1.1
[3.1.0]: https://github.com/Sapulse/boat/releases/tag/v3.1.0
[3.0.2]: https://github.com/Sapulse/boat/releases/tag/v3.0.2
[3.0.1]: https://github.com/Sapulse/boat/releases/tag/v3.0.1
[3.0.0]: https://github.com/Sapulse/boat/releases/tag/v3.0.0
