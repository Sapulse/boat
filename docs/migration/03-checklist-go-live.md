# Checklist go-live — bascule sur données réelles

Points à valider **AVANT** d'activer le flag API pour les commerciaux avec de
vraies données clients. Issue de l'audit sécurité/intégrité/backup du 2026-07-02.
Complète le plan de migration ([`02-plan-migration.md`](./02-plan-migration.md)).

---

## 💾 Backup de la base Turso — statut : 🔴 audit → **atténué (natif) + planifié (externe)**

### 1. ✅ Backup natif Turso — ACTIF (automatique)
- **Point-in-Time Recovery, fenêtre 24 h** (plan Free actuel) : backups continus
  à chaque COMMIT, **rien à activer**. Couvre les **incidents récents** (erreur ou
  suppression découverte dans la journée).
- Restauration : `turso db create <nouvelle-base> --from-db boat-crm --timestamp <ISO>`
  → crée une **nouvelle** base à l'instant T (n'écrase jamais l'existante), puis
  **repointer** `TURSO_DATABASE_URL` dans Vercel.
- Les backups natifs restent chez Turso, attachés à la base (**région UE — Irlande**).
- Limite assumée : 24 h — un incident découvert tardivement n'est pas couvert par
  cette couche seule (d'où la couche 2). *(Option : plan Turso payant → fenêtre
  étendue à ~10-90 j selon palier.)*

### 2. ⏳ Export externe indépendant — À METTRE EN PLACE AVANT LE GO-LIVE
- **Quoi** : dump complet régulier (`turso db shell boat-crm .dump > backup-<date>.sql`)
  + **automatisation** (type GitHub Action planifiée, ou tâche planifiée) +
  **rétention plus longue** que le PITR natif.
- **Stockage : à choisir le moment venu**, avec ces **contraintes non négociables** :
  - **région UE** (données personnelles clients — RGPD) ;
  - **chiffré** ;
  - **JAMAIS dans le repo git** (ni en artefact public) ;
  - **durée de conservation RGPD définie** (rétention glissante, ex. 30 j) et
    **accès restreint** (registre de traitement du client).
- **Procédure de restauration documentée + TESTÉE** (base scratch + vérification
  des comptages) avant le go-live — un backup jamais restauré n'est pas un backup.

---

## 🔐 Sécurité — rappels déjà consignés (détail dans `02-plan-migration.md`)

- ⏳ **Rotation `TURSO_AUTH_TOKEN` + `API_SHARED_TOKEN`** à froid avant le go-live
  (tous deux ont transité en clair pendant la mise en place).
- ⏳ **Confirmer la Deployment Protection Vercel** sur le déploiement de test tant
  que `VITE_API_TOKEN` (staging only) est dans le bundle.
- ⛔ `VITE_API_TOKEN` **interdit en prod** — la vraie réponse est l'auth (Lot 7).

## 🛠️ Correctifs issus de l'audit (suivi)

| Correctif | Statut |
|---|---|
| #1 Backup | **Atténué (natif 24 h) + planifié (externe avant go-live)** — cf. ci-dessus |
| #2 Validation des entrées API | En cours de cadrage |
| #3 Concurrence multi-postes (staleness + PATCH entité complète) | À traiter avant usage multi-utilisateurs |
| #4 File de synchro non gardée à la fermeture (`beforeunload`) | À traiter avant go-live |
