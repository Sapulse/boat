# Chantier migration — Plan séquencé (validé 2026-07-02)

Migration du CRM de **localStorage** vers **Turso / libSQL + Prisma**.
Cartographie : [`00-cartographie-modele.md`](./00-cartographie-modele.md) ·
Décisions : [`01-decisions.md`](./01-decisions.md).

**Principe directeur (strangler-fig) :** on n'arrache jamais le localStorage d'un
coup. On introduit d'abord une **couture** (couche d'accès abstraite), on construit
la base **à côté** sans la brancher, on bascule **derrière un feature flag** avec
rollback instantané, et la migration des vraies données n'a lieu qu'**une fois
l'import prouvé**. Le CRM reste fonctionnel et déployable à **chaque** lot.

Chaque lot suit le workflow habituel :
`branche → tsc + build + lint + 7 harnais → diff review → merge --ff-only →
CHANGELOG + tag annoté`.

**Chemin critique de décisions :** Q9 avant le Lot 2, Q8 avant le Lot 4 (voir
`01-decisions.md`). Les Lots 1 et 3 ne dépendent **pas** de ces réponses et peuvent
démarrer immédiatement.

---

## Lot 0 — Cartographie & décisions ✅ *(fait)*

- **Fait :** `00-cartographie-modele.md` + `01-decisions.md`.
- **Test :** relecture / validation humaine. Aucun code.

---

## Lot 1 — Infra DB en parallèle (schéma Prisma, zéro impact runtime) ✅ *(fait — v3.20.0)*

- **Fait :** Prisma 7 + provider Turso/libSQL en devDependencies ; `prisma/schema.prisma`
  reflétant la cartographie (§6 du doc 00), 8 modèles ; `prisma.config.ts` (url hors
  schéma) ; 1re migration **locale** générée (`init_crm_schema` sur `dev.db`) ; client
  généré. Scripts `db:*` (build non touché). **Rien n'est importé par `src/`** — le CRM
  tourne toujours à 100 % sur localStorage. **Aucune base Turso prod créée.**
- **Testé :** `prisma validate` OK ; migration locale appliquée ; **build + lint +
  7 harnais (427 assertions) verts**, **bundle applicatif byte-identique** (preuve du
  zéro-impact).
- **Non-régression :** additif pur, hors du bundle app (vérifié : aucune trace Prisma
  dans `dist/`).
- **Forme actée (D8) :** `GoalMetric` **aplati en 12 colonnes** sur
  `commercial_goals` (pas de table fille).
- **Note reportée :** `default_goal` généré en `INTEGER … AUTOINCREMENT DEFAULT 1` ;
  invariant « 1 seule ligne » garanti côté app (upsert `id=1`). Un `CHECK(id=1)` en
  base pourra être ajouté par migration manuelle si on veut le verrouiller.
- **À installer plus tard (Lot 4-5) :** adaptateurs runtime `@prisma/adapter-libsql`
  (Turso) / `@prisma/adapter-better-sqlite3` (local) — inutiles pour
  validate/migrate/generate.

---

## Lot 2 — Script d'import (offline) + résolution Q9

- **Fait :** script autonome (hors app) qui lit un export `crm-nautisme-data`,
  **applique les hydratations existantes** (templates `emailTemplates` + `type`,
  goals sans `calls`, `mergeAcquisition`, nulles `?? []`) puis insère en base. Seed
  des `commercials` sémantiques réconcilié (pas de doublon).
- **Comment on teste :** import d'un **vrai export** dans une DB scratch → comptages
  avant/après par entité, intégrité des FK, **idempotence** (rejouer = 0 doublon),
  rejouer un échantillon des invariants métier (harnais) sur les données importées.
- **Prérequis décision :** **Q9** (poste de référence, source de vérité).
- **Non-régression :** offline, n'entre jamais dans le runtime CRM.

---

## Lot 3 — Couche d'accès abstraite côté client (couture), impl localStorage

- **Fait :** on introduit une **interface repository** (méthodes par entité :
  leads, actions, goals…) et une **première implémentation adossée au
  localStorage/reducer actuel**. `AppContext` passe par cette interface.
  **Comportement strictement identique.**
- **Comment on teste :** **7 harnais verts** (ils testent le vrai reducer, préservé)
  + build + lint ; parcours manuel = app identique. **Refactor à comportement
  constant** — brique la plus importante (point de bascule futur).
- **Non-régression :** aucune donnée ni source ne change ; seule l'indirection est
  ajoutée.

---

## Lot 4 — Backend API par entité (Prisma/Turso) + résolution Q8

- **Fait :** backend (Vercel functions ou infra retenue) exposant des endpoints
  **par entité**, adossés à Prisma. Les actions « remplace tout le tableau »
  (`SAVE_GOALS` / `SAVE_MONTHLY_STATS` / `SAVE_DEFAULT_GOAL`) deviennent des
  **upsert/delete différentiels**. **Pas encore branché** au client par défaut.
- **Comment on teste :** tests d'intégration API + **tests de contrat** rejouant les
  invariants des harnais **côté serveur** (cascade delete, garde-fou min-1 templates,
  `lastActionDate` non-recul, clés `UNIQUE`).
- **Prérequis décision :** **Q8** (forme d'API, stratégie d'écriture, conflits
  `updated_at`, infra).
- **Non-régression :** CRM toujours sur localStorage (flag off).

---

## Lot 5 — Bascule client → API derrière un feature flag

- **Fait :** 2e implémentation du repository (Lot 3) appelant l'API ; sélection par
  **flag env**. Le reducer reste **cache optimiste** côté client. Rollback = flip du
  flag.
- **Comment on teste :** app lancée contre la DB en **staging**, checks de parité
  (mêmes écrans, mêmes chiffres qu'en localStorage), invariants rejoués sur le chemin
  API. Bascule réversible à chaud.
- **Non-régression :** flag off = comportement Lot 3 à l'identique ; flag on = testé
  en staging avant prod.

---

## Lot 6 — Migration des données réelles + cutover production

- **Fait :** exécution de l'import (Lot 2) depuis le poste de référence vers la DB
  **prod** ; activation du flag pour les 4 utilisateurs ; le localStorage n'est plus
  source de vérité (au mieux cache offline).
- **Comment on teste :** validation post-import (comptages, FK, échantillon métier) ;
  fenêtre de bascule avec **export de secours** conservé ; critère de rollback défini
  à l'avance.
- **Non-régression :** l'import ayant été prouvé au Lot 2, le cutover est mécanique
  et réversible (réactiver le flag localStorage + export de secours).

---

## Lot 7 — Auth sur `commercials` *(étape 4, hors scope immédiat)*

- **Fait :** login sur la table `commercials` (email + secret), sessions. Aucune
  table `users` séparée (décision D2).
- **Comment on teste :** parcours d'auth, contrôle d'accès ; sans objet tant que
  Lots 1–6 non faits.

---

## Vue d'ensemble des garanties

| Lot | Impact runtime CRM | Réversibilité | Débloque |
|---|---|---|---|
| 1 | nul (hors bundle) | n/a | schéma |
| 2 | nul (offline) | n/a | Q9, import prouvé |
| 3 | refactor iso-comportement | trivial | la couture de bascule |
| 4 | nul (flag off) | n/a | Q8, API |
| 5 | staging derrière flag | flip du flag | bascule client |
| 6 | cutover prod | export secours + flag | base partagée |
| 7 | — | — | multi-postes authentifié |

---

## Statut

- Plan **validé** le 2026-07-02 (approche strangler-fig + bascule derrière feature
  flag).
- **Lot 0** ✅ (cartographie & décisions) · **Lot 1** ✅ (schéma Prisma, v3.20.0).
- **Q8** (synchro) et **Q9** (poste de référence / export) restent **ouvertes** —
  tranchées au démarrage des Lots 4 et 2 respectivement. **Q10** tranchée (→ D8 :
  `GoalMetric` aplati).
- Prochaines étapes exécutables : **Lot 3** (couche repository côté client, iso-
  comportement — ne dépend d'aucune décision ouverte) ou **Lot 2** (import, dès que
  **Q9** est tranchée).
