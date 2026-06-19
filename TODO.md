# CRM Brest Ocean Boat — Roadmap & TODO

État au jalon **V3.13** (dernier tag `v3.13.0`). Ce fichier sert de fil conducteur entre sessions.

App : SPA React + Vite + TS, HashRouter, persistance **localStorage**, déployée sur
GitHub Pages (`sapulse.github.io/boat/`). Workflow : diagnostic read-only → plan validé
→ branche → tsc + build + lint + 3 harnais → diff review → merge --ff-only → push (=
déploiement auto) → tag annoté. Commits sémantiques.

---

## 🚧 EN COURS — lot `objectifs-defaut-equipe` (cible `v3.19.0`)

**Objectifs par défaut de l'équipe** : une cible commune par indicateur, réglée une fois,
reconduite chaque mois pour chaque commercial, surchargeable par (commercial, mois).
Branche `objectifs-defaut-equipe`.

- [x] **Étape 1** — modèle `DefaultGoal` + `EMPTY_DEFAULT_GOAL` + `AppState.defaultGoal` +
  `SAVE_DEFAULT_GOAL` + hydratation (migration nulle) + `saveDefaultGoal` ; fonction PURE
  `effectiveTarget(target, défaut)` (cascade cible) + harnais goals (49 : 4 cas + `0`).
- [x] **Étape 2** — écran Paramètres « Objectifs par défaut » (route `/objectifs-defaut` +
  entrée section Paramètres) : 6 cibles par défaut en une colonne → `saveDefaultGoal`.
- [x] **Étape 3** — cible EFFECTIVE à l'affichage (Objectifs + Espace commercial) : barre/%
  sur cible effective, placeholder = défaut équipe grisé, `MetricCard.targetInherited`.
- [x] **Merge `v3.19.0`** : ff-only → main, CHANGELOG, tag annoté.

✅ Lots récents livrés : `espace-commercial` (**v3.17.0**), menu en sections repliables
(**v3.18.0**), `objectifs-prospection` (**v3.16.0**).

⚠️ **Point de vigilance — « Recommandation »** (issu de v3.16.0) : classée en source de
**prospection active** aujourd'hui, mais **discutable** (souvent un flux entrant non sollicité).
**Rebasculable en flux entrant** en retirant la valeur de `PROSPECTION_SOURCES` (un seul endroit,
sans migration). À confirmer avec Nicolas/Mickaël.

---

## ✅ FAIT (en prod, V3)

- **Cohérence données** : dates de transition de statut centralisées (`statusMilestoneDates`)
- **Sécurité** : injection de formule CSV neutralisée (M1)
- **UX** : pipeline cliquable, jalon contact auto, feedback export, titre fiche, tooltip cloche
- **Emails** : templates éditables (page Modèles), signature par commercial (Équipe),
  envoi pré-rempli + journalisation
- **Vue "À relancer"** : basée sur `getLeadRisks` (filtres commercial + sévérité)
- **Export PDF** : Dashboard / Performance / Acquisition via `window.print()`
- **vCard** : export contact .vcf + import multiple avec détection de doublons
- **Branding** : logo Brest Ocean Boat, sidebar réorganisée (groupe Paramètres),
  renommage app, version affichée

### Patchs post-V3
- **`v3.0.1`** — correctifs audit : lien Dashboard « Signés », `saveState` try/catch,
  compat vCard Safari < 16.4 (parser sans lookbehind regex)
- **`v3.0.2`** — finition UI : libellés KPI non tronqués + accents harmonisés
- **`v3.1.0`** — gestion des actions d'un lead : prochaine action éditable,
  historique modifiable/supprimable (actions reducer confinées)

### Série de fiabilisation du 10/06 (check Fable complet → 5 lots)
- **`v3.1.1`** — intégrité des données : re-seed destructif corrigé (**N1**),
  `lastActionDate` insensible aux actions antidatées, jalons à la création (+ harnais)
- **`v3.1.2`** — cohérence relances : prédicat unifié `hasPlannedNextAction`,
  détection des actions planifiées échues (+ harnais risques)
- **`v3.1.3`** — résilience : ErrorBoundary racine, page 404
- **`v3.1.4`** — finition : accents résiduels, encodage mailto
- **`v3.1.5`** — lot petits & moyens : **lint 0 erreur**, **audit 0 vulnérabilité**,
  liens KPI filtrés, import vCard QUOTED-PRINTABLE, a11y. **3 harnais committés**

### Fonctionnalités & correctifs v3.2 → v3.4
- **`v3.2.0`** — modèles de message : gestion libre (garde-fou min-1), type **email | sms**,
  migration localStorage sans perte (prouvée au harnais)
- **`v3.3.0`** — bouton « Envoyer SMS » : modèles SMS, lien `sms:` (`buildSms`),
  action journalisée, désactivé sans numéro (validé sur mobile réel)
- **`v3.4.0`** — suivi & mobile (retours Mickaël) : action future suspend l'inactivité
  sauf leads chauds (`hasFutureNextAction`) ; Kanban drop fiable + tactile ; responsive
- **`v3.4.1`** — confort mobile & dette : graphes lisibles en étroit, cibles tactiles
  ≥ 40px, dépose `@dnd-kit/sortable` + `@dnd-kit/utilities` (inutilisés)

### Lots du 17/06 (préparation déploiement + 3 canaux + agenda + heures)
- **`v3.5.0`** — **base vierge** : démarrage SANS données de démo à la première
  installation (localStorage absent / JSON invalide) ; équipe (`DEFAULT_COMMERCIALS`)
  et modèles (`DEFAULT_TEMPLATES`) conservés. Protection **N1 préservée** (un état
  persisté, même vide, n'est jamais re-seedé). `generateSeed*` gardées mais plus
  appelées. Harnais reducer 67.
- **`v3.6.0`** — **bouton WhatsApp** (3e canal) : modèles type `whatsapp`, lien
  `wa.me` au format international (`buildWhatsApp` / `toWaNumber`, indicatif défaut 33),
  action `whatsapp` journalisée, migration des modèles sûre (type inconnu → email).
  Harnais reducer 80. ⚠️ **Lien `wa.me` à confirmer sur mobile réel** (comme le SMS).
- **`v3.7.0`** — **AGENDA** : page dédiée, **3 vues** (semaine / mois / journée
  comparative par commercial), couleur par commercial + filtre + légende, actions
  échues signalées. **Interactif** (créer sur date vide / replanifier par drag en
  semaine + re-sélecteur en mois/journée), tout via `SET_NEXT_ACTION`. Helpers purs
  `lib/agenda.ts`, aucune lib calendrier ajoutée. Harnais reducer **91**.
- **`v3.8.0`** — **heure optionnelle** sur la prochaine action (champ séparé
  `Lead.nextActionTime?`, `nextActionDate` intouché) : éditeur fiche date + heure
  facultative, agenda affiche l'heure dans les pastilles + tri sans-heure d'abord
  puis chronologique (3 vues), drag/re-sélecteur conservent l'heure. Migration
  localStorage nulle. Harnais reducer **103**. *(= L1 du diagnostic « agenda
  complet », voir ci-dessous.)*
- **`v3.9.0`** — **agenda en grille horaire** : vues **Semaine** (7 jours × heures)
  et **Journée** (comparative préservée : heures × commerciaux) en grille type
  Google Agenda, plage **8h-18h** / créneaux **30 min** (en constantes). Bandeau
  « toute la journée » + report des actions hors-plage (aucune masquée).
  **Clic-créneau → création avec heure pré-remplie** (Semaine + Journée), drag
  conservé au **niveau jour** (l'heure suit). Mois inchangé. Helpers purs
  `buildTimeSlots`/`eventSlot`/`layoutDayEvents` + composant `TimeGrid`. Harnais
  reducer **121**. *(= L2 du diagnostic « agenda complet ».)*
- **`v3.10.0`** — **durée des actions** : heure de fin optionnelle (champ séparé
  `Lead.nextActionEndTime?`) → bloc qui s'étire sur ses créneaux, chevauchements
  côte à côte en couloirs, clamp 18h. Éditeur + créateur : champ Fin (validation
  fin > début). `TimeGrid` réécrit en column-major + positionnement absolu ;
  helper pur `layoutDayGrid`. Harnais reducer **148**.
- **`v3.11.0`** — **drag par créneau** : glisser un bloc change le **jour ET
  l'heure** (durée préservée, clamp 18h) ; drag activé en Journée (change l'heure,
  commercial jamais modifié). 1 droppable/colonne + `delta.y` ; helpers purs
  `startSlotIndex`/`shiftEventBySlots`. Harnais reducer **166**.
- **`v3.12.0`** — **redimensionner un bloc à la poignée** (souris + tactile,
  aperçu live, min 30 min, clamp 18h, début fixe). Helper pur `resizeEventBySlots`.
  Harnais reducer **176**. *(= le « glisser-pour-définir-la-durée » envisagé, fait.)*
- **`v3.13.0`** — **événements d'agenda libres** (non liés à un lead) : entité
  `CalendarEvent` isolée (tableau + ADD/UPDATE/DELETE confinés, migration nulle),
  catégories colorées (réunion/congé/déplacement/perso), création (clic créneau →
  choix Action/Événement) / édition / suppression, drag + resize, 3 vues. Affichage
  unifié `GridItem`. Harnais reducer **198**. *(= L3 du diagnostic, version
  localStorage ; L4 agenda partagé = backend.)*

---

## 🗺️ ROADMAP — issue des 3 RDV Ocean Boat

### 🟢 À TRAITER — ne dépend de personne (prêt à démarrer)

- [ ] **Relances PROPOSÉES** (pré-remplies, modifiables) après certaines actions :
  ex. devis envoyé → proposer une relance à J+3 / J+7. **Pré-remplissage, PAS
  automatisme** (l'utilisateur valide/ajuste). S'appuie sur le mécanisme
  `SET_NEXT_ACTION` + la détection de risques existante.
- [ ] **Modèles multilingues** (FR / EN / PT) : étendre les modèles de message par langue.

### 🟡 À CLARIFIER — décision Mickaël ou dépend d'Infocob (ne pas coder avant réponse)

- [ ] **Noms des colonnes du pipeline** + statut **« Qualifié » ambigu** : décision
  métier qui touche le cœur (statuts). Attendre l'arbitrage de Mickaël.
- [ ] **Types d'actions à aligner sur Infocob** : attendre la liste de référence Infocob.
- [ ] **Export Infocob** : à quel moment exporter + quelles données synchroniser
  (dépend d'Infocob).
- [ ] **Historique de température** (oui/non) : le client penche pour **non** — à confirmer.
- [ ] **Vue Prospects** : exclure aussi perdus/reportés ? (aujourd'hui seuls les signés
  sont exclus — comportement documenté, changement = décision métier).

### 🔵 PLUS TARD — dépend du backend / d'éléments externes

- [ ] **Import Excel** de la vraie base Ocean Boat (après validation client). Spec de
  mapping prête : `mapping-import-excel.md`. ⚠️ À faire dans la base partagée, pas en
  localStorage. Pré-requis : commerciaux créés, sources/types alignés, clarifier "DV"/"BO".
- [ ] **Import de leads depuis emails** : semi-manuel d'abord, puis agent IA. *Le client
  doit fournir 2-3 mails types* pour caler le parsing.
- [ ] **Agenda complet type Google/Outlook** (étude de faisabilité faite, 17/06) :
  - **L1 — heures** → ✅ **FAIT en v3.8.0** (créneaux horaires sur les actions de leads,
    propre en localStorage car champ par lead).
  - **L2 — grille horaire visuelle** (vues Semaine/Journée) → ✅ **FAIT en v3.9.0**,
    enrichi ensuite : **durée/blocs** (v3.10.0), **drag par créneau** jour+heure
    (v3.11.0), **resize à la poignée** (v3.12.0). Axe 8h-18h, créneaux 30 min.
  - **L3 — événements libres** (réunion, congé, déplacement, bloc perso, non liés à
    un lead) → ✅ **FAIT en v3.13.0** (version test localStorage) : entité
    `CalendarEvent` isolée (tableau + ADD/UPDATE/DELETE confinés), catégories
    colorées, CRUD modale, drag + resize, 3 vues. Données **mono-poste** (non
    partagées) ; entité **isolée pour rebranchement backend** (L4) sans réécriture.
  - **L4 — agenda d'équipe PARTAGÉ** : impossible en localStorage (chaque poste est isolé).
    **Dépend du backend.** 👉 Reco du diagnostic : quand le backend arrivera, **évaluer
    d'abord la synchro Outlook 365** (Microsoft Graph) plutôt que reconstruire un
    calendrier maison — **Infocob est déjà connecté à Outlook 365**, donc Outlook EST
    déjà le calendrier partagé de l'équipe (Graph nécessite tout de même un broker
    d'auth côté serveur = backend).
- [ ] **Synchro Outlook / Infocob** : Infocob déjà connecté à Outlook 365 — point
  d'intégration clé (cf. L4 ci-dessus : alternative à un calendrier maison).
- [ ] **Base partagée multi-postes** (backend Vercel ou autre) — **LE grand jalon** : ce
  qui fait passer du prototype à l'outil utilisé par 4 commerciaux. Débloque comptes,
  déploiement chez eux, import Excel réel, agenda partagé (L3/L4). Bloqué sur le choix d'infra.
- [ ] **Enregistrement / transcription d'appels** : sujet à part, **enjeu RGPD** fort.

---

## ℹ️ POINTS D'USAGE — résolus, PAS du développement

- **« Le VCF ne pioche pas dans les contacts du téléphone »** (soulevé en RDV) :
  **FAUX BUG.** L'export `.vcf` et l'import `.vcf` (multiple + détection de doublons)
  **fonctionnent**. Le besoin sous-jacent — « sélectionner directement dans le carnet
  de contacts du téléphone » — est **impossible pour une page web** (barrière de
  sécurité du navigateur : pas d'accès au carnet natif). **Contournement utilisateur** :
  Contacts du téléphone → *Partager / Exporter en VCF* → importer le fichier dans le CRM.
  → **Question d'usage à expliquer au client, aucun développement requis.**

---

## ➕ FONCTIONNALITÉS EN PLUS (faisables sans backend, en réserve)

- [ ] **Onglet Paramètres** : exposer la **plage horaire de l'agenda** (aujourd'hui en
  constantes `AGENDA_HOUR_START` / `AGENDA_HOUR_END` / `AGENDA_SLOT_MIN`) en réglage UI —
  **petit lot séparé** à faire quand le besoin se présente. Porte d'entrée pour d'autres
  réglages plus tard.
- [ ] **Couche IA email** : pré-rédaction d'un mail lisant la fiche du lead (templates
  déjà en place ; nécessite une clé API). Recoupe l'import de leads par IA.
- [ ] **Comptes / mot de passe entreprise** : n'a de sens qu'avec le backend.

---

## 🐛 DETTE TECHNIQUE / À SURVEILLER (non bloquant)

- [ ] **Bundle monolithique ~875 kB** (gzip ~250) : code-splitting par route
  (`React.lazy`) pour alléger le 1er chargement.
- [ ] **Agenda — reportés exclus volontairement** : `buildAgendaEvents` ne liste que les
  leads actifs (cohérence alertes/risques). Ajoutable si Ocean Boat veut voir les
  reportés à l'agenda (one-liner).
- [ ] **Acquisition (onglets Volumes / Saisie)** : copient `state` dans un `useState`
  local au montage → désync possible + perte de saisie si on quitte sans « Enregistrer ».
- [ ] **Dashboard** : blocs « chauds sans action » / « devis sans relance » encore inline
  au lieu de réutiliser `getLeadRisks` (partiellement unifié).
- [ ] Dépendances très avancées (React 19, Vite 8, TS 6) — surveiller la repro du build.

---

## Prochain vrai jalon

Deux fronts en parallèle :
1. **Court terme, autonome** : relances proposées → modèles multilingues.
2. **Structurant** : **le backend / base partagée**, qui débloque comptes, déploiement
   chez Ocean Boat, import Excel réel et l'agenda partagé (L3/L4 + synchro Outlook).
   Toujours en attente de l'arbitrage d'infra.

En attente client : arbitrages Mickaël (statuts/pipeline), réponses Infocob (types
d'actions, export), mails types pour l'import IA, et infra serveur pour le backend.
