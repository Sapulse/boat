# CRM Brest Ocean Boat — Roadmap & TODO

État au jalon **V3.7** (dernier tag `v3.7.0`). Ce fichier sert de fil conducteur entre sessions.

App : SPA React + Vite + TS, HashRouter, persistance **localStorage**, déployée sur
GitHub Pages (`sapulse.github.io/boat/`). Workflow : diagnostic read-only → plan validé
→ branche → tsc + build + lint + 3 harnais → diff review → merge --ff-only → push (=
déploiement auto) → tag annoté. Commits sémantiques.

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

### Lots du 17/06 (préparation déploiement + 3 canaux + agenda)
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

---

## 🗺️ ROADMAP — issue des 3 RDV Ocean Boat

### 🟢 À TRAITER — ne dépend de personne (prêt à démarrer)

- [ ] **BUG VCF** (signalé en RDV) : « le VCF ne sélectionne pas correctement les
  contacts ». À diagnostiquer (export et/ou import). **Prochain candidat naturel.**
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
- [ ] **Synchro Outlook / Infocob** : Infocob est déjà connecté à Outlook 365 — à étudier
  comme point d'intégration.
- [ ] **Base partagée multi-postes** (backend Vercel ou autre) — **LE grand jalon** : ce
  qui fait passer du prototype à l'outil utilisé par 4 commerciaux. Débloque comptes,
  déploiement chez eux, import Excel réel. Bloqué sur le choix d'infra.
- [ ] **Enregistrement / transcription d'appels** : sujet à part, **enjeu RGPD** fort.

---

## ➕ FONCTIONNALITÉS EN PLUS (faisables sans backend, en réserve)

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
1. **Court terme, autonome** : bug VCF → relances proposées → modèles multilingues.
2. **Structurant** : **le backend / base partagée**, qui débloque comptes, déploiement
   chez Ocean Boat et import Excel réel. Toujours en attente de l'arbitrage d'infra.

En attente client : arbitrages Mickaël (statuts/pipeline), réponses Infocob (types
d'actions, export), mails types pour l'import IA, et infra serveur pour le backend.
