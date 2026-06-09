# Changelog

Toutes les évolutions notables de **CRM Brest Ocean Boat**.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/) ; versionnage [SemVer](https://semver.org/lang/fr/).

App : SPA React + Vite + TypeScript, persistance localStorage, déployée sur GitHub Pages.

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

[3.0.2]: https://github.com/Sapulse/boat/releases/tag/v3.0.2
[3.0.1]: https://github.com/Sapulse/boat/releases/tag/v3.0.1
[3.0.0]: https://github.com/Sapulse/boat/releases/tag/v3.0.0
