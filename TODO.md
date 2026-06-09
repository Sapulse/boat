# CRM Brest Ocean Boat — Roadmap & TODO

État au jalon **V3** (tag `v3.0.0`). Ce fichier sert de fil conducteur entre sessions.

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

## ➕ FONCTIONNALITÉS EN PLUS (faisables sur l'archi actuelle, sans backend)

- [ ] **Couche IA email** : pré-rédaction d'un mail lisant la fiche du lead. Terrain prêt
  (templates existent). Nécessite une clé API.
- [ ] **Règle auto-relance** : passage auto en relance après X jours (demande réunion).
  Détection déjà là (`getLeadRisks`) ; reste à formaliser l'automatisme SI Ocean Boat le
  confirme (ils ont laissé ouvert).
- [ ] **Connexion Infocob** (leur CRM) : bouton "ajouter sur Infocob". Phase lointaine,
  dépend de l'API Infocob.

---

## ❓ DÉCISIONS OUVERTES CÔTÉ OCEAN BOAT

- [ ] **Infra serveur** → débloque le choix backend (cloud vs auto-hébergé)
- [ ] **Fichier Excel** : confirmer format (csv/xlsx), signification de "DV"/"BO",
  liste complète des commerciaux et des sources
- [ ] **Jeu de statuts définitif** + règle auto-relance (à valider à l'usage)

---

## 🐛 DETTE TECHNIQUE / À SURVEILLER (non bloquant)

- [ ] `npm audit fix` (F1/F3 du rapport sécurité : react-router CVE non exploitables ici,
  postcss/brace-expansion build-time) — lot dépendances dédié
- [ ] Le Dashboard refait des filtres "à relancer" inline au lieu de réutiliser
  `getLeadRisks` (redondance logique avec la vue À relancer) — à unifier un jour
- [ ] Lockfile : `name` = "boat-temp" (cosmétique)
- [ ] Versions de dépendances très avancées (React 19, Vite 8, TS 6) — surveiller la
  reproductibilité du build

---

## Prochain vrai jalon

**Le backend.** C'est ce qui sépare le prototype de l'outil que 4 commerciaux utilisent
vraiment. Bloqué sur l'infra serveur d'Ocean Boat. Une fois débloqué :
backend → comptes → base vierge → import Excel → déploiement chez eux.
