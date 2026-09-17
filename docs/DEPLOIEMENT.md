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

## Mise en production des lots 2 à 5 — v4.0.0 (plan — RIEN n'est exécuté sans GO)

Répétition du 2026-09-16 (lot 2 seul) sur une copie fraîche des données réelles (437 leads,
98 actions, 143 emails) : chargement 6 s, migration à blanc 2 s, `--apply` 126 ms
(dont 56 ms d'écriture), preuve complète ✅, rejeu : 0 ajout ✅, 11 prochaines
actions reprises pour 11 leads (N = N), aucun écart lead / action.

**Répétition COMPLÈTE du 2026-09-17 (lots 2 à 5, v4.0.0)** sur une copie de
`backup:prod` du jour (438 leads, 98 actions, 16 modèles, 21 stats mensuelles,
146 emails) : sauvegarde 6 s, chargement 6 s ; les 5 scripts à blanc (≈ 2 s chacun)
puis en `--apply` dans l'ordre ci-dessous, **toutes les preuves ✅** (11 reprises,
1 source fusionnée, 3 réseaux créés) ; rejeu complet sans effet (empreinte de TOUTES
les tables identique avant / après un 2e rejeu) ; app chargée sans erreur console
(Agenda, Leads, fiche, Dashboard, Modèles, Objectifs de la semaine, Acquisition +
Réseaux sociaux) ; ≈ 3 min 20 de bout en bout ; copie supprimée.

### Ordre exact (fenêtre sans utilisateurs)

| # | Étape | Commande / contrôle | Durée |
|---|---|---|---|
| 0 | Prévenir l'équipe, personne connecté | message ; `vercel whoami` = `brestoceanboat` | 5 min |
| 1 | Figer le code : copie propre de `main` au commit validé (v4.0.0) | `git worktree add --detach ../deploy-v4 <commit>` ; copier `.vercel/project.json` | 2 min |
| 2 | Sauvegarde | `npm run backup:prod` → « Restaurable : oui ✅ » ; noter le fichier | 1 min |
| 3 | Migrations **à blanc** : les **5 scripts dans l'ordre** du tableau suivant | `npx tsx scripts/<script>.ts --target=prod` × 5 → relire colonnes, tables, N reprises (≈ 11), 1 source à fusionner, 3 réseaux à créer | 4 min |
| 4 | **GO** (César) | chiffres à blanc = attendus ; hôte = `bob-brestoceanboat` | — |
| 5 | Migrations réelles, **mêmes 5 scripts, même ordre** | `BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/<script>.ts --target=prod --apply` × 5 ; **arrêt au premier ❌** | 3 min |
| 6 | Preuve | tous les ✅ de chaque script ; relancer les 5 `--apply` : rien à faire, 0 ajout, 0 lead modifié | 3 min |
| 7 | Déploiement du code | `cd ../deploy-v4 && vercel --prod --yes` | 2 min |
| 8 | Vérif prod (lecture seule) | nouveau hash de bundle, headers, `/api/*` en 401 sans session, connexion, **v4.0.0** en bas du menu, Agenda en accueil, pastille = retards attendus, une fiche, la boîte de réception, Dashboard (3 indicateurs), Modèles, Objectifs de la semaine, Acquisition › Réseaux sociaux (3 réseaux) | 12 min |
| 9 | Tag | `git tag -a prod-AAAA-MM-JJ <commit> -m "v4.0.0 — lots 2 à 5 — <dpl id>"` ; `git push origin prod-AAAA-MM-JJ` | 1 min |
| 10 | Recompter « Le premier jour » (lecture seule), puis ouvrir à l'équipe et envoyer la fiche | `docs/FICHE-EQUIPE-LOT2.md` relue | 5 min |

**Fenêtre à réserver : 45 min** (≈ 38 min d'opérations + marge), **60 min** avec un
retour arrière complet.

**Rotation du token Turso (option, en fin de parcours — PAS dans la fenêtre)** : elle
impose un nouveau déploiement (variable d'environnement Vercel), ce qui ferme la porte
du `vercel rollback` (seul le déploiement immédiatement précédent est accessible) —
donc **uniquement après l'heure du retour arrière**, le soir de la mise en prod (ou à la
bascule VPS). Pré-requis : la CLI `turso` (absente du poste au 17/09 — l'installer, ou passer
par le tableau de bord Turso). Déroulé (≈ 10 min, CRM indisponible de 1 à 4) — l'invalidation AVANT la création
(elle invaliderait aussi un jeton créé juste avant) ; vérifier la syntaxe avec
`turso db tokens --help` :
1. invalider les jetons existants : `turso db tokens invalidate bob-brestoceanboat`
   (TOUS les jetons de la base — le CRM en prod ne répond plus jusqu'à l'étape 4) ;
2. nouveau jeton : `turso db tokens create bob-brestoceanboat` ;
3. remplacer `TURSO_AUTH_TOKEN` dans Vercel (Production) et dans le `.env` local ;
4. redéployer le MÊME commit (`vercel --prod --yes` depuis la copie propre) ;
5. vérifier : connexion, une fiche, `npm run backup:prod` → « Restaurable : oui ✅ » ;
   l'ancien jeton est refusé.

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
| 4 | 4 | `scripts/apply-weekly-objectives-turso.ts` | table neuve `weekly_objectives` + 2 index ; aucune table existante touchée, aucune donnée écrite ; preuve (commerciaux, leads, actions programmées identiques ; table vide) ; rejeu = rien à faire |
| 5 | 5 | `scripts/apply-social-turso.ts` | tables neuves `social_networks` + `social_stats` + index unique (réseau, année, mois) ; **3 réseaux par défaut** (Facebook, Instagram, LinkedIn, identifiants fixes, `INSERT OR IGNORE` : un réseau renommé ou archivé n'est jamais réécrit) ; aucune table existante touchée (`monthly_stats` comprise) ; preuve (commerciaux, leads, stats mensuelles identiques ; tables, index, colonnes ; 3 réseaux ; aucune stat) ; rejeu = rien à faire |

*(Liste complète des lots 2 à 5.)*

### Retour arrière

> 🛑 **Uniquement dans l'heure qui suit la mise en production.**
> 🛑 **Jamais le bouton « Restaurer » de `prod-2026-09-16`.**

**Principe : on ne revient PAS en arrière sur la base.** Les migrations sont
purement additives (colonnes avec valeur par défaut, tables neuves) : prouvé le
2026-09-16 en faisant tourner le code du tag `prod-2026-09-16` sur une copie migrée
des données réelles — lecture ✅, modification de lead ✅, nouvelle action
(kind `realisee` par défaut) ✅, nouveau lead ✅, suppression d'un lead avec action
programmée (cascade, aucun orphelin) ✅. Seul le **code** revient en arrière.
**Re-prouvé le 2026-09-17 avec les 5 migrations** (lots 2 à 5) : copie de
`bob-crm-sauvegarde-2026-09-17-14h00` (438 leads), les 5 scripts en `--apply`, puis le
code du tag `prod-2026-09-16` (copie propre du tag, banc local) sur cette base :
chargement sans erreur console ✅ (v3.13.0), Leads ✅, fiche ✅, modification d'un lead
(commentaire) ✅, prochaine action modifiée sur la fiche ✅, ajout d'une action avec
prochaine action ✅ (kind `realisee` par défaut), Modèles : les 16 affichés ✅ et
création d'un 17e ✅ (sans catégorie, position 0), Acquisition : saisie de septembre ✅
(`monthly_stats` 21 → 22, les 21 lignes d'origine identiques), boîte de réception ✅ ;
aucune écriture refusée. Retour ENSUITE au code `main` (v4.0.0) sur la MÊME base :
Agenda, Dashboard, Modèles (le 17e modèle dans « Non classés »), Objectifs de la
semaine, Acquisition › Réseaux sociaux (3 réseaux) chargés sans erreur ✅ ; le simple
chargement de la v4 n'écrit rien (empreinte de la base identique).
**Désynchronisé par le passage sur l'ancien code — exactement les prochaines actions
modifiées, rien d'autre** (vérifié lead par lead) :
- prochaine action **reportée** sur la fiche (lead au 22/09) : l'action programmée reste
  au 14/08 → la v4 affiche le 14/08 dans la fiche et l'Agenda, et la compte **en retard** ;
- action **ajoutée avec une prochaine action** (relance au 20/09 sur le lead) : aucune
  action programmée créée → la v4 affiche « Aucune action planifiée » dans la fiche et
  rien dans l'Agenda, mais ne compte pas le lead dans « À planifier » (252 → 251 : le
  filtre lit le résumé du lead).
Limite du test : la prod n'a encore aucune catégorie de modèles (0 avant, 0 après) ;
les réseaux sociaux et objectifs de la semaine sont ignorés par l'ancien code.

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
  seulement ; les actions programmées ne suivent pas (test du 16/09 : 12 leads divergents
  après quelques modifications et une restauration ; test du 17/09 : 2 leads touchés,
  2 leads divergents — voir ci-dessus).
- Pendant le retour arrière, les onglets et écrans des lots 3 à 5 disparaissent
  (catégories de modèles, Objectifs de la semaine, Réseaux sociaux). L'ancien code ne lit
  ni n'écrit leurs tables (hors « Restaurer », interdit) : elles sont conservées et
  réapparaissent au retour de la v4 (tables vides le 17/09 : non vérifié avec des données).
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

