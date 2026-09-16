# Déploiement du CRM (boat-eta.vercel.app)

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
