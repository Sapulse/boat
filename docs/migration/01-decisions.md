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
| D9 | **Données au démarrage** | La base démarre **VIERGE**. Les données de dev actuelles (localStorage) sont **jetables** — rien à migrer. Les vraies données viendront **plus tard, via un IMPORT du fichier Excel du client** (opération séparée, **post-bascule**, à cadrer le moment venu). **Conséquences :** le **Lot 2** (export localStorage → réimport) est **supprimé / sans objet** ; **Q9 devient caduque** ; le **Lot 6** (cutover) devient **trivial** (activer le flag sur une base vierge, aucune migration de données). |

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

### Q9 — Stratégie d'import des données existantes — ❌ CADUQUE → voir **D9**

**Sans objet (décision D9, 2026-07-02) :** la base démarre **vierge**, les données
de dev localStorage sont **jetables**. Il n'y a donc **pas** d'export/réimport du
localStorage (Lot 2 supprimé). Les vraies données arriveront **plus tard** via un
**import du fichier Excel du client** — opération **séparée et post-bascule**, à
cadrer le moment venu (mapping déjà esquissé côté projet : `mapping-import-excel.md`
au TODO). Les questions d'idempotence / réconciliation / validation seront reprises
**à ce moment-là**, pour l'import Excel, pas pour un import localStorage.

### Q10 — Confirmation de forme (mineur) — ✅ TRANCHÉE → voir **D8**

- **Résolu (2026-07-02) :** `GoalMetric` **aplati en 12 colonnes** sur
  `commercial_goals`. Les 6 indicateurs sont fixes → pas de table fille
  `goal_metrics`. *(L'alternative table fille reste envisageable si, un jour, on
  veut ajouter des indicateurs sans migration de schéma — non retenu aujourd'hui.)*

---

## Statut

- Étape 0 (cartographie) : **faite** (`00-cartographie-modele.md`).
- Décisions D1–D9 : **validées** (D8 = Q10 tranchée ; D9 = base vierge).
- Question **Q8** (synchro) : **ouverte**, à trancher avant le Lot 4 (API).
- **Q9** : **caduque** (→ D9, base vierge / import Excel post-bascule). **Q10** :
  tranchée (→ D8).
- Lots faits : **0** (cartographie), **1** (schéma Prisma, v3.20.0), **3** (couche
  repository, iso-comportement). **Lot 2 supprimé** (D9).
