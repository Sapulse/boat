# Déploiement du CRM (boat-eta.vercel.app)

> ## 🛑 Retour arrière du lot 2 — deux règles absolues
>
> 1. **Retour arrière UNIQUEMENT dans l'heure qui suit la mise en production.**
>    Au-delà : on corrige en avant (hotfix sur le lot 2), on ne revient pas à
>    `prod-2026-09-16`.
> 2. **Ne JAMAIS utiliser le bouton « Restaurer » de la version `prod-2026-09-16`**
>    (ni pendant un retour arrière, ni après) : sur une base migrée, il vide
>    TOUTES les actions programmées.
>
> Détails et limites : section « Retour arrière » plus bas.

## ⚠️ Tant que la migration Turso du lot 2 n'est pas faite : NE JAMAIS DÉPLOYER `main`

Depuis le commit `b431234` (lot 2, arrêt 1), le code de `main` lit des colonnes et des
tables qui n'existent pas encore en prod (`planned_actions`, `planned_action_people`,
`leads.noNextActionReason`, `lead_actions.kind`…). Déployer `main` avant la migration
bloquerait toute l'équipe sur l'écran « Mise à jour du CRM en cours »
(code `SCHEMA_NON_MIGRE`).

Le lot 2 sera déployé **d'un bloc** après son arrêt 4 : sauvegarde fraîche, répétition
locale, migration Turso, **puis** déploiement du code, dans une fenêtre sans utilisateur
(voir `prisma/MIGRATIONS.md`).

## Ce qui est en prod

Chaque déploiement en prod reçoit un **tag annoté** `prod-AAAA-MM-JJ` (suffixe `-2`, `-3`…
si plusieurs le même jour) sur le commit déployé, poussé sur GitHub :

```bash
git tag -l "prod-*"          # historique des mises en prod
git show prod-2026-09-16     # dernier en date : 78ec522 (lot 1 Neutre)
```

## Correctif urgent pendant le lot 2 (hotfix)

1. **Branche depuis le dernier tag prod**, jamais depuis `main` :
   ```bash
   git fetch --tags
   git switch -c hotfix/<sujet> prod-2026-09-16
   ```
2. **Correctif** minimal, sans rien du lot 2.
3. **Qualité** : `npm run lint`, `npm run typecheck`, `npm test` (harnais), `npm run build`.
   Si le correctif touche l'écran : test sur base jetable (`npx tsx scripts/dev-local-test.ts`).
4. **Commit** sur la branche hotfix, poussée sur GitHub (pas de déploiement automatique).
5. **Déploiement depuis une copie propre de la branche** (jamais depuis le dossier de travail) :
   ```bash
   git worktree add --detach ../deploy-hotfix hotfix/<sujet>
   mkdir ../deploy-hotfix/.vercel
   cp .vercel/project.json ../deploy-hotfix/.vercel/
   cd ../deploy-hotfix && vercel --prod --yes
   cd - && git worktree remove --force ../deploy-hotfix
   ```
   Vérifier avant : `vercel whoami` = `brestoceanboat`, projet `boat`.
6. **Vérification prod en lecture seule** : nouveau hash de bundle, headers (CSP, HSTS…),
   anti-cache, routes `/api/*` en 401 sans session.
7. **Nouveau tag prod** sur le commit déployé :
   ```bash
   git tag -a prod-AAAA-MM-JJ <commit> -m "Hotfix <sujet> — déploiement <id>"
   git push origin prod-AAAA-MM-JJ
   ```
8. **Report du correctif dans `main`** : `git switch main && git cherry-pick <commit>`,
   harnais, commit poussé. Le prochain hotfix part du **nouveau** tag.

## Scripts qui touchent une base

Cible toujours explicite ; écriture en prod = `--apply` **et** `--target=prod` **et**
`BOB_CONFIRM_PROD=bob-brestoceanboat` (voir `scripts/lib/dbTarget.ts`).
Sauvegarde : `npm run backup:prod`.

---

## Mise en production du lot 2 (plan — RIEN n'est exécuté sans GO)

Répétition du 2026-09-16 sur une copie fraîche des données réelles (437 leads,
98 actions, 143 emails) : chargement 6 s, migration à blanc 2 s, `--apply` 126 ms
(dont 56 ms d'écriture), preuve complète ✅, rejeu : 0 ajout ✅, 11 prochaines
actions reprises pour 11 leads (N = N), aucun écart lead / action.

### Ordre exact (fenêtre sans utilisateurs)

| # | Étape | Commande / contrôle | Durée |
|---|---|---|---|
| 0 | Prévenir l'équipe, personne connecté | message ; `vercel whoami` = `brestoceanboat` | 5 min |
| 1 | Figer le code : copie propre de `main` au commit validé | `git worktree add --detach ../deploy-lot2 <commit>` ; copier `.vercel/project.json` | 2 min |
| 2 | Sauvegarde | `npm run backup:prod` → « Restaurable : oui ✅ » ; noter le fichier | 1 min |
| 3 | Migration **à blanc** | `npx tsx scripts/apply-planned-actions-turso.ts --target=prod` → relire colonnes, tables, N reprises | 2 min |
| 4 | **GO** (César) | N à blanc = N attendu ; hôte = `bob-brestoceanboat` | — |
| 5 | Migration réelle | `BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/apply-planned-actions-turso.ts --target=prod --apply` | 1 min |
| 6 | Preuve | les 6 ✅ du script ; relancer `--apply` : 0 ajout | 2 min |
| 7 | Déploiement du code | `cd ../deploy-lot2 && vercel --prod --yes` | 2 min |
| 8 | Vérif prod (lecture seule) | nouveau hash de bundle, headers, `/api/*` en 401 sans session, connexion, Agenda en accueil, pastille = retards attendus, une fiche, la boîte de réception | 10 min |
| 9 | Tag | `git tag -a prod-AAAA-MM-JJ <commit> -m "Lot 2 — <dpl id>"` ; `git push origin prod-AAAA-MM-JJ` | 1 min |
| 10 | Ouvrir à l'équipe, envoyer la fiche | `docs/FICHE-EQUIPE-LOT2.md` relue | — |

**Fenêtre à réserver : 30 min** (≈ 25 min d'opérations + marge), **45 min** avec un
retour arrière complet.

### Scripts de migration, dans l'ordre d'exécution (lots 2 à 5, une seule fenêtre)

Les lots 3, 4 et 5 sont développés sur `main` par-dessus le lot 2 (non déployé) : tout
passe dans la MÊME fenêtre. Aux étapes 3 et 5 du tableau ci-dessus, enchaîner ces
scripts DANS CET ORDRE — d'abord tous à blanc (`--target=prod`), relus, GO, puis tous en
`--apply` avec `BOB_CONFIRM_PROD=bob-brestoceanboat`. Chacun affiche sa preuve et se
rejoue sans effet. La sauvegarde (`backup:prod`) lit une base où seule une partie des
migrations est passée (détection du schéma, `api/_lib/store.detectSchema`).

| # | Lot | Script | Nature |
|---|---|---|---|
| 1 | 2 | `scripts/apply-planned-actions-turso.ts` | 4 colonnes + 2 tables + reprise des prochaines actions |
| 2 | 3 | `scripts/apply-template-layout-turso.ts` | table `template_categories` + colonnes `message_templates.categoryId` / `position` ; aucune donnée réécrite |
| 3 | 3 | `scripts/fusion-sources-turso.ts` | **données** : `leads.source` seulement, table explicite (« http://topbarcos.com/ » → « Top barcos », 1 lead au 17/09) ; sauvegarde intégrée avant écriture ; preuve (même nombre, autres colonnes identiques, répartition attendue) ; rejeu = 0 |

*(Complété au fil des lots 3 à 5.)*

### Retour arrière

> 🛑 **Uniquement dans l'heure qui suit la mise en production.**
> 🛑 **Jamais le bouton « Restaurer » de `prod-2026-09-16`.**

**Principe : on ne revient PAS en arrière sur la base.** La migration est
purement additive (colonnes avec valeur par défaut, 2 tables) : prouvé le
2026-09-16 en faisant tourner le code du tag `prod-2026-09-16` sur une copie migrée
des données réelles — lecture ✅, modification de lead ✅, nouvelle action
(kind `realisee` par défaut) ✅, nouveau lead ✅, suppression d'un lead avec action
programmée (cascade, aucun orphelin) ✅. Seul le **code** revient en arrière.

**Procédure (≈ 5 min)**
1. `vercel rollback dpl_6fCTheuCDSUkmaAhFzPtzKQq59pa --yes` (redéploiement instantané
   de la version du tag `prod-2026-09-16`, sans rebuild). Plan Hobby : seul le
   déploiement de production **immédiatement précédent** est accessible — donc ne
   faire AUCUN autre déploiement prod entre le lot 2 et un éventuel retour arrière.
   À défaut : copie propre du tag + `vercel --prod`.
2. Vérifier le bundle `index-CCw9ZR1e.js`, connexion, une fiche.
3. Prévenir l'équipe : **ne pas utiliser « Restaurer »** tant que le lot 2 n'est pas revenu.
4. Ne rien supprimer en base (tables et colonnes du lot 2 restent, inertes).

**Limites pendant le retour arrière (mesurées sur la copie)**
- **Désynchronisation** : l'ancien code écrit la prochaine action sur le lead
  seulement ; les actions programmées ne suivent pas (test : 12 leads divergents
  après quelques modifications et une restauration).
- **« Restaurer » dans l'ancien code vide TOUTES les actions programmées**
  (cascade à la suppression des leads) : interdit pendant le retour arrière.
- Les traces « report » / « sans suite » écrites pendant le lot 2 apparaissent dans
  l'historique de l'ancien code comme des actions ordinaires et **comptent dans ses
  objectifs** (l'ancien calcul ne filtre pas `kind`) : chiffres du mois gonflés.
- Les motifs « Aucune prochaine action » sont invisibles (conservés en base).
- L'agenda de l'ancien code ne montre qu'une action par lead (celle du lead) :
  les participants ne la voient plus chez eux.

**Revenir ensuite au lot 2 (re-déploiement)** : les champs du lead font foi
(ce sont les plus récents). ATTENTION : depuis `1f5940d`, le serveur du lot 2
recalcule le résumé du lead depuis ses actions programmées à CHAQUE écriture du
lead ou de ses actions — sans réalignement préalable, la première modification
d'un lead touché pendant le retour arrière ramènerait l'ANCIENNE date de l'action
programmée sur le lead. AVANT de redéployer, il faut donc un script de
**réalignement** — À ÉCRIRE si on veut garder cette porte ouverte :
- lead non Signé / Perdu avec prochaine action ≠ action à faire → mettre à jour
  l'action à faire (ou l'annuler et en créer une) ;
- lead avec prochaine action et aucune action À FAIRE → créer (le script de
  reprise actuel ne crée que pour un lead SANS AUCUNE action programmée, même
  faite ou annulée) ;
- lead sans prochaine action mais avec une action à faire → l'annuler.
Sans ce script : agenda faux pour les leads touchés pendant le retour arrière.
**Recommandation** : un retour arrière ne se décide que dans l'heure qui suit la
mise en production ; au-delà, corriger en avant (hotfix sur le lot 2).

---

## Migration vers le VPS SAPulse (OVH) — dépendances Vercel à traiter

Aucune fonctionnalité des lots 3 à 5 ne dépend de Vercel (pas de cron, pas d'API ni
d'en-tête spécifique, pas de stockage Vercel ; les nouvelles routes sont de simples
`case` du routeur `api/[...slug].ts`). Trois dépendances EXISTANTES sont à reprendre
au moment du passage au VPS :

1. **`vercel.json`** : en-têtes de sécurité (CSP stricte `script-src 'self'`,
   `connect-src 'self'`, HSTS…), réécriture `/api/(.*)` → `/api/[...slug]`, règles de
   cache (`no-store` sur `/api`). À reproduire dans le serveur web du VPS.
2. **Types `@vercel/node`** (`VercelRequest` / `VercelResponse`) dans `api/[...slug].ts`,
   `api/_lib/http.ts`, `api/_lib/auth.ts` et `scripts/harness-api.ts` : le handler
   n'utilise que `status / json / end / setHeader` + `body / headers / url` — un
   adaptateur Node `http` minimal suffit (même principe que `scripts/dev-local-test.ts`).
3. **Base Vite selon `VERCEL`** (`vite.config.ts` : `base: process.env.VERCEL ? '/' : '/boat/'`) :
   fixer explicitement la base voulue sur le VPS.

