# CRM Brest Ocean Boat — Roadmap & TODO

État au jalon **V3.3** (dernier tag `v3.3.0`). Ce fichier sert de fil conducteur entre sessions.

App : SPA React + Vite + TS, HashRouter, persistance **localStorage**, déployée sur
GitHub Pages (`sapulse.github.io/boat/`). Workflow : diagnostic read-only → plan validé
→ branche → tsc + build + harnais → diff review → merge --ff-only → push (= déploiement
auto). Commits sémantiques, sans Co-Authored-By.

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
- **`v3.0.1`** — correctifs audit : lien Dashboard « Signés » (ouvrait une liste vide),
  `saveState` try/catch (robustesse quota localStorage), compat vCard Safari < 16.4
  (parser sans lookbehind regex)
- **`v3.0.2`** — finition UI : libellés KPI non tronqués (`truncate` retiré) + accents
  harmonisés sur tous les libellés affichés et en-têtes d'export CSV
- **`v3.1.0`** — gestion des actions d'un lead : prochaine action éditable,
  historique modifiable/supprimable (actions reducer confinées)

### Série de fiabilisation du 10/06 (check Fable complet → 5 lots)
- **`v3.1.1`** — intégrité des données : re-seed destructif sur liste vide corrigé,
  `lastActionDate` insensible aux actions antidatées, jalons posés dès la création
  (+ harnais reducer)
- **`v3.1.2`** — cohérence relances : prédicat unifié `hasPlannedNextAction` (source
  de vérité unique alerte/risques/UI), détection des actions planifiées échues
  (+ harnais risques)
- **`v3.1.3`** — résilience : ErrorBoundary racine (écran de secours au lieu d'une
  page blanche), page 404
- **`v3.1.4`** — finition : 14 accents résiduels, encodage de l'adresse mailto
- **`v3.1.5`** — lot petits & moyens : **lint 0 erreur** (découpage contexte,
  React Compiler), **audit 0 vulnérabilité** (react-router 7.17), lockfile
  resynchronisé, liens KPI Dashboard filtrés + vue « Inactifs >7j »
  (correspondance compteur↔liste), import vCard QUOTED-PRINTABLE, a11y
  (modale Échap/focus-trap, listes au clavier). **3 harnais committés** :
  `scripts/harness-{reducer,risks,vcard}.ts` via `npx tsx`

### Fonctionnalités v3.2 / v3.3
- **`v3.2.0`** — modèles de message : gestion libre (créer/renommer/supprimer,
  garde-fou min-1), type **email | sms**, migration localStorage sans perte
  (double lecture `templates`/`emailTemplates`, prouvée au harnais — 142
  assertions au total)
- **`v3.3.0`** — bouton « Envoyer SMS » sur la fiche lead : modèles SMS,
  lien `sms:` (`buildSms`, compromis iOS/Android), action « SMS » journalisée,
  désactivé sans numéro — ⚠️ lien `sms:` à valider sur mobile réel post-déploiement

---

## 🔧 CHANTIER DE FOND — passer de la démo à l'outil de production

> Le bloc le plus important. Tout part du fait que l'app est en **localStorage**
> (= une base isolée par navigateur). Pour un usage réel à plusieurs (Tom, Fred, Nico,
> Lana), il faut un backend partagé. Tout le reste de ce bloc en dépend.

- [ ] **Backend / base partagée** (PIÈCE MAÎTRESSE)
  - Décision archi : cloud (Supabase) vs auto-hébergé sur leur serveur
  - ⚠️ BLOQUÉ : dépend de **leur infra serveur** (NAS ? VPS ? machine bureau ?) — à récupérer auprès d'Ocean Boat
- [ ] **Comptes / mot de passe entreprise** (n'a de sens qu'avec backend)
- [ ] **Mode base vierge** : supprimer le seed aléatoire (35 leads bidon au 1er chargement)
- [ ] **Import du fichier Excel existant** d'Ocean Boat
  - Spec de mapping déjà prête : voir `mapping-import-excel.md`
  - ⚠️ À faire DANS la base partagée (backend), pas dans localStorage
  - Pré-requis : créer les commerciaux dans Équipe avant l'import ; aligner sources / types bateau ; confirmer csv vs xlsx ; clarifier "DV"/"BO"
- [ ] **Déploiement chez eux** (leur serveur, pas GitHub Pages)
- [ ] **Doc RGPD** sur le localStorage (à présenter à Ocean Boat — disparaît avec le backend)

---

## ✨ NOUVELLES FONCTIONNALITÉS ENVISAGÉES

- [ ] **Audit + optimisation de la vue mobile / responsive** : chantier transversal,
  nécessite un diagnostic responsive dédié avant de coder
- [ ] *(déjà listées ci-dessous, candidates)* : règle auto-relance, couche IA email

## ➕ FONCTIONNALITÉS EN PLUS (faisables sur l'archi actuelle, sans backend)

- [ ] **Couche IA email** : pré-rédaction d'un mail lisant la fiche du lead. Terrain prêt
  (templates existent). Nécessite une clé API.
- [ ] **Règle auto-relance** : passage auto en relance après X jours (demande réunion).
  Détection déjà là (`getLeadRisks`, risque « action échue » depuis v3.1.2) ; reste à
  formaliser l'automatisme SI Ocean Boat le confirme (ils ont laissé ouvert).
- [ ] **Connexion Infocob** (leur CRM) : bouton "ajouter sur Infocob". Phase lointaine,
  dépend de l'API Infocob.

---

## ❓ DÉCISIONS OUVERTES CÔTÉ OCEAN BOAT

- [ ] **Infra serveur** → débloque le choix backend (cloud vs auto-hébergé)
- [ ] **Fichier Excel** : confirmer format (csv/xlsx), signification de "DV"/"BO",
  liste complète des commerciaux et des sources
- [ ] **Jeu de statuts définitif** + règle auto-relance (à valider à l'usage)
- [ ] **Vue Prospects** : faut-il exclure aussi perdus/reportés (aujourd'hui seuls les
  signés sont exclus — comportement documenté, changement = décision métier)

---

## 🐛 DETTE TECHNIQUE / À SURVEILLER (non bloquant)

- [ ] **Bundle monolithique ~855 kB** (gzip ~245) : code-splitting par route (`React.lazy`)
  pour alléger le 1er chargement
- [ ] **Acquisition (onglets Volumes / Saisie)** : copient `state` dans un `useState` local
  au montage → désync si l'état change ailleurs + perte de saisie si on quitte sans
  « Enregistrer » — à refactorer
- [ ] Le Dashboard refait des filtres "à relancer" inline au lieu de réutiliser
  `getLeadRisks` (redondance logique avec la vue À relancer) — **partiellement entamé** :
  les prédicats « prochaine action » et « inactif >7j » sont désormais partagés
  (`hasPlannedNextAction`, `isInactiveOverWeek` dans `utils.ts`) ; restent les blocs
  « chauds sans action » / « devis sans relance » à unifier un jour
- [ ] Versions de dépendances très avancées (React 19, Vite 8, TS 6) — surveiller la
  reproductibilité du build

---

## Prochain vrai jalon

**Le backend.** C'est ce qui sépare le prototype de l'outil que 4 commerciaux utilisent
vraiment. Bloqué sur l'infra serveur d'Ocean Boat. Une fois débloqué :
backend → comptes → base vierge → import Excel → déploiement chez eux.
