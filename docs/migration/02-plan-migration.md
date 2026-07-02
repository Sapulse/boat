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

**Partie CODE (local)** ✅ *(fait — v3.21.0)* :
- API **par entité** (Vercel Functions, `api/`) adossée à Prisma, **portier** entre
  l'app et Turso (le secret reste côté serveur) : factory adaptateur **libSQL**
  (Turso ou `file:./dev.db`), garde par **jeton `API_SHARED_TOKEN`**, validation des
  enums, mappers domaine↔Prisma. CRUD par entité + **batch** (`SAVE_GOALS` /
  `SAVE_MONTHLY_STATS` / `SAVE_DEFAULT_GOAL` → **upsert/delete différentiels**) +
  `/api/state`. **Serveur mince** (logique dérivée = reducer client ; invariants
  serveur = cascade FK + UNIQUE).
- **Testé sans cloud** : `scripts/harness-api.ts` (base libSQL fichier jetable) — 24
  assertions (CRUD, cascade, UNIQUE, batch, enum) ; build + lint + `api:typecheck` +
  8 harnais verts. **Non branché** (CRM sur localStorage) — zéro impact.

**Partie INFRA (web)** :
- ✅ Base **Turso région UE (Irlande `aws-eu-west-1`)** créée (compte **BrestOceanBoat**,
  le client héberge ses données) → `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`.
- ✅ **Projet Vercel** (compte **BrestOceanBoat**, préset Vite, option A même origine)
  relié à `Sapulse/boat` + 3 env vars (`TURSO_*`, `API_SHARED_TOKEN`). **Déployé** :
  `https://boat-eta.vercel.app` (app + API en ligne). API regroupée en **1 fonction**
  (catch-all) pour tenir sous la limite Hobby (12).
- ⏳ **Push du schéma** (`npm run db:push:turso`, `.env` local avec les 2 secrets Turso)
  → base **vierge** prête (D9), 8 tables.
- ⏳ Smoke test `curl` de l'API (avec le jeton).

- **Décision actée :** **D10** (Q8). **Non-régression :** CRM toujours sur localStorage
  (GitHub Pages en `/boat/` inchangé ; Vercel en base `/`).

### ⚠️ Suivi sécurité (à faire à froid, avant le vrai go-live)
- **Régénérer le `TURSO_AUTH_TOKEN`** : l'actuel a été exposé en clair dans un échange
  (commande CLI qui a déraillé). Sans gravité tant que la base est **vide**, mais à
  **révoquer/regénérer** dans Turso, puis mettre à jour la variable dans **Vercel** et
  le `.env` local. À planifier avant que des vraies données arrivent (import Excel).
- **Régénérer aussi `API_SHARED_TOKEN`** au go-live (il a transité par un transcript
  d'assistant lors de la mise en place). Rotation simple : nouvelle valeur → env var
  Vercel → (Lot 5) le client.

---

## Lot 5 — Bascule client → API derrière un feature flag

**Partie CODE** ✅ *(fait)* :
- 2ᵉ implémentation `createApiRepository` (`src/lib/repository.ts`) satisfaisant le MÊME
  contrat `CrmRepository`. Mutations = **dispatch optimiste** (réutilise l'impl
  localStorage) ; **synchro par diff réactif dans `persist`** (D10) : diff `state` vs
  dernier état confirmé serveur → appels par entité (POST/PATCH/DELETE + PUT batch),
  **champs dérivés inclus** (le diff voit l'état post-reducer → serveur mince préservé).
  Appels sérialisés (FK). **Échec → `onError` + re-hydratation** (`GET /state` →
  `SET_STATE`), pas d'annulation inverse.
- **Hydratation** : `getInitialState` = état vide (flag on) ; `hydrate()` async
  (`GET /api/state`) sous un **loading gate** dans `AppProvider`.
- **Feature flag** `VITE_USE_API` : `AppProvider` choisit l'impl. **Flag OFF (défaut) =
  localStorage à l'identique** (init sync, pas de loading, `persist=saveState`) → **zéro
  changement commerciaux**. Prouvé : 8 harnais inchangés verts + build flag-off/flag-on.
- **Testé sans serveur** : `scripts/harness-api-client.ts` (fetch simulé + vrai reducer)
  — 17 assertions (hydrate, optimiste+dérivés, diff no-op, cascade, échec→re-sync).
- **Comment on teste (flag on)** : sur **Vercel** (`VITE_USE_API=true` + `VITE_API_TOKEN`
  en env vars), l'URL Vercel devient l'app de test adossée à l'API/Turso ; parité vs
  localStorage. Prod GitHub Pages (commerciaux) reste **flag off**. Réversible = flip.

### 🔒 Compromis token client (VITE_API_TOKEN) — STAGING UNIQUEMENT, TEMPORAIRE
Le token d'API mis dans `VITE_API_TOKEN` est **exposé dans le bundle client (public)**.
Toléré **en staging seulement**, sous **3 conditions cumulatives obligatoires** :
1. **base vierge / données de test** uniquement (aucune donnée réelle client) ;
2. **Vercel Deployment Protection activée** sur le déploiement de test (URL non publique) ;
3. usage **documenté comme temporaire** (ce doc + commentaire ⚠️ dans le code / `.env.example`).

**INTERDICTION FORMELLE de partir en prod ainsi.** La vraie réponse = **auth par
utilisateur (Lot 7)** : le token statique partagé disparaît au profit de sessions.
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
