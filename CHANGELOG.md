# Changelog

Toutes les évolutions notables de **CRM Brest Ocean Boat**.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/) ; versionnage [SemVer](https://semver.org/lang/fr/).

App : SPA React + Vite + TypeScript, persistance localStorage, déployée sur GitHub Pages.

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

[3.1.5]: https://github.com/Sapulse/boat/releases/tag/v3.1.5
[3.1.4]: https://github.com/Sapulse/boat/releases/tag/v3.1.4
[3.1.3]: https://github.com/Sapulse/boat/releases/tag/v3.1.3
[3.1.2]: https://github.com/Sapulse/boat/releases/tag/v3.1.2
[3.1.1]: https://github.com/Sapulse/boat/releases/tag/v3.1.1
[3.1.0]: https://github.com/Sapulse/boat/releases/tag/v3.1.0
[3.0.2]: https://github.com/Sapulse/boat/releases/tag/v3.0.2
[3.0.1]: https://github.com/Sapulse/boat/releases/tag/v3.0.1
[3.0.0]: https://github.com/Sapulse/boat/releases/tag/v3.0.0
