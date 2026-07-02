# Chantier migration — Décisions & questions ouvertes

Contexte : migration du CRM de **localStorage** (`AppState` JSON, clé
`crm-nautisme-data`) vers une **base relationnelle Turso / libSQL + Prisma**
(même stack que SAForm). Cartographie source : [`00-cartographie-modele.md`](./00-cartographie-modele.md).

---

## ✅ Décisions validées (2026-07-02)

| # | Sujet | Décision |
|---|---|---|
| D1 | **Multi-tenant** | **Une seule org** (Ocean Boat). **Pas** de `org_id`, pas de multi-tenant. |
| D2 | **Auth / users** | Traitée à l'**étape 4** (plus tard). **Pas** de table `users` séparée pour l'instant : la table **`commercials` est la candidate à porter l'auth** (login) — la colonne `email` est le point d'entrée naturel. Aucune structure d'auth créée maintenant. |
| D3 | **Sentinelles `''`** | **Conservées** telles quelles (fidélité au comportement actuel : le code compare à `''`, ex. `lastActionDate || ''`, `nextActionType === ''`). Pas de conversion `'' → NULL`. |
| D4 | **Enums** | En **`String`** avec **validation applicative** (Prisma ne gère pas les enums sur Turso/SQLite). Pas de `CHECK` d'enum en base — la validation reste côté code, comme aujourd'hui. |
| D5 | **Colonnes d'audit** | **`created_at` / `updated_at` systématiques** sur toutes les tables (utile en multi-postes : ordre, débogage, future synchro). |
| D6 | **`source`** | Reste une **string libre** (pas de table référentielle `sources`). |
| D7 | **`defaultGoal`** | **Table dédiée à 1 ligne** (`default_goal`, `id = 1`), pas de table `app_config` clé/valeur générique. |
| D8 | **`GoalMetric` (forme)** | **Aplati en 12 colonnes** sur `commercial_goals` (6 indicateurs fixes × `target`/`override`). **Pas** de table fille `goal_metrics` (indicateurs figés, jointure évitée, reflet direct de l'objet actuel). |

### Conséquences déjà actées sur le schéma (cf. `00`, §6)

- PK en **`TEXT`** partout (accepter UUID `crypto.randomUUID()` **et** ids
  sémantiques legacy `'fred'`, `'contact'`…). Jamais d'`INTEGER AUTOINCREMENT`.
- Dates ISO en **`TEXT`** (`YYYY-MM-DD` / `HH:mm`) — **ne pas** convertir en
  `DATE`/`DATETIME` (préserve les comparaisons de chaînes du métier).
- `GoalMetric` **aplati** en 12 colonnes sur `commercial_goals` (6 metrics × target/override).
- `UNIQUE (year, month, source)` sur `monthly_stats` ;
  `UNIQUE (commercial_id, year, month)` sur `commercial_goals`.
- `ON DELETE CASCADE` sur `lead_actions.lead_id` (reflète `DELETE_LEAD` actuel).

---

## ❓ Questions encore ouvertes (à trancher avant les étapes concernées)

### Q8 — Modèle de synchro / accès aux données (§8 de la cartographie)

Le passage d'un **blob localStorage réécrit en entier** à des **écritures par
ligne** change la sémantique de plusieurs actions du reducer :

- `SAVE_MONTHLY_STATS`, `SAVE_GOALS`, `SAVE_DEFAULT_GOAL` **remplacent tout un
  tableau** → deviennent des **upsert/delete différentiels** côté service.

Points à décider :

- **API par entité** (REST/RPC) exposée par un backend, avec le **reducer conservé
  côté client comme cache optimiste** ? (recommandé : impact minimal sur l'UI)
- **Stratégie d'écriture** : optimiste (UI d'abord, sync en tâche de fond) vs
  bloquante (attendre la confirmation serveur) ?
- **Rafraîchissement multi-postes** : polling simple, revalidation à intervalle,
  ou temps réel (hors scope raisonnable au début) ? Fréquence acceptable ?
- **Gestion de conflits** : « dernier écrit gagne » via `updated_at` suffit-il pour
  4 utilisateurs, ou faut-il un verrouillage optimiste (rejet si `updated_at`
  a changé) ?
- **Où tourne le backend** : Vercel functions (comme SAForm), edge, autre ?
  (recoupe « base partagée multi-postes » du TODO — le grand jalon d'infra).

### Q9 — Stratégie d'import des données existantes (§9 de la cartographie)

Comment amener les données actuelles (dans le localStorage d'un ou plusieurs
postes) dans la nouvelle base, **sans perte** :

- **Source de vérité au basculement** : un **poste de référence** unique dont on
  exporte le `crm-nautisme-data` ? Que fait-on des localStorage divergents des
  autres postes (aujourd'hui chacun est isolé) ?
- **Script d'import unique** qui lit l'export JSON et applique **les hydratations
  déjà en place** (cf. `00`, §5) AVANT insertion :
  - templates : `emailTemplates` legacy + normalisation `type`,
  - goals : retrait `calls`, garantie des 6 metrics,
  - acquisition : `mergeAcquisition` (repli `acquisitionVolumes`, idempotent),
  - nulles : `calendarEvents`/`goals`/`defaultGoal` absents → vides.
- **Idempotence & rejouabilité** de l'import (pouvoir le relancer sans doublons —
  s'appuyer sur les clés naturelles / PK existantes).
- **Réconciliation des ids sémantiques** : les `commercials` `'fred'`… existent-ils
  déjà côté base (seed) ou l'import les crée-t-il ? Éviter les doublons de
  commerciaux.
- **Validation post-import** : compter les entités avant/après, vérifier les FK,
  rejouer les harnais métier sur un échantillon.

### Q10 — Confirmation de forme (mineur) — ✅ TRANCHÉE → voir **D8**

- **Résolu (2026-07-02) :** `GoalMetric` **aplati en 12 colonnes** sur
  `commercial_goals`. Les 6 indicateurs sont fixes → pas de table fille
  `goal_metrics`. *(L'alternative table fille reste envisageable si, un jour, on
  veut ajouter des indicateurs sans migration de schéma — non retenu aujourd'hui.)*

---

## Statut

- Étape 0 (cartographie) : **faite** (`00-cartographie-modele.md`).
- Décisions D1–D8 : **validées** (D8 = Q10 tranchée).
- Questions **Q8** et **Q9** : **ouvertes**, à trancher au fil des étapes (Q8 avant
  l'étape « couche d'accès / API » = Lot 4, Q9 avant l'étape « import des données »
  = Lot 2). **Q10** : tranchée (→ D8).
- Plan de migration séquencé : proposé pour validation (sera persisté en
  `02-plan-migration.md` une fois validé).
