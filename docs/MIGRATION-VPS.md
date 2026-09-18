# Audit de migration — CRM Ocean Boat : Vercel + Turso → VPS SAPulse

> **Audit du 2026-09-18 — LECTURE SEULE.** Rien n'a été codé, `main` reste gelée en v4.0.0,
> la prod et la base n'ont pas été modifiées. Les seules requêtes passées sur la base de prod
> sont des `SELECT` / `PRAGMA` de comptage. **Aucune commande n'a été exécutée sur le VPS.**
>
> Cadre repris des références SAPulse (GUIDE PROJET INFRASTRUCTURE v2.7, PASSEPORT TECHNIQUE v3.8,
> GUIDE D'EXPLOITATION v3.2, ARCHITECTURE/SÉCURITÉ/CONFORMITÉ v3.2) et des **5 règles non
> négociables** : aucun port publié, ne pas toucher à DOCKER-USER/UFW, ne pas toucher à
> l'existant, secrets en `.env` 600 hors Git, vérifier plutôt que supposer.
> Méthode **B** (docker-compose manuel) : volume persistant + migrations + garde de démarrage.
> **Un lot validé avant le suivant.**
>
> ⚠️ **Portée de ce document.** Il décrit **le CRM** et ce que la bascule lui impose. Tout ce qui
> décrit l'**infrastructure du parc SAPulse** (procédure du reverse proxy, fonctionnement et
> périmètre de la sauvegarde, accès d'administration, voisinage de la machine) reste **hors de ce
> dépôt** : voir le **GUIDE PROJET INFRASTRUCTURE**, le **GUIDE D'EXPLOITATION** et la **fiche
> locale** tenue hors Git (chemin connu de César, à déposer dans le coffre à secrets SAPulse).
> En cas d'écart, **les guides priment sur ce rapport**.
>
> Le texte exact des §7.2 / §7.3 des guides n'a pas pu être relu pendant l'audit : les renvois
> ci-dessous sont à confirmer à la lecture.

**Sommaire** — 1. Dépendances Vercel · 2. Application en conteneur · 3. Base de données ·
4. Secrets · 5. Réseau, domaine, proxy · 6. Exploitation · 7. Bascule et retour arrière ·
8. RGPD / art. 28 · 9. Récapitulatif (charges, blocages, à vérifier sur le serveur)

---

## 1. Inventaire des dépendances Vercel

### 1.1 `vercel.json` (vérifié, fichier lu)

| Bloc | Contenu exact | Où le reposer sur le VPS |
|---|---|---|
| `framework` | `vite` | sans objet |
| `rewrites` | `/api/(.*)` → `/api/[...slug]` | routage dans le serveur Node (`pathSegments` fait déjà le travail) |
| En-têtes `/(.*)` | `Strict-Transport-Security: max-age=63072000; includeSubDomains` · `X-Frame-Options: DENY` · `X-Content-Type-Options: nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · `Permissions-Policy: camera=(), microphone=(), geolocation=()` · CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` | serveur Node (voir §5.5) ; HSTS par le reverse proxy |
| Cache `/` et `/index.html` | `Cache-Control: no-cache` | serveur Node |
| Cache `/assets/(.*)` | `Cache-Control: public, max-age=31536000, immutable` | serveur Node |
| Cache `/api/(.*)` | `Cache-Control: no-store` | serveur Node |

**Crons : aucun.** `vercel.json` n'a pas de bloc `crons`, et la collecte de la boîte de réception
est **déclenchée manuellement** par le bouton de l'écran (`case 'inbound-collect'` dans
`api/[...slug].ts`, commentaire « AUCUN cron »). Rien à replanifier sur le VPS.

### 1.2 Types `@vercel/node` (vérifié)

Importés **en types seulement** dans `api/[...slug].ts`, `api/_lib/http.ts`, `api/_lib/auth.ts`
et `scripts/harness-api.ts`. Surface réellement utilisée par le handler :

- requête : `req.url`, `req.method`, `req.headers`, `req.body` ;
- réponse : `res.status()`, `res.json()`, `res.end()`, `res.setHeader()`.

`req.query` n'est **jamais** utilisé (le routeur extrait les segments de `req.url` — choix
délibéré, commenté ligne 177). C'est ce qui rend l'adaptateur Node trivial (§2.1).

### 1.3 Base Vite (vérifié)

`vite.config.ts` : `base: process.env.VERCEL ? '/' : '/boat/'`. Le build hors Vercel produit donc
aujourd'hui une app servie sous `/boat/`. Aucun chemin `/boat/` n'est écrit en dur dans `src`
(vérifié par grep : seulement un commentaire dans `src/lib/openLead.ts`), et `import.meta.env.BASE_URL`
n'est utilisé nulle part : **la base est le seul point à traiter**.

### 1.4 Build (vérifié)

- `vercel-build` = `prisma generate && tsc -b && vite build` — le client Prisma est **généré, pas
  versionné** : indispensable dans l'image.
- CI GitHub : Node 22 (`ci.yml`), `npm ci`, `prisma generate`, lint, `npm run typecheck`
  (3 surfaces : `src`, `api`, `scripts`), `npm test` (harnais), `npm run build`.
- Dépendances natives : `@libsql/client` 0.17.4 → `libsql` 0.5.29, qui embarque un **binaire par
  plateforme** (le poste a `@libsql/win32-x64-msvc`, Linux dispose de `linux-x64-gnu` et
  `linux-x64-musl`). Conséquence : `npm ci` **dans l'image**, jamais de copie du `node_modules`
  du poste.

### 1.5 Variables d'environnement — **noms seulement** (aucune valeur lue ni recopiée)

| Nom | Où | Rôle | Reconstituable ? (voir §4) |
|---|---|---|---|
| `TURSO_DATABASE_URL` | serveur | base de prod (hôte `bob-brestoceanboat.aws-eu-west-1.turso.io`) | oui |
| `TURSO_AUTH_TOKEN` | serveur | jeton Turso | oui (rotation) |
| `SESSION_SECRET` | serveur | signature du cookie de session (HMAC) | oui (déconnecte tout le monde) |
| `APP_PASSWORD_HASH` | serveur | mot de passe partagé, haché scrypt | oui si le mot de passe est connu |
| `APP_USERNAME` | serveur | identifiant partagé | oui |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_TARGET_MAILBOX` | serveur | Graph (boîte de réception) | oui (non secrets) |
| `AZURE_CLIENT_SECRET` | serveur | secret client Graph | **non** — voir §4.2 |
| `DATABASE_URL` | serveur / CLI | base fichier (`file:…`) ; **verrou** : la CLI Prisma refuse toute URL non `file:` | oui |
| `VITE_USE_API` | **build** | constante inlinée à la compilation (`src/lib/flags.ts`) | oui |
| `VITE_API_BASE_URL` | **build**, optionnel | défaut `/api` | oui |
| `BACKUP_DIR` | poste | destination des sauvegardes (défaut `<OneDrive>/BOB-backups`) | oui |
| `BOB_CONFIRM_PROD` | poste | 3ᵉ condition d'écriture en prod (`scripts/lib/dbTarget.ts`) | oui |
| `DEV_API_PROXY_TARGET`, `BOB_TEST_SESSION_SECRET` | dev | banc local | oui |

⚠️ **`VITE_USE_API` est une variable de BUILD** : elle doit valoir `true` **au moment du
`vite build` dans l'image**, sinon l'app repart en mode `localStorage` et ne parlera jamais à
l'API. C'est le piège n° 1 de la mise en conteneur.

**Estimation §1** : fait (inclus dans cet audit).
**Point bloquant** : aucun.
**À vérifier plutôt que supposer** : la liste réelle des variables du projet Vercel et leur
portée (Production / Preview), dans le tableau de bord — ce rapport liste ce que **le code**
lit, pas ce que Vercel contient.

---

## 2. Application en conteneur

### 2.1 Adaptateur Node pour `api/[...slug].ts`

**Recommandation : pas de framework (ni Express, ni Fastify, ni Hono). Un serveur `node:http`
d'une cinquantaine de lignes.** Le précédent existe déjà dans le dépôt et tourne à chaque banc de
test local : `scripts/dev-local-test.ts` (lignes ≈ 95-110) — `http.createServer`, concaténation du
corps dans `req.body`, ajout de `res.status()` et `res.json()`, puis appel du handler. C'est
exactement la surface du §1.2.

À ajouter par rapport au banc de test (qui, lui, ne sert que l'API en local) :

1. **service du statique** (`dist/`) : `index.html` en repli pour toute route inconnue — inutile en
   pratique avec HashRouter, mais sain ;
2. **en-têtes et cache** de §1.1, posés par chemin (`/assets/…` immutable, `/` et `/index.html`
   `no-cache`, `/api/…` `no-store`) ;
3. **limite de taille du corps** (Vercel plafonnait à 4,5 Mo) : refuser au-delà de ~10 Mo avec un
   413 propre, sinon un POST géant tient la mémoire du conteneur ;
4. **`/api/health`** hors garde d'authentification (voir 2.4) ;
5. arrêt propre sur `SIGTERM` (`server.close()` + `prisma.$disconnect()`).

> ⚠️ **Prérequis bloquant — identification de l'IP cliente derrière un reverse proxy.**
> `api/_lib/loginRateLimit.ts` détermine l'IP du client d'une façon **valable sur Vercel mais pas
> derrière un reverse proxy** : la limitation des tentatives de connexion ne jouerait plus son rôle
> une fois le CRM sur le VPS. Options de correction, conséquences et détail technique : **fiche
> locale hors Git**, et rappel au TODO (section « Bascule VPS »). Fonction **pure** déjà isolée,
> harnais existant (`scripts/harness-login-ratelimit.ts`) → **≈ 0,5 j avec les tests**.
> **Le correctif part AVEC le lot VPS, avant l'ouverture à l'équipe.**

**Modifications de code nécessaires** : **aucune dans `api/`** si l'on conserve `@vercel/node`
en `devDependency` (types uniquement, zéro runtime, il ne part pas dans l'image d'exécution).
C'est la recommandation pour le premier lot : le fichier de 266 lignes qui porte toute l'API
n'est pas touché, donc les 47 harnais et `npm run api:typecheck` restent valables tels quels.
Le remplacement des types par un alias local (`IncomingMessage & { body?: unknown }`, etc.) est un
nettoyage à faire **après** la bascule (lot D, §7).

### 2.2 Un conteneur ou deux ?

**Recommandation : UN seul conteneur** (Node sert `dist/` **et** `/api`).

| | Un conteneur (recommandé) | Deux conteneurs + Custom location `/api` dans le proxy |
|---|---|---|
| Origine | une seule → cookie `SameSite=Lax` et CSP `connect-src 'self'` inchangés | même origine vue du navigateur, mais deux routes à maintenir dans le proxy |
| Déploiement | bundle + API **versionnés ensemble** (atomique) | risque de front et API désynchronisés |
| Proxy | 1 Proxy Host, 0 custom location | 1 Proxy Host + 1 custom location à ne pas casser à chaque renouvellement SSL |
| Sauvegarde / garde | 1 healthcheck, 1 garde de démarrage | 2 de chaque |
| Charge | 5 utilisateurs, ~700 Ko de base : négligeable | sans objet |

Conséquence assumée : le serveur Node sert des fichiers statiques (quelques Mo, cache immutable).
À ce volume, c'est sans effet mesurable, et cela évite la classe de pannes « le front répond, l'API
non ».

### 2.3 Base Vite, HashRouter, onglets, icônes

- Servie à la racine d'un sous-domaine → **`base: '/'`**. Deux façons : figer `base: '/'` dans
  `vite.config.ts` (propre, mais c'est du code → **après** le dégel de `main`), ou, en attendant,
  builder avec `VERCEL=1` dans le Dockerfile (la condition existante renvoie `/`). Le second est un
  contournement à documenter explicitement, pas un état final.
- **HashRouter** : inchangé. Les routes restent `#/leads/…` ; aucun `try_files` ni règle de
  réécriture SPA n'est nécessaire côté proxy — c'est un avantage réel du choix HashRouter.
- **Liens « nouvel onglet » du lot 3** : `src/lib/openLead.ts` construit l'URL depuis
  `location.origin + pathname + search + #/leads/…` — **aucun chemin en dur**, donc rien à changer,
  que la base soit `/boat/` ou `/`.
- **Icônes déjà posées sur les téléphones** : elles pointent vers l'URL Vercel. Le changement de
  nom les rend caduques → à recréer le jour de la bascule, en même temps que le manifest prévu au
  TODO (« Icône CRM sur l'écran d'accueil des téléphones — à faire AVEC la bascule VPS »).

### 2.4 `docker-compose.yml` (modèle §7.2) — forme attendue

Modèle : **GUIDE PROJET §7.2**. Un projet du parc (Node + SQLite en WAL + `bookworm-slim`) en est le
décalque le plus proche — références dans la fiche locale.

Points imposés : `name:` explicite **et** `container_name:`, réseau interne du parc en **`external: true`**,
**aucun `ports:`**, `env_file` en **syntaxe longue avec `format: raw`**, `TZ=Europe/Paris`,
`restart: unless-stopped`, `init: true`, `security_opt: [no-new-privileges:true]`, `logging`
json-file borné (`max-size: 10m`, `max-file: 5`), `HOSTNAME: "0.0.0.0"`, image épinglée
(`node:22.18-bookworm-slim`, **jamais `node:22`**, et **jamais Alpine** : `@libsql/client` publie
des binaires glibc — règle explicite du GUIDE PROJET).

- **`name:` n'est pas cosmétique** : un projet mal nommé peut « recréer », donc détruire, un
  conteneur existant. Et tout démarrage se fait **`docker compose up -d --no-deps <service>`**,
  jamais nu — la machine héberge d'autres services (GUIDE PROJET, règle 3).
- **`format: raw`** : sans lui, Compose corromprait un `$` présent dans un secret
  (`APP_PASSWORD_HASH` est un hachage scrypt **qui contient des `$`** : `scrypt$16384$8$1$sel$hash`).
  Ce n'est pas une précaution théorique ici — **c'est notre cas exact**.
- **`TZ=Europe/Paris` n'est pas cosmétique** non plus : le serveur calcule des dates métier
  (`parisTodayISO()` dans `src/lib/weeklyObjectives.ts`, utilisé par `api/_lib/store.ts`). Le code
  force déjà `timeZone: 'Europe/Paris'` à cet endroit précis, mais `TZ` doit être posé pour tout le
  reste (journaux, `new Date()` ailleurs).
- ⚠️ **Volumes : montages `bind` sous `/opt/<nom>/`, PAS de volume nommé** — corrigé par rapport à
  l'intuition de départ : **la sauvegarde du parc ne va chercher les données qu'à des emplacements
  précis** (GUIDE D'EXPLOITATION, et fiche locale). Une base logée ailleurs ne serait sauvegardée
  par personne, **sans que rien ne le signale**. → `/opt/<nom>/donnees` monté sur le chemin de la base, avec
  **`bind: { create_host_path: false }`** (sans quoi Compose recrée un dossier vide et l'app démarre
  sur une base absente).
- **Healthcheck : il traverse la donnée, mais n'exige AUCUNE ligne.** Ne **pas** utiliser
  `/api/state` (401 sans session, et il lit toutes les tables). Prévoir un `GET /api/health`
  **hors garde d'authentification** qui ouvre une connexion neuve et fait un vrai `SELECT count(*)`
  (ex. `sqlite_master`, ou la table `commercials`) : **0 ligne = sain**. Sonde écrite en `node -e`
  et non `curl` (absent de `bookworm-slim`), `interval: 30s`, `timeout: 10s`, `retries: 3`,
  `start_period: 40s`. C'est un ajout de code d'une quinzaine de lignes, à faire avec l'adaptateur.
  Rappel du GUIDE PROJET : un healthcheck qui se contente d'ouvrir le port déclare `healthy` un
  conteneur dont le volume n'est pas monté — exactement la panne que la garde du §2.6 cherche à éviter.
- Rien d'autre n'a besoin d'être persistant : l'app ne stocke aucun fichier utilisateur (les
  exports partent dans le navigateur, les pièces jointes des emails ne sont pas téléchargées).
- **`docker compose restart` ne relit pas `env_file`** : après tout changement de secret,
  `docker compose up -d --force-recreate --no-deps <service>`.
- **`build` et premier `up -d` dans la même session** : un ramasse-miettes supprime la nuit une
  image non attachée (`pull access denied` au réveil).

### 2.5 `.dockerignore` — tous les motifs en `**/`

Motifs minimaux, au vu de ce que contient réellement le dossier :

```
**/.env
**/.env.*
**/*.db
**/*.db-wal
**/*.db-shm
**/*.csv
**/*.xlsm
**/node_modules
**/dist
**/.git
**/memory
**/_import_local
**/.claude
**/*.local.json
```

Justification par le contenu vérifié : `_import_local/` contient le fichier Excel et le CSV des
leads réels ; `src/data/inboundFixtures.local.json` contient de vrais emails de prospects ;
`dev.db` est une base SQLite à la racine ; `.env` porte les secrets ; `memory/` et `.claude/` sont
des notes de poste. Tous sont déjà hors Git — **mais le contexte de build Docker n'obéit pas au
`.gitignore`**, d'où la liste ci-dessus.

**Seul contrôle valable : inspecter l'image construite**, pas le contexte.

```bash
# liste TOUT ce qui est réellement dans l'image (couche par couche aplatie)
docker export "$(docker create --rm bob-crm:<tag>)" | tar -tf - \
  | grep -Ei '(^|/)\.env|\.db$|\.db-(wal|shm)$|\.csv$|\.xlsm$|fixtures\.local\.json$|(^|/)memory/|_import_local/'
# attendu : AUCUNE ligne
```

(La même vérification « à la main » : `docker run --rm --entrypoint sh bob-crm:<tag> -c 'ls -la /app && find /app -maxdepth 3 -name ".env*" -o -name "*.db"'`.)

### 2.6 Garde de démarrage (motif éprouvé sur d'autres projets du parc)

Script lancé **avant** le serveur (entrypoint), qui **refuse de démarrer** et **ne crée jamais
rien** :

| Contrôle | Comment | Refus si |
|---|---|---|
| Volume monté | `/var/lib/bob/donnees` est bien un point de montage (comparer `st_dev` avec `/`, ou lire `/proc/mounts`) | le chemin est dans la couche de l'image |
| Base présente | `existsSync('/var/lib/bob/donnees/bob.db')` **avant toute ouverture** | fichier absent |
| Base non vide | `statSync().size > 0` | 0 octet |
| Base structurée | ouverture **en lecture** puis `SELECT count(*) FROM sqlite_master WHERE type='table'` | 0 table |
| Secrets | `SESSION_SECRET` présent et **≥ 32 caractères**, `APP_PASSWORD_HASH` commençant par `scrypt$`, `APP_USERNAME` non vide | absent ou trop court |
| Cohérence de cible | soit `TURSO_*` (mode Turso), soit `DATABASE_URL=file:/var/lib/bob/donnees/…` — jamais les deux | ambigu |

> ⚠️ **Piège confirmé des deux côtés** — par le GUIDE PROJET (un client SQLite appelé sur un
> fichier absent **crée** la base au lieu d'échouer) **et par notre code** :
> `@libsql/client` en mode fichier **crée une base vide** au lieu d'échouer si le fichier n'existe pas (`api/_lib/prisma.ts` : `new PrismaLibSql({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })`).
> Sans cette garde, un volume mal monté donnerait un CRM **qui démarre, se connecte et affiche zéro
> lead** — panne silencieuse et, si quelqu'un saisit, divergence des données. D'où l'ordre imposé :
> **`existsSync` d'abord, ouverture ensuite.**
>
> En mode Turso (lot 1), le contrôle « base présente » ne s'applique pas : le remplacer par un
> contrôle de présence des deux variables `TURSO_*` (sans les afficher) — **pas** par un appel
> réseau, qui ferait dépendre le démarrage d'un service tiers.

**Estimation §2** : adaptateur + statique + en-têtes + `/api/health` : **1 j** · Dockerfile +
compose + `.dockerignore` : **0,5 j** · garde de démarrage + son harnais : **0,5 j** → **~2 j**.
**Points bloquants** : le changement de `base` Vite et l'ajout de `/api/health` sont du **code** →
soumis au dégel de `main` après la v4.0.0.
**À vérifier sur le serveur** : version de Docker / compose, nom exact du réseau interne du parc, convention de nommage des conteneurs et des volumes, **RAM disponible pour builder
l'image sur le VPS** (`vite build` + `tsc` : prévoir ~2 Go ; sinon build sur le poste et transfert,
mais §7.3 privilégie le paquet Git).

---

## 3. Base de données — deux scénarios chiffrés

**État vérifié de la prod (lecture seule, 2026-09-18)** : 10 tables, **750 lignes**,
`page_count` 168 × `page_size` 4096 = **≈ 690 Ko**. Détail : `leads` 440 · `inbound_emails` 146 ·
`lead_actions` 120 · `monthly_stats` 21 · `message_templates` 16 · `commercials` 5 ·
`calendar_events` 1 · `default_goal` 1 · `commercial_goals` 0 · `login_attempts` 0.
Hôte : `bob-brestoceanboat.aws-eu-west-1.turso.io` (AWS Irlande).
Les tables des lots 2 à 5 n'existent pas encore (migration du jour J) — **cet audit confirme au
passage que la prod est bien en schéma d'avant-lot 2**.

Ordre de grandeur à retenir : **la base entière tient dans moins d'un mégaoctet**. Aucun scénario
n'est contraint par le volume ; le choix est un choix de dépendance et de souveraineté.

### 3a. Turso conservé au premier lot

**Ce qui change** : l'API passe du datacenter Vercel au VPS OVH ; chaque requête Prisma reste un
aller-retour HTTP vers l'Irlande. Le chargement de l'app fait **un** `GET /api/state` (qui lit
toutes les tables), puis les écritures sont unitaires. Latence attendue Gravelines/Roubaix →
`aws-eu-west-1` : quelques dizaines de ms par requête, soit un ordre de grandeur comparable à
aujourd'hui — **à mesurer, pas à supposer** (un `time curl` sur `/api/state` avant/après suffit).

- **Jeton** : `TURSO_AUTH_TOKEN` quitte les variables Vercel pour le `.env` 600 du VPS. Deux
  détenteurs pendant la coexistence → rotation obligatoire à la fin (§7).
- **Scripts au verrou prod** : inchangés, ils continuent de tourner **depuis le poste**
  (`--target=prod` lit `.env` local). Aucun impact.
- ⚠️ **Sauvegarde** : dans ce scénario le CRM n'a rien dans `/opt` et **échappe à la sauvegarde du
  parc** → sauvegarde quotidienne dédiée à prévoir **dès le lot B** (§6.1).
- **Souveraineté — à dire explicitement à BOB** : Turso est une **société américaine** ; les données
  sont stockées en UE (AWS Irlande) mais l'opérateur relève du droit américain (CLOUD Act). Les
  données concernées sont des **données de prospects** (identité, coordonnées, projet d'achat) et
  **146 emails entrants** réels. Tant que ce scénario dure, le registre et le contrat doivent
  nommer Turso comme sous-traitant ultérieur (§8). C'est l'argument principal en faveur du 3b.

**Estimation** : **0,5 j** (branchement + recette). **Bloquant** : aucun.

### 3b. Rapatriement en SQLite/libSQL local sur le VPS

Deux projets du parc tournent déjà ainsi (base SQLite en fichier, montée depuis l'hôte).

**Procédure d'export (à blanc d'abord, puis pour de vrai) :**

1. `npm run backup:prod` (JSON gz, prouvé restaurable par le validateur du serveur) — filet.
2. Export fichier, deux voies possibles :
   - CLI Turso : `turso db shell bob-brestoceanboat .dump > bob.sql` puis `sqlite3 bob.db < bob.sql`
     — ⚠️ **la CLI `turso` était absente du poste au 17/09** (constat déjà noté dans
     `docs/DEPLOIEMENT.md`) ;
   - ou script Node maison sur le modèle des `scripts/apply-*-turso.ts` : lecture Turso →
     écriture d'un fichier local via `@libsql/client`, cible explicite par `scripts/lib/dbTarget.ts`.
     **Recommandé** : même verrou, même style, pas d'outil à installer.
3. **Vérification ligne à ligne** : pour **chacune des 10 tables**, `COUNT(*)` source = destination,
   puis empreinte (hash du contenu trié) — c'est déjà la méthode utilisée par les scripts de
   migration (« empreinte de TOUTES les tables identique »), donc réutilisable telle quelle.
   Refuser la bascule au moindre écart.
4. **Code** : rien à écrire. `api/_lib/prisma.ts` bascule **déjà** en mode fichier quand `TURSO_*`
   sont absents (`new PrismaLibSql({ url: process.env.DATABASE_URL ?? 'file:./dev.db' })`) → il
   suffit de poser `DATABASE_URL=file:/var/lib/bob/donnees/bob.db` (chemin **absolu**) et de **ne pas**
   définir `TURSO_*`. Vérifié.
5. **Mode WAL** : `PRAGMA journal_mode=WAL` (persistant, une seule fois) + `PRAGMA busy_timeout`
   (ex. 5000 ms) pour absorber les écritures concurrentes des 5 postes. Conséquence : le volume
   contient aussi `bob.db-wal` et `bob.db-shm` → **une copie de `bob.db` seul est une sauvegarde
   fausse**.
6. **Sauvegarde** : API `.backup` (ou `VACUUM INTO`), **jamais `cp`**, et contrôle par **comptage de
   tables**, **jamais un `[ -s ]` seul** (un fichier non vide peut être une base tronquée). Voir §6.1.

**Ce qu'on gagne** : plus de dépendance à un tiers américain, plus de jeton en circulation, latence
locale (µs), sauvegarde intégrée au motif SAPulse, coût nul.
**Ce qu'on perd** : la réplication managée de Turso (sans objet ici : la vraie protection, c'est la
sauvegarde) et le PITR 24 h du plan gratuit → remplacé par la sauvegarde quotidienne du parc.

**Estimation** : script d'export + vérification : **1 j** · intégration sauvegarde + WAL + recette :
**0,5 j** → **~1,5 j**, fenêtre de bascule **30 min**.

### Recommandation et calendrier

**3a puis 3b, dans cet ordre** — ne pas changer l'hébergement **et** la base le même soir.

| Moment | Étape |
|---|---|
| J (v4.0.0 en prod) + 2 à 3 semaines d'observation | rien : on laisse la v4 se stabiliser |
| Puis lot A/B (§7) | conteneur sur le VPS, **Turso conservé** (3a) — retour arrière immédiat |
| + 1 à 2 semaines | lot C : **rapatriement local** (3b), fenêtre 30 min |
| Puis | rotation **et** suppression du jeton Turso, fermeture du compte |

**Dans les deux cas : rotation du jeton Turso pendant la bascule** (procédure déjà écrite dans
`docs/DEPLOIEMENT.md` : invalidation **avant** création, ≈ 10 min, CRM indisponible entre les
étapes 1 et 4).

**À vérifier sur le serveur** : espace disque (largement suffisant, mais le constater), politique de
rétention en vigueur, et l'outillage SQLite disponible côté hôte (sinon, sauvegarder **depuis le
conteneur**, ce qui est de toute façon plus propre).

---

## 4. Secrets

### 4.1 Reconstituables sans Vercel

| Secret | Comment le refaire | Effet de bord |
|---|---|---|
| `SESSION_SECRET` | n'importe quelle chaîne aléatoire ≥ 32 caractères | **toutes les sessions tombent** → l'équipe se reconnecte une fois (à annoncer) |
| `APP_PASSWORD_HASH` | `hashPassword()` (`api/_lib/auth.ts`, scrypt) sur le mot de passe partagé **si on le connaît** ; sinon en choisir un nouveau et le communiquer | changement de mot de passe à annoncer |
| `APP_USERNAME` | connu de l'équipe | — |
| `TURSO_DATABASE_URL` | connu (`bob-brestoceanboat.aws-eu-west-1.turso.io`) | — |
| `TURSO_AUTH_TOKEN` | `turso db tokens create` ou tableau de bord | invalide les anciens jetons si rotation |
| `DATABASE_URL` | trivial | — |

### 4.2 **Non** reconstituable : `AZURE_CLIENT_SECRET`

Dans Vercel il est marqué **Sensitive** → **illisible après création**, y compris par le
propriétaire du projet. Deux cas :

- **Cas favorable (probable)** : la variable existe dans le `.env` du poste (nom présent, vérifié ce
  jour ; **valeur non lue et non recopiée dans ce rapport**). → **Action immédiate, avant toute
  réinstallation du poste : la déposer dans le coffre à secrets SAPulse.** C'est le seul exemplaire hors Vercel.
- **Cas perdu** : demander à **Sopitec** (admin du tenant M365) un **nouveau secret client** sur
  l'application Azure **existante** — ne pas créer une nouvelle application (le consentement admin
  `Mail.Read` devrait être à refaire). Noter la **date d'expiration** du nouveau secret et la mettre
  à l'échéancier : un secret Azure expiré = boîte de réception muette, sans message d'erreur
  parlant côté équipe (le code, lui, sait le dire : `AADSTS7000215` → « Secret client invalide »).

`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_TARGET_MAILBOX` ne sont pas des secrets : lisibles dans
le portail Azure.

### 4.3 Règles de dépôt (non négociables)

- **Coffre à secrets — AVANT la bascule, pas pendant** : `AZURE_CLIENT_SECRET` (sinon dépendance à
  Sopitec pour en régénérer un), **jeton Turso** et **hachage du mot de passe partagé** y sont
  déposés d'abord ; la bascule ne commence qu'une fois ce dépôt fait. Les autres secrets suivent.
- **`.env` du serveur** : `chmod 600`, propriétaire root, **hors Git**, hors contexte de build
  (§2.5), référencé dans le compose en **syntaxe longue `env_file` avec `format: raw`**.
- **Jamais** de secret dans le `docker-compose.yml`, **jamais** d'interpolation `${...}` depuis
  l'environnement du shell.
- Rappel : les secrets ne doivent pas non plus finir dans les journaux — le code loggue déjà les
  erreurs 5xx avec méthode et URL seulement, et n'écrit jamais les variables (vérifié).

**Estimation §4** : **0,5 j** (inventaire, génération, dépôt le coffre à secrets SAPulse, documentation).
**Point bloquant** : si `AZURE_CLIENT_SECRET` est introuvable → **dépendance à Sopitec** (délai
externe, à lancer tôt).
**À vérifier plutôt que supposer** : la présence effective du secret Azure dans le `.env` du poste,
et l'échéance du secret côté Azure.

---

## 5. Réseau, domaine, proxy

### 5.1 Nom

Règle de nommage vérifiée : **un seul nom se répercute sur quatre objets** — le conteneur, le
dossier `/opt/<nom>/`, le sous-domaine et le périmètre de sauvegarde ; « un lecteur de la liste des
Proxy Hosts doit pouvoir aller du sous-domaine au dossier puis au conteneur sans rien deviner ».
Le nom se fixe **avant** la création du dépôt.

⚠️ **À vérifier avant de fixer le nom** : qu'il ne soit pris ni par un conteneur, ni par un dossier,
ni par un sous-domaine existant (la liste est dans le PASSEPORT TECHNIQUE / la fiche locale, pas
ici). Le nom doit être **distinct et parlant**.

| Option | Avantages | Inconvénients |
|---|---|---|
| **`bob-crm`** → conteneur `bob-crm`, `/opt/bob-crm/`, **`bob-crm.sapulse.fr`** (recommandé) | strictement conforme à la convention des 4 objets, sans ambiguïté avec les autres clients | une URL un peu longue à taper sur un téléphone (mais elle finit en icône d'écran d'accueil) |
| `bob` → `bob.sapulse.fr` | plus court | « bob » seul ne dit pas de quelle application il s'agit dans la liste des Proxy Hosts |
| `crm.brestoceanboat.fr` (domaine du client) | nom du client, indépendance si SAPulse change de rôle, meilleure impression côté équipe | exige l'accès (ou une demande) au registrar du client → **délai externe** ; le conteneur et `/opt` gardent de toute façon le nom SAPulse |

**Hypothèse de travail retenue : `bob-crm.sapulse.fr`** (conteneur `bob-crm`, `/opt/bob-crm/`).
⚠️ **La question « voulez-vous le CRM sur votre propre domaine ? » est posée à BOB MAINTENANT**,
sans attendre le lot B : si la réponse est oui, il faut un accès (ou une demande) au registrar du
client, et **ce délai est externe**. Chaque changement de nom coûte ensuite : cookie de session,
icônes des téléphones, communication — autant n'en faire **qu'un seul**, au moment de la bascule.

### 5.2 DNS Hostinger

**Un seul enregistrement `A`** vers l'IP du VPS. **Ne toucher à aucun enregistrement existant**
(MX, SPF/TXT, autres A/CNAME). TTL court (300 s) pendant la fenêtre, remis à la valeur habituelle
ensuite. Aucun enregistrement à supprimer côté Vercel tant que le secours est en place (§7).

### 5.3 Proxy Host (reverse proxy)

Procédure complète (accès à l'interface, pièges connus, diagnostic) : **GUIDE D'EXPLOITATION** et
fiche locale. Ce qui concerne le CRM :

- **Le DNS doit répondre AVANT la demande de certificat** (Let's Encrypt valide par HTTP) : un nom
  non résolu laisse un Proxy Host à moitié créé.
- **Domain Names** : saisir puis **valider par Entrée** — une étiquette doit apparaître, sinon le
  nom n'est pas pris en compte.
- **Forward Hostname = le nom du conteneur** (`bob-crm`), port interne de l'app, réseau
  réseau interne du parc — **aucun port publié sur l'hôte**, aucune IP en dur. Le conteneur **doit** être sur
  le réseau interne du parc (c'est là que vit le reverse proxy) : sans cette adhésion, le Proxy Host répond **502** avec un
  conteneur parfaitement sain.
- **Block Common Exploits : activé.**
- **Websockets : non** — vérifié, l'app n'ouvre aucun WebSocket (aucune occurrence dans `src`) ;
  le mode Turso, lui, est une connexion **sortante** du serveur, sans rapport avec le proxy.
- **SSL, dans l'ordre imposé** : certificat Let's Encrypt → **Force SSL** → **HTTP/2** → **HSTS
  (sans sous-domaines)**.
  ⚠️ `vercel.json` posait `includeSubDomains` ; sur `sapulse.fr`, cocher `includeSubDomains`
  engagerait **tous** les sous-domaines SAPulse → **ne pas le faire** (le guide le dit déjà).
- **Pièges connus des Custom Locations** (voir fiche locale) : ils coûtent une panne silencieuse.
  **Argument supplémentaire en faveur d'un seul conteneur, sans Custom Location** (§2.2).
- **Après toute modification** : contrôle de la configuration du proxy, puis **rouvrir l'hôte et
  vérifier que les cases SSL ont tenu — elles se perdent en silence**.
- **`client_max_body_size`** (onglet Advanced) : nécessaire. Mesure : une sauvegarde de la prod fait 112 Ko compressés,
  soit **~1,2 à 1,5 Mo de JSON brut**, et l'écran « Restaurer » **poste ce JSON en clair** (vérifié :
  `parseBackupFile` lit du texte JSON, pas du gzip) ; l'import CSV est parsé côté client puis posté
  en JSON de taille comparable. Le défaut nginx (**1 Mo**) ferait échouer « Restaurer » en **413**.
  → poser **10 Mo**, et aligner la limite du serveur Node (§2.1).
- **VÉRIFICATION SSL OBLIGATOIRE après CHAQUE modification du host** (les deux ensemble, pas l'une
  ou l'autre) :

```bash
# 1) présence de la redirection dans la conf du proxy (chemin : voir GUIDE D'EXPLOITATION)
# 2) et, depuis n'importe où :
curl -sI http://bob-crm.sapulse.fr | head -1     # attendu : 301
```
Les **deux** contrôles ensemble, après **chaque** modification — l'un sans l'autre ne prouve rien.

### 5.4 Access List ?

**Non, pas en régime courant.** L'app a déjà son authentification (compte partagé, mot de passe
haché scrypt, cookie signé HMAC HttpOnly/Secure/SameSite=Lax 30 j, limitation des tentatives de
connexion en base). Une Access List (Basic Auth) ajouterait une seconde invite, **casserait les
appels `fetch` de l'app** (tous en `credentials`) et gênerait l'usage mobile.

**Exception : la phase de recette** (lot A), avant l'ouverture à l'équipe — dans ce cas
**créer l'Access List AVANT le Proxy Host** (ordre imposé par le guide), et la retirer à
l'ouverture. Si elle est utilisée, vérifier qu'elle ne s'applique pas à `/api` seulement en théorie :
en pratique, la retirer entièrement avant la bascule évite tout faux diagnostic.

### 5.5 Transposition des en-têtes et du cache

**Où les poser** : dans le **serveur Node**, pas dans le proxy — une seule source, versionnée avec le
code, identique en local et en prod, et qui suit l'app si le proxy change. **Seule exception :
HSTS**, posé par le reverse proxy via la case à cocher (§5.3) → **ne pas l'émettre aussi côté Node**, sinon
en-tête en double.

Correspondance : voir le tableau du §1.1. Vérification après mise en service :

```bash
curl -sI https://bob-crm.sapulse.fr/                       # no-cache + CSP + X-Frame-Options + HSTS
curl -sI https://bob-crm.sapulse.fr/assets/<fichier>.js    # public, max-age=31536000, immutable
curl -sI https://bob-crm.sapulse.fr/api/state              # 401 + Cache-Control: no-store
```

Le `401` sur `/api/state` sans session **fait partie de la recette** : c'est le contrôle que la
garde d'authentification est bien active derrière le proxy (il figure déjà à l'étape 8 du plan de
mise en prod actuel).

### 5.6 Changement de domaine — effets vérifiés

| Sujet | Effet | Action |
|---|---|---|
| **Cookie de session** | lié au domaine → **tout le monde est déconnecté une fois** ; `Secure` reste satisfait (HTTPS) ; `SameSite=Lax` inchangé | annoncer ; aucune modification de code |
| **CORS** | **aucun** tant que front et API partagent l'origine (un seul conteneur, §2.2) ; la CSP `connect-src 'self'` l'impose de fait | ne pas séparer les origines |
| **Azure / Graph** | flux **app-only (client credentials)** — vérifié : pas d'URL de redirection, pas de consentement utilisateur → **rien à changer côté Azure** | faire **confirmer par Sopitec** qu'aucune restriction d'IP sortante / accès conditionnel ne vise l'application |
| **Icônes des téléphones** | pointent vers l'ancienne URL | à recréer le jour J, avec le manifest du TODO |

**Estimation §5** : **0,5 j** (DNS + Proxy Host + SSL + vérifications), hors délai externe si le
domaine du client est retenu.
**Points bloquants** : choix du nom (décision client) ; accès registrar si domaine BOB.
**À vérifier sur le serveur** : zone DNS réellement utilisée, certificats existants, et que le nom
retenu est libre (conteneur, dossier, sous-domaine).

---

## 6. Exploitation

### 6.1 Sauvegarde

La sauvegarde du parc est un **script existant, lancé chaque nuit** : son texte, son périmètre, ses
contrôles et la procédure d'ajout d'un projet sont dans le **GUIDE D'EXPLOITATION** et la fiche
locale — **pas ici**. Ce qui relève du CRM :

**Principes de contrôle imposés (scénario 3b, base locale)** :

1. **refus si la base est absente** (ne rien créer, ne pas « réussir » à vide) ;
2. **copie par l'API `.backup`** — **jamais `cp`, jamais `tar`** sur une base en WAL ;
3. **comptage des tables sur la COPIE** (0 table = base fantôme → échec) ;
4. **comptage métier** : au moins **1 commercial** (table `commercials`, 5 lignes aujourd'hui).
   **Pas les leads** : une base neuve en a légitimement zéro, et la règle « base vide = saine »
   reste ;
5. **`PRAGMA integrity_check` = `ok`** ;
6. **jamais un test « fichier non vide » seul** : il passe sur une base vide ou tronquée.

Ajout au périmètre = **étape du déploiement, pas amélioration** (étape 8 de la séquence, §7).

#### Pendant la phase « Turso conservé » (lot B → lot C) — trou de sauvegarde à combler

⚠️ **Tant que la base reste chez Turso, le CRM n'a rien dans `/opt` : il échappe entièrement à la
sauvegarde du parc.** Le seul filet serait `npm run backup:prod` lancé à la main depuis le poste
— donc rien les jours où le poste est éteint. Inacceptable sur plusieurs semaines.

**Motif proposé — une sauvegarde quotidienne qui se range d'elle-même dans le périmètre du parc :**

| | Choix proposé | Pourquoi |
|---|---|---|
| **Où** | sur le **VPS**, pas sur le poste | indépendant d'une machine allumée |
| **Quoi** | `scripts/backup-turso.ts` (déjà écrit, lecture seule, cible explicite) | aucun format maison à maintenir ; le fichier est **réinjectable par l'écran « Restaurer »** |
| **Comment** | conteneur outil du même `docker-compose.yml`, en `profiles: ["outils"]`, lancé par un **timer** quotidien — **avant** l'heure de la sauvegarde du parc | pas de Node à installer sur l'hôte ; le profil le tient hors de tout `up` ordinaire |
| **Où il écrit** | **`/opt/bob-crm/sauvegardes/`** (`BACKUP_DIR`) | c'est précisément ce que la sauvegarde du parc ramasse → **la copie part chiffrée hors du VPS sans rien ajouter au dispositif** |
| **Preuve** | le script **revalide le fichier relu du disque** par le validateur du serveur et affiche « Restaurable : oui ✅ » ; **échec = code de sortie non nul**, visible dans le journal du timer | une sauvegarde non restaurable ne vaut rien, et on ne veut pas l'apprendre le jour du sinistre |
| **Rétention** | celle du script (`RETENTION_DAYS`) + celle du parc | bornée, RGPD (§8) |

**Destination maîtrisée plutôt que OneDrive ?** — oui, **par conséquence** : en écrivant dans
`/opt/bob-crm/`, la copie suit le chemin de sauvegarde déjà en place (archive chiffrée, destination
maîtrisée par SAPulse) au lieu d'un compte Microsoft rattaché à un poste. **Garder OneDrive en plus** tant que le poste sert
(règle 3-2-1 : deux destinations valent mieux qu'une), mais ce n'est plus **le** filet.

⚠️ Ce motif suppose que le jeton Turso vive dans le `.env` 600 du VPS (c'est déjà le cas au lot B)
et **n'ajoute aucune écriture** : `backup-turso.ts` est strictement en lecture.

**Charge** : ½ j (conteneur outil + timer + première exécution vérifiée), à faire **au lot B**, pas
plus tard.

#### Que devient `backup:prod` / OneDrive ?

**On garde les deux, ils ne font pas le même travail** :

| | Sauvegarde du parc (fichier `.db`) | `backup-turso.ts` (JSON gz) |
|---|---|---|
| Nature | copie **technique** de la base | export **métier**, au format de l'écran « Restaurer » |
| Restauration | remise en place du fichier (arrêt du conteneur) | bouton « Restaurer », **validé à chaque exécution** |
| Fréquence | quotidienne | quotidienne pendant la phase Turso, puis hebdomadaire + avant/après toute opération à risque |
| Hors site | archive chiffrée du parc | idem, dès qu'elle est écrite sous `/opt` |

⚠️ **Les sauvegardes contiennent les données personnelles de tous les prospects** : elles ne
circulent pas par mail, clé USB ou partage grand public (§8).

### 6.2 Scripts au verrou prod

`scripts/lib/dbTarget.ts` impose aujourd'hui : cible explicite, `--target=prod` (identifiants Turso
lus dans `.env`) ou `--target=local --db=<fichier existant>`, et pour écrire : `--apply` **et**
`--target=prod` **et** `BOB_CONFIRM_PROD=bob-brestoceanboat`.

**Hors Turso, ce qui change** :

- `--target=prod` n'a plus de sens → prévoir une cible **`vps`** (ou réutiliser `--target=local
  --db=/var/lib/bob/donnees/bob.db` **depuis le conteneur**, ce que le verrou accepte déjà : il exige un **fichier
  existant** et refuse toute URL distante — vérifié).
- `BOB_CONFIRM_PROD` doit **rester** : adapter la valeur attendue (ex. le nom du fichier) et la
  documenter.
- Les 6 scripts `apply-*-turso.ts` passent tous par `guardDbTarget` → **le changement est
  concentré dans `dbTarget.ts`** ; à confirmer script par script, et à prouver par
  `scripts/harness-db-target.ts` (qui vérifie déjà « aucune connexion ouverte en cas de refus »).
- Les scripts tourneront **sur le VPS** (ou sur une copie rapatriée) : prévoir comment on les lance
  (`docker compose exec`), et **ne jamais** ouvrir la base de prod depuis le poste par un partage.

**Estimation** : **0,5 à 1 j** (dont harnais), à faire **avec** le lot C, pas avant.

### 6.3 Dépôt et déploiement

- **La forge SAPulse comme dépôt de référence, GitHub conservé en miroir lecture seule**
  quelques semaines (historique, tags `prod-*`, CI). Basculer d'un coup et supprimer GitHub ferait
  perdre le filet au pire moment.
- **CI GitHub Actions : à garder tant que GitHub est miroir.** Elle **ne déploie rien** et
  **n'utilise aucun secret** (vérifié : bases SQLite jetables, `TURSO_*` retirées de l'environnement
  des enfants, Graph simulé) → aucun risque à la laisser tourner. Si la forge devient seul dépôt, il
  faut un runner sur la forge (coût d'installation à chiffrer) ; à défaut, la règle devient :
  `npm run typecheck && npm test && npm run build` **avant chaque déploiement**, à la main, et la
  preuve est collée dans le journal de déploiement.
- **`deploy.yml` (GitHub Pages)** est déjà désactivé (vestige, `workflow_dispatch` seul) → à
  supprimer au lot D.
- **Motif de déploiement recommandé : le paquet Git** (GUIDE D'EXPLOITATION §2.2 / GUIDE PROJET
  §7.3) — le code voyage dans un paquet vérifié par empreinte, **aucun secret de dépôt ne reste sur
  le serveur**, et l'avance est refusée si elle n'est pas rapide. Commandes exactes et pièges :
  fiche locale.
- Build de l'image **sur le VPS** à partir du dépôt ainsi mis à jour. Raisons vérifiées : le client Prisma est
  **généré** (`prisma generate` dans le build) et `@libsql/client` embarque un **binaire natif par
  plateforme** (le poste est en `win32-x64-msvc`, l'image a besoin de `linux-x64-gnu`) → **`npm ci`
  doit tourner dans l'image**, jamais de `node_modules` transporté. Tag `prod-AAAA-MM-JJ` conservé
  comme aujourd'hui.

### 6.4 Recette sur base VIDE

Le point dur : **un vrai zéro doit s'afficher comme zéro**, pas comme un tiret, un `NaN`, un écran
d'erreur ou un chargement infini.

| Écran | Attendu sur base vide |
|---|---|
| **Connexion** | login OK ; mauvais mot de passe → 401 ; `/api/state` sans session → 401 ; logout → retour à l'écran de connexion |
| **Agenda** (accueil) | semaine affichée, **aucune action**, pastille de retards **à 0** (pas d'absence de pastille ambiguë) |
| **Leads** | liste vide avec message explicite, filtres et tri opérationnels, compteur « 0 lead » |
| **Pipeline** | 8 colonnes présentes et vides, glisser-déposer sans erreur |
| **Fiche lead** | créer 1 lead de test → fiche complète, prochaine action, envoi email/SMS/WhatsApp (menus « sans modèle »), puis **le supprimer** |
| **Dashboard** | 3 indicateurs à **0**, graphiques vides sans erreur console |
| **Performance** | 0 partout, pas de division par zéro (taux affichés « — » ou 0 %, mais **cohérents**) |
| **Acquisition** | mois courant à 0 ; saisie d'une ligne possible ; **Réseaux sociaux** : aucun réseau → message, pas d'erreur |
| **Objectifs** (par commercial) et **Objectifs de la semaine** | aucun objectif → message ; création d'un objectif possible (règle du lundi, plafond) |
| **Modèles** | 0 modèle → « Non classés » vide, et le menu Email de la fiche propose bien « Email sans modèle » |
| **Boîte de réception** | 0 email ; bouton « Collecter » → si Graph non configuré, **message clair** (503 explicite), pas d'écran blanc |
| **Clients / Espace commercial / Exports** | listes vides, export CSV d'une liste vide = fichier avec en-têtes |
| **Sauvegarde / Restauration** | export d'une base vide, puis **restauration du fichier** (vérifie aussi `client_max_body_size`) |

**Estimation §6** : sauvegarde **0,5 j** · scripts (avec le lot C) **0,5 à 1 j** · dépôt/CI **0,5 j** ·
recette base vide **0,5 j** → **~2 j**.
**Points bloquants** : décision forge seule vs miroir GitHub (impose ou non un runner).
**À vérifier sur le serveur** : contenu exact et conventions du script de sauvegarde, destination et
rétention, coffre à secrets et forge Git opérationnels (et runners éventuels), espace disque.

---

## 7. Bascule et retour arrière

**Principe : aucune coupure, et à chaque lot un retour arrière qui tient en une action.**
Pendant la coexistence, Vercel et le VPS parlent à **la même base Turso** — c'est ce qui permet de
revenir en arrière sans perdre une saisie. Condition impérative : **le même commit des deux côtés**.

| Lot | Contenu | Durée | Moment | Retour arrière |
|---|---|---|---|---|
| **A — Préparation** (hors production) | image, compose, garde de démarrage, `/api/health`, recette **sur base vide jetable** (§6.4), nom de test ou Access List, **Turso non branché** | 2 à 3 j de travail, 0 min de coupure | quand on veut | sans objet (rien n'est en service) |
| **B — Bascule applicative** | `.env` 600 sur le VPS, conteneur branché sur **Turso** (3a), DNS `A`, Proxy Host + SSL + vérifications, recette en lecture seule, puis annonce à l'équipe | **60 à 90 min** | **hors heures ouvrées** (soir ≥ 19 h, ou samedi matin) | **immédiat** : l'équipe revient à l'URL Vercel (qui n'a pas bougé) ; base commune, aucune perte |
| **C — Rapatriement de la base** | arrêt du conteneur, export Turso → `/opt/<nom>/donnees/bob.db`, **vérification ligne à ligne**, redémarrage avec `DATABASE_URL`, recette, puis **rotation + suppression du jeton Turso** | **30 min** | hors heures ouvrées, **1 à 2 semaines après B** | rebrancher `TURSO_*` et redémarrer — **⚠️ les saisies faites en local depuis la bascule seraient perdues** → fenêtre courte, sauvegarde juste avant, et décision dans l'heure |
| **D — Nettoyage** | retrait de `@vercel/node`, `base: '/'` figée, `vercel.json` et `deploy.yml` archivés, suppression du projet Vercel, CHANGELOG | 0,5 j | après 2 à 4 semaines sans incident | — |

**Combien de temps garder Vercel en secours** : **2 à 4 semaines** après le lot B, projet intact et
**aucun nouveau déploiement** dessus. Coût nul (plan Hobby), valeur élevée. Le supprimer seulement
après le lot C **et** une période sans incident — et **après** avoir vérifié que plus personne n'a
l'ancienne URL en favori ou en icône de téléphone.

**Ordre imposé le soir du lot B**, calé sur la séquence de déploiement en 8 étapes du GUIDE PROJET :

1. **Reconnaissance** : relever **avant** intervention le nombre de conteneurs et de ports en écoute
   (`docker ps | wc -l`, `sudo ss -tlnp`) et `sudo iptables -L DOCKER-USER -n | wc -l` ;
2. **DNS** : un seul enregistrement `A`, sans toucher aux autres ;
3. base de données : **sans objet** au lot B (Turso conservé) — c'est le lot C ;
4. **durcissement AVANT le premier `up -d`** (le réseau d'administration atteint tous les ports de
   tous les conteneurs : l'app est joignable dès son premier démarrage) ;
5. conteneur : `/opt/bob-crm/docker-compose.yml`, **`build` et `up -d --no-deps` dans la même
   session** ;
6. Proxy Host, **puis rouvrir l'hôte et vérifier que les cases SSL ont tenu** ;
7. **vérification** : ports inchangés, `DOCKER-USER` intact (même nombre de règles qu'à l'étape 1),
   et appel HTTP du CRM **depuis le conteneur du reverse proxy** (200 attendu) ;
8. **sauvegarde** : ajout au périmètre (§6.1) — *étape du déploiement, pas amélioration*.

Puis seulement : sauvegarde applicative → recette **en lecture seule** sur le nouveau nom → bascule
d'usage (annonce) → surveillance des journaux 30 min → message « ouvert ».
**Aucun déploiement Vercel ce soir-là.**

**Estimation §7** : la fenêtre elle-même (B : 60-90 min, C : 30 min), le reste est compté aux §2, 3, 5, 6.
**Point bloquant** : ne pas enchaîner B et C le même soir.
**À vérifier plutôt que supposer** : qui, dans l'équipe, a une icône ou un favori vers l'URL Vercel.

---

## 8. RGPD / art. 28 — points à traiter (liste, pas de rédaction juridique)

Le CRM traite des **données de prospects pour le compte de BOB** : BOB est responsable de
traitement, SAPulse sous-traitant. La bascule impose de traiter :

1. **Contrat de sous-traitance (art. 28)** BOB ↔ SAPulse : objet, durée, nature et finalité,
   catégories de données (identité, coordonnées, projet d'achat, **contenu d'emails entrants**),
   catégories de personnes (prospects et clients), obligations des parties, sort des données en fin
   de contrat.
2. **Sous-traitants ultérieurs** : liste tenue à jour et **autorisation de BOB** — OVH (France) ;
   **Turso / AWS Irlande tant que le scénario 3a dure** (éditeur **américain** → mention explicite,
   CLOUD Act) ; Microsoft 365 (boîte de réception, côté client) ; Hostinger (DNS).
   Le rapatriement (3b) **supprime une ligne** de cette liste : c'est un argument à porter au
   contrat, pas seulement technique.
3. **Registre des activités** : côté SAPulse, registre du **sous-traitant** (art. 30.2) ; côté BOB,
   fiche de traitement « prospection commerciale » à jour de l'hébergeur.
4. **Durées de conservation** : leads inactifs (règle à fixer avec BOB — 3 ans après le dernier
   contact est l'usage courant en prospection) ; **`inbound_emails` : 146 lignes aujourd'hui**, un
   script de purge existe déjà (`npm run purge:inbound`) → **fixer la règle et l'automatiser**, sinon
   le stock grossit sans borne ; sauvegardes : rétention bornée (déjà le cas côté `backup:prod`).
5. **Hébergeur identifié et localisation** : OVH, France — à écrire noir sur blanc dans le contrat
   et à annoncer à BOB comme une **amélioration** par rapport à la situation actuelle.
6. **Journalisation** : journaux d'accès du reverse proxy, journaux applicatifs (le code trace les erreurs 5xx
   avec méthode et URL ; `login_attempts` conserve une clé dérivée de l'IP par fenêtre) → fixer une
   durée de conservation, restreindre l'accès, ne pas recopier les journaux ailleurs (la consigne
   existe déjà en commentaire dans `api/[...slug].ts`).
7. **Mesures de sécurité à décrire** : TLS + HSTS, aucun port publié, `.env` 600, sauvegardes
   contrôlées, limitation des tentatives de connexion.
   ⚠️ **Point à signaler honnêtement** : l'authentification est un **compte unique partagé** → **pas
   de traçabilité individuelle**. C'est un choix assumé du projet, mais il doit figurer au registre,
   et être posé à BOB comme une question (comptes nommés = un vrai lot de développement).
8. **Information des personnes et exercice des droits** : mention d'information sur les prospects
   (formulaires du site, salons), et procédure de suppression d'un lead sur demande (l'app le fait
   déjà, avec cascade).
9. **Violation de données** : procédure de notification (72 h) et qui prévient qui.
10. **Sauvegardes hors site** : la copie OneDrive est sur un compte Microsoft rattaché au poste → à
    documenter dans le registre, ou à remplacer par une destination maîtrisée.

**Estimation §8** : **0,5 j** côté SAPulse (rédaction des listes, mise à jour du registre) + délai
d'échange avec BOB pour la signature.
**Point bloquant** : signature du contrat — à lancer **en parallèle** de la technique, c'est le
délai le plus long.

---

## 9. Récapitulatif

### 9.1 Charge

| Section | Charge |
|---|---|
| 2 — conteneur, adaptateur, garde de démarrage, `/api/health` | ~2 j |
| 2 bis — **correctif de l'IP cliente** (limitation du login, §2.1) | 0,5 j |
| 3 — base (3a : 0,5 j ; 3b : 1,5 j) | ~2 j |
| 4 — secrets | 0,5 j |
| 5 — réseau, domaine, proxy | 0,5 j |
| 6 — exploitation (sauvegarde, scripts, dépôt, recette) | ~2 j |
| 7 — fenêtres de bascule | 1 h 30 + 30 min |
| 8 — RGPD (hors délai client) | 0,5 j |
| **Total** | **~8 jours-homme**, hors délais externes (Sopitec, DNS client, contrat) |

### 9.2 Points bloquants, par ordre d'apparition

1. **Gel de `main`** : `base: '/'`, `/api/health` et l'adaptateur sont du **code** → rien ne
   commence avant la v4.0.0 en prod et le dégel.
2. **`AZURE_CLIENT_SECRET`** : à sécuriser dans le coffre à secrets SAPulse **maintenant** ; sinon dépendance
   Sopitec.
3. **Choix du nom de domaine** (SAPulse ou BOB) : décision client, à poser avant le lot B.
4. **Contrat art. 28** : délai le plus long, à lancer en parallèle.
5. **Forge seule ou miroir GitHub** : décide s'il faut un runner.
6. **Identification de l'IP cliente** (§2.1) : la bascule derrière un reverse proxy rend le défaut
   effectif → le correctif part **avec** la bascule, pas après.

### 9.3 À vérifier **sur le serveur** (aucune commande n'a été exécutée)

- **reconnaissance d'abord** : nombre de conteneurs, ports en écoute, nombre de règles
  `DOCKER-USER` — relevés **avant** toute intervention et recomparés après ;
- version de Docker et de compose ; que le réseau interne du parc existe bien et est déclaré **externe** ;
- **RAM et CPU disponibles** pour construire l'image sur place (`vite build` + `tsc`) ;
- **texte réel du script de sauvegarde** (ce rapport s'appuie sur une transcription, pas sur le
  script vivant) : fonctions disponibles, destination, rétention, espace libre exigé ;
- que `bob-crm`, `/opt/bob-crm/` et `bob-crm.sapulse.fr` sont **libres** ;
- configuration du reverse proxy : certificats existants, Access Lists en place ;
- espace disque de `/opt` et du dossier de sauvegarde ;
- coffre à secrets et forge Git opérationnels (et runners éventuels) ;
- IP publique du VPS et zone DNS réellement servie par Hostinger.

### 9.4 À vérifier **côté services tiers**

- Vercel : liste réelle des variables d'environnement (noms + portée), Deployment Protection,
  dernier déploiement de production ;
- Azure / Sopitec : pas de restriction d'IP sortante ni d'accès conditionnel sur l'application,
  échéance du secret client ;
- Turso : plan, région, jetons existants (à invalider à la fin).

---

### 9.5 Renvois hors dépôt

Le détail d'infrastructure (parc, proxy, sauvegarde), la description technique du prérequis du
§2.1 et un point de sécurité repéré hors périmètre sont dans la **fiche locale hors Git**, dont le
chemin est connu de César et qui est à déposer dans le coffre à secrets SAPulse.

---

*Audit réalisé en lecture seule le 2026-09-18. Aucune modification de code, de configuration, de
prod ni de base. Les chiffres de la base proviennent de `SELECT COUNT(*)` et `PRAGMA` exécutés sur
la prod sans écriture.*
