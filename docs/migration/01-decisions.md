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
| D10 | **Modèle de synchro** (Q8 tranchée) | **Écriture OPTIMISTE** (l'UI applique la mutation localement d'abord — le reducer reste le cache — puis synchronise en tâche de fond) + **API PAR ENTITÉ** (endpoints par entité ; les actions « remplace tout le tableau » — `SAVE_GOALS`/`SAVE_MONTHLY_STATS`/`SAVE_DEFAULT_GOAL` — deviennent des **upsert/delete différentiels**) + **conflits « last-write-wins »** (dernier écrit gagne via `updated_at` ; pas de verrouillage optimiste, adapté à ~4 utilisateurs). |

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

### Q8 — Modèle de synchro / accès aux données — ✅ TRANCHÉE → voir **D10**

**Résolu (2026-07-02) :** synchro **OPTIMISTE** + **API PAR ENTITÉ** + conflits
**« last-write-wins »** (via `updated_at`). Backend sur **Vercel** (functions),
base **Turso/libSQL** (région UE). Le reducer reste le **cache optimiste** côté
client ; les actions « remplace tout le tableau » deviennent des upsert/delete
différentiels côté service.

*Points laissés au cadrage du Lot 4 (implémentation, pas décision de principe) :*
rafraîchissement multi-postes (revalidation légère type polling/refetch au focus,
temps réel hors scope initial) ; granularité exacte des endpoints ; format d'erreur
et de réconciliation optimiste (rollback du cache si le serveur rejette).

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
- Décisions D1–D10 : **validées** (D8 = Q10 ; D9 = base vierge ; D10 = Q8 synchro).
- **Toutes les questions ouvertes sont tranchées** : **Q8** → D10 (synchro optimiste
  / API par entité / last-write-wins) ; **Q9** caduque (→ D9) ; **Q10** → D8.
- Lots faits : **0** (cartographie), **1** (schéma Prisma, v3.20.0), **3** (couche
  repository, v3.20.1). **Lot 2 supprimé** (D9). **Prochain : Lot 4** (backend API +
  base Turso région UE + projet Vercel) — plus aucune décision en attente.
