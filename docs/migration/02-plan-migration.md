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

## Lot 2 — ❌ SUPPRIMÉ / SANS OBJET (décision D9)

La base démarre **vierge** : les données de dev localStorage sont **jetables**, il
n'y a **rien à exporter/réimporter**. Ce lot (export localStorage → réimport) et sa
question **Q9** sont **caducs**.

> **Import Excel initial** (opération post-bascule, hors couture) : les vraies
> données du client arriveront **plus tard**, via un **import du fichier Excel** —
> opération **séparée**, à cadrer le moment venu (mapping esquissé :
> `mapping-import-excel.md`). Ce n'est **pas** un lot de la couture de migration.

---

## Lot 3 — Couche d'accès abstraite côté client (couture), impl localStorage ✅ *(fait)*

- **Fait :** interface **`CrmRepository`** (`src/lib/repository.ts`) couvrant toute la
  surface de données (leads, actions, commerciaux, templates, agenda, goals,
  monthlyStats, defaultGoal + hydratation `getInitialState` / persistance `persist`) +
  implémentation **`createLocalStorageRepository(dispatch)`** adossée au reducer et à
  `saveState` existants. `AppContext` route **tout** via le repository (plus d'appel
  direct au stockage) ; `dispatch` brut **retiré** de la surface du contexte (les
  commerciaux passent par `addCommercial/updateCommercial/toggleCommercial`).
- **Testé :** **build + lint + 7 harnais verts** (le reducer, source des effets
  dérivés, est **inchangé** → preuve de l'iso-comportement). Persistance conservée en
  `useEffect([state])` (timing identique) ; génération d'id inchangée (client).
- **Non-régression :** aucune donnée ni source ne change ; seule l'indirection est
  ajoutée. Prépare le Lot 5 (2ᵉ impl API derrière la **même** interface).

---

## Lot 4 — Backend API par entité (Prisma/Turso) + infra (Q8 → D10)

- **Fait :** base **Turso/libSQL (région UE)** + projet **Vercel** ; API **par
  entité** (Vercel Functions) adossée à Prisma, **portier** entre l'app et Turso (le
  secret Turso reste côté serveur). Les actions « remplace tout le tableau »
  (`SAVE_GOALS` / `SAVE_MONTHLY_STATS` / `SAVE_DEFAULT_GOAL`) deviennent des
  **upsert/delete différentiels**. **Pas encore branché** au client par défaut.
- **Comment on teste :** tests d'intégration API + **tests de contrat** rejouant les
  invariants des harnais **côté serveur** (cascade delete, garde-fou min-1 templates,
  `lastActionDate` non-recul, clés `UNIQUE`).
- **Décision actée :** **D10** (Q8) — synchro **optimiste**, **API par entité**,
  conflits **last-write-wins** (`updated_at`). Plus aucune décision en attente.
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

## Lot 6 — Cutover production (TRIVIAL, base vierge — décision D9)

- **Fait :** activation du flag API pour les utilisateurs, **sur une base vierge**.
  **Aucune migration de données** (D9 : rien à reprendre du localStorage).
- **Comment on teste :** l'app démarre proprement sur la base vierge (mêmes écrans,
  listes vides), les premières écritures atterrissent bien en base.
- **Non-régression :** réversible (flip du flag). *(Le remplissage réel de la base =
  import Excel, opération séparée post-bascule — voir Lot 2 supprimé.)*

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
| 1 ✅ | nul (hors bundle) | n/a | schéma |
| 2 | ❌ supprimé (D9 : base vierge) | — | — |
| 3 ✅ | refactor iso-comportement | trivial | la couture de bascule |
| 4 | nul (flag off) | n/a | Q8, API |
| 5 | staging derrière flag | flip du flag | bascule client |
| 6 | cutover base vierge (trivial) | flip du flag | base partagée |
| 7 | — | — | multi-postes authentifié |

---

## Statut

- Plan **validé** le 2026-07-02 (approche strangler-fig + bascule derrière feature
  flag).
- **Lot 0** ✅ (cartographie & décisions) · **Lot 1** ✅ (schéma Prisma, v3.20.0) ·
  **Lot 3** ✅ (couche repository, v3.20.1). **Lot 2** ❌ supprimé (D9).
- **Toutes les décisions sont tranchées** : **Q8** → D10 (synchro optimiste / API par
  entité / last-write-wins), **Q9** caduque (D9), **Q10** → D8.
- Prochaine étape exécutable : **Lot 4** (backend API par entité + base Turso région
  UE + projet Vercel) — plus aucune décision en attente. *(Le remplissage réel =
  import Excel, post-bascule.)*
