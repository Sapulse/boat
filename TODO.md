# CRM Brest Ocean Boat — Roadmap & TODO

État au **17/09/2026** : **v4.0.0 prête, NON déployée** (lots 2 à 5 sur `main`). En prod :
`prod-2026-09-16` (lot 1). Détail des décisions : `docs/LOTS.md` ; mise en production :
`docs/DEPLOIEMENT.md` ; historique : `CHANGELOG.md`.

App : SPA React + Vite + TS, API (fonction unique `api/[...slug].ts`) + base **Turso**,
compte unique partagé, déployée sur **Vercel** (`boat-eta.vercel.app`) ; bascule vers le
VPS SAPulse (OVH) prévue. Méthode : diagnostic + plan → validation → code (commit local par
sous-étape) → lint + typecheck + `npm test` (46 harnais) + build → test réel sur base
jetable (ordinateur + 375 px) → push en fin de lot → STOP bilan. Migrations additives
écrites à la main, scripts au verrou prod. Aucun déploiement sans GO.

---

## 🚧 EN COURS — mise en production v4.0.0

- [x] Lots 2 à 5 développés, testés, poussés (voir `docs/LOTS.md`).
- [x] Répétition complète du 17/09 sur une copie de la prod (5 scripts, preuves, rejeu
  sans effet, app chargée sans erreur) — `docs/DEPLOIEMENT.md`.
- [x] Fiche équipe à jour (`docs/FICHE-EQUIPE-LOT2.md`, section « Autres nouveautés »).
- [ ] **Date de la fenêtre** à caler avec le client, **GO de César**.
- [ ] Jour J : suivre `docs/DEPLOIEMENT.md` (fenêtre 45 min) ; recompter « Le premier
  jour » juste avant d'envoyer la fiche (au 17/09 sur la copie : 8 retards, 252 à
  planifier dont 26 sans commercial, 37 Reportés sur 38 sans date).
- [ ] Le soir (après l'heure du retour arrière) : **rotation du token Turso** (option,
  procédure dans `docs/DEPLOIEMENT.md` ; CLI `turso` à installer).

## ⏭️ APRÈS LA MISE EN PRODUCTION

- [ ] **Date pré-remplie dans la fenêtre « Prochaine action »** selon le type (ex. relance
  J+3, après un devis J+7), toujours modifiable. Demandé le 17/09 — pas avant la mise en prod.

- [ ] **Icône CRM sur l'écran d'accueil des téléphones** — à faire AVEC la bascule VPS (l'adresse
  change : les icônes seront à recréer sur les téléphones à ce moment-là). Ajouter un manifest :
  nom « CRM BOB », icônes logo BOB 192 px et 512 px + `apple-touch-icon`, `display: standalone`,
  couleur de thème ; compatible avec la base `/boat/` et avec la future adresse du VPS.
  **Pas** de service worker, **pas** de mode hors ligne. Demandé le 17/09 (main gelée).
  - Android : bouton « Installer le CRM » (événement `beforeinstallprompt`), masqué si le CRM
    est déjà installé ;
  - iPhone : petit bandeau explicatif affiché une seule fois (Safari → Partager → Sur l'écran
    d'accueil), masquable.
- [ ] **Piste à chiffrer — envoi des mails directement depuis le CRM (Microsoft Graph)** :
  DIAGNOSTIC SEULEMENT, pas de code.
  - nécessite la permission `Mail.Send` accordée par Sopitec sur l'application Azure
    existante (aujourd'hui `Mail.Read` seulement, pour la boîte de réception) ;
  - enregistrement automatique dans l'historique : plus de confirmation « Avez-vous bien
    envoyé le message ? » pour ces envois ;
  - à étudier : boîte expéditrice avec le compte partagé, pièces jointes, copie dans
    « Éléments envoyés », gestion des erreurs, RGPD.
- [ ] **Option de secours — ouvrir les mails dans Outlook web** (au lieu du lien `mailto:`), si
  l'application de messagerie par défaut pose problème sur un poste. Diagnostic du 17/09, pas de code.
  - **Où** : un seul constructeur, `buildMailto` (`src/lib/email.ts`), appelé par `sendEmail`
    (`src/pages/LeadDetailPage.tsx`) pour les modèles, les relances (ce sont des modèles) et
    « Email sans modèle » ; plus le lien simple sur l'adresse de la fiche (`href="mailto:…"`, même
    fichier). La vue « À relancer » et le bouton « Relancer » n'ouvrent aucun mail.
  - **Lien** : `https://outlook.office.com/mail/deeplink/compose?to=…&subject=…&body=…`, chaque
    valeur passée par `encodeURIComponent` (accents en UTF-8, retour à la ligne `%0A`). Ouverture
    dans un nouvel onglet (`window.open` dans le clic, comme WhatsApp : pas de blocage de fenêtre).
    À vérifier sur un vrai poste : retours à la ligne bien rendus, accents, `+` et `&` dans le corps,
    comportement si la session Outlook web n'est pas ouverte (passage par la connexion Microsoft).
  - **Longueur** : aucune limite documentée par Microsoft. Seuil prudent retenu : 2 000 caractères
    (au-delà, risque d'erreur ou de corps perdu, surtout via la page de connexion). Mesure sur les
    **16 modèles réels** (lecture seule de la prod, pire cas des leads : nom 31, modèle 48, email 45 ;
    signatures actuellement vides) : lien le plus long **863** (« Relance devis J+3 »),
    **aucun ne dépasse**. Si un modèle dépassait : ouvrir Outlook web avec destinataire + sujet et
    copier le corps dans le presse-papiers (message « corps copié, collez-le »), sinon repli `mailto:`.
  - **Réglage par poste** (navigateur, `localStorage`, pas en base) : « Application par défaut /
    Outlook web », par défaut « Application par défaut » ; lecture protégée (valeur absente ou
    illisible = application par défaut).
  - **Confirmation** « Avez-vous bien envoyé le message ? » : inchangée (`flow.confirmMessage`).
  - **Estimation** : ½ à 1 jour (constructeur + tests au harnais, réglage, test manuel sur un poste).
  - **Mise en prod** : aucune migration, aucune API, aucune donnée → la répétition du 17/09 reste
    valable ; seulement un contrôle manuel en plus à la recette. Hors v4.0.0 (main gelée) sauf
    correctif validé par César.
- [ ] **Lot « Salons »** — besoin exprimé par Nicolas en réunion : remplacer le fichier Excel des
  RDV de salon ; toute l'équipe doit voir qui a RDV avec quel client et quel jour. Demandé le 17/09
  (main gelée) — **diagnostic d'abord**, pas de code.
  - Déjà couvert par la v4 : RDV dans l'Agenda visibles par tous, plusieurs personnes, responsable
    modifiable.
  - À étudier :
    - événement « Salon » sur plusieurs jours, avec lieu et plusieurs participants ;
    - type d'action « RDV salon » (ou rattachement d'un RDV à un salon) + filtre / vue « Salon »
      dans l'Agenda ;
    - création rapide d'un lead sur mobile pendant le salon (nom, téléphone, bateau, source = le
      salon) enchaînée sur le RDV ;
    - stat après salon : nombre de contacts et de RDV par salon (lien avec Acquisition ?).
### Lot salons — suite

- [ ] **Import CSV du fichier clients** (lundi, si Nicolas fournit l'export). Le CRM ne contient
  **que le flux entrant depuis octobre 2025** (443 leads, le plus ancien au 05/10/2025) : les
  segments « Client en portefeuille » et « Client atelier / magasin » du fichier de suivi n'ont
  aucun équivalent en base. **Contrainte à intégrer À LA CONCEPTION, pas après** : déduplication
  sur **email ET téléphone** contre les leads existants — sans elle, un client déjà présent comme
  lead entrant serait appelé deux fois par deux commerciaux pendant le salon. L'app a déjà de quoi
  s'appuyer dessus (`src/lib/duplicateLeads.ts`, `src/lib/importLeads.ts`) : à reprendre, pas à
  réécrire. Prévoir aussi : que fait-on d'un doublon trouvé (fusion ? rattachement à la campagne du
  lead existant ? les deux ?).

- [ ] **S2c — édition en ligne** (statut de campagne, priorité, responsable) depuis la liste de
  travail, enregistrement immédiat. Reporté au **mardi** (décision du 18/09 : S2d passe devant).

### Après le salon

- [ ] **Sous-enregistrement des appels — constat chiffré du 18/09** : sur 11 mois et 443 leads,
  l'historique ne porte que **30 appels pour 99 emails** (145 actions au total). Quatre commerciaux
  qui vendent des bateaux en passent davantage en une semaine. **Tout l'écran Campagnes repose sur
  ces enregistrements** (nombre d'appels, dernier contact, taux de contact) : les compteurs ne
  vaudront que ce que l'équipe saisit. C'est d'abord un sujet d'usage, mais le code peut aider —
  réduire la friction de saisie (bouton d'échange au plus près de l'appel, valeurs par défaut,
  moins de champs obligatoires). À reprendre après le salon, avec les chiffres de la semaine.

- [ ] **Capture mobile automatisée dans le harnais** (demandé le 18/09) : un script réutilisable à
  chaque lot qui ouvre l'app dans un **viewport émulé 375 px** et enregistre des captures, pour ne
  plus dépendre du redimensionnement de la fenêtre Chrome (qui reste sans effet quand la fenêtre est
  maximisée — constaté ce soir). À brancher sur le banc de test local.

- [ ] **Asymétrie de la boîte de réception dans les sauvegardes** (repérée le 18/09, hors périmètre
  de la semaine du salon) : une sauvegarde contient bien les emails entrants (clé `inboundEmails`,
  148 lignes au 18/09), mais ils sont **hors `AppState`** — vérifier si `restoreBackup` les recrée
  ou si une restauration les perd. Le commentaire du script de sauvegarde dit « conservé pour
  reprise manuelle, non réinjecté par Restaurer » : si c'est confirmé, soit on les réinjecte, soit
  on l'écrit noir sur blanc dans l'écran de restauration. Préexistant au lot salons.

### Bascule VPS

Audit complet du 18/09 : **`docs/MIGRATION-VPS.md`** (le détail d'infrastructure et les points
sensibles sont dans une fiche locale hors dépôt, chemin connu de César).

- [ ] **PREMIER PRÉREQUIS — identification de l'IP cliente derrière le reverse proxy**
  (`api/_lib/loginRateLimit.ts`). **Bloquant : pas de bascule sans ce correctif.**
  Aujourd'hui l'IP est déterminée d'une façon valable sur Vercel mais **pas derrière un reverse
  proxy** : la limitation des tentatives de connexion (5 par quart d'heure) ne jouerait plus son
  rôle une fois le CRM sur le VPS.
  - Options à trancher au moment du lot : (a) tenir compte du **nombre de proxys de confiance**
    entre Internet et l'application ; (b) ne se fier qu'à un **en-tête dédié réécrit par le
    reverse proxy** (que le client ne peut donc pas imposer) ; (c) définir le **repli** quand
    l'en-tête attendu est absent ou mal formé — sans retomber sur une clé commune à tout le monde.
  - Le détail technique et la recommandation sont dans la fiche locale, **pas ici**.
  - Fonction **pure** déjà isolée + harnais existant (`scripts/harness-login-ratelimit.ts`) :
    ajouter les cas « en-tête forgé », « proxy unique », « en-tête absent ». **≈ 0,5 j.**
  - **Part AVEC le lot VPS, avant l'ouverture à l'équipe**, jamais après.
  - Vérifié le 18/09 : **aucun autre endroit du dépôt ne lit `x-forwarded-for` / `x-real-ip`**.
    `clientIp()` n'est appelée que par `POST /api/login` ; les journaux d'erreur n'écrivent pas
    d'IP ; il n'y a pas de journal d'audit. Seule donnée dérivée stockée : la clé de
    `login_attempts`.
- [ ] **Sauvegarde pendant la phase « Turso conservé »** : tant que la base reste chez Turso, le
  CRM n'a rien dans `/opt` et **échappe entièrement à la sauvegarde du parc**. Prévoir **dès le
  lot VPS** une sauvegarde quotidienne dédiée (`scripts/backup-turso.ts`, lecture seule, lancé
  par un conteneur outil + minuterie, écrivant sous `/opt/<nom>/sauvegardes/` pour que la copie
  parte hors du serveur par le chemin déjà en place) avec son **contrôle de restaurabilité**
  (le script valide déjà le fichier relu du disque ; échec = code de sortie non nul). **≈ ½ j.**
- [ ] **Secrets déposés dans le coffre AVANT la bascule** : `AZURE_CLIENT_SECRET` (illisible chez
  Vercel — sinon il faut demander un nouveau secret à Sopitec), jeton Turso, hachage du mot de
  passe partagé.
- [ ] **Domaine** : hypothèse `bob-crm.sapulse.fr` ; **question « domaine du client ? » posée à BOB
  maintenant** — le délai est externe (registrar), et on ne veut qu'un seul changement de nom.
- [ ] **Bascule VPS OVH** : reprendre `vercel.json` (en-têtes, réécriture `/api`, cache),
  types `@vercel/node`, base Vite selon `VERCEL` (voir `docs/DEPLOIEMENT.md` et
  `docs/MIGRATION-VPS.md`).
- [ ] Aligner les noms des **stats mensuelles** d'Acquisition (Le Bon Coin, Site web BOB,
  Annonce du bateau, Boats Wizard) sur les sources des leads.
- [ ] **BoatsGroup** : source séparée en attente de confirmation client.
- [x] Script de **cohérence / réalignement** lead ↔ actions programmées
  (`scripts/realign-planned-actions-turso.ts`, 17/09) : en lecture seule au jour J (étape 8 bis,
  attendu 0 divergence) ; en `--apply` seulement pour revenir à la v4 après un retour arrière.
- [ ] **Supprimer un commercial** (test / doublons) : à concevoir avec les données liées
  (leads, actions, objectifs, objectifs de la semaine — FK `RESTRICT`).

---

> Les sections ci-dessous sont l'historique de la V3 (prototype localStorage puis
> backend). Les mentions « ✅ v3 » / « en partie depuis la v4 » signalent ce qui a été traité depuis.

## ✅ FAIT (en prod, V3)

- **Cohérence données** : dates de transition de statut centralisées (`statusMilestoneDates`)
- **Sécurité** : injection de formule CSV neutralisée (M1)
- **UX** : pipeline cliquable, jalon contact auto, feedback export, titre fiche, tooltip cloche
- **Emails** : templates éditables (page Modèles), signature par commercial (Équipe),
  envoi pré-rempli + journalisation
- **Vue "À relancer"** : basée sur `getLeadRisks` (filtres commercial + sévérité)
- **Export PDF** : Dashboard / Performance / Acquisition via `window.print()`
- **vCard** : export contact .vcf + import multiple avec détection de doublons
- **Branding** : logo Brest Ocean Boat, sidebar réorganisée (groupe Paramètres),
  renommage app, version affichée

### Patchs post-V3
- **`v3.0.1`** — correctifs audit : lien Dashboard « Signés », `saveState` try/catch,
  compat vCard Safari < 16.4 (parser sans lookbehind regex)
- **`v3.0.2`** — finition UI : libellés KPI non tronqués + accents harmonisés
- **`v3.1.0`** — gestion des actions d'un lead : prochaine action éditable,
  historique modifiable/supprimable (actions reducer confinées)

### Série de fiabilisation du 10/06 (check Fable complet → 5 lots)
- **`v3.1.1`** — intégrité des données : re-seed destructif corrigé (**N1**),
  `lastActionDate` insensible aux actions antidatées, jalons à la création (+ harnais)
- **`v3.1.2`** — cohérence relances : prédicat unifié `hasPlannedNextAction`,
  détection des actions planifiées échues (+ harnais risques)
- **`v3.1.3`** — résilience : ErrorBoundary racine, page 404
- **`v3.1.4`** — finition : accents résiduels, encodage mailto
- **`v3.1.5`** — lot petits & moyens : **lint 0 erreur**, **audit 0 vulnérabilité**,
  liens KPI filtrés, import vCard QUOTED-PRINTABLE, a11y. **3 harnais committés**

### Fonctionnalités & correctifs v3.2 → v3.4
- **`v3.2.0`** — modèles de message : gestion libre (garde-fou min-1), type **email | sms**,
  migration localStorage sans perte (prouvée au harnais)
- **`v3.3.0`** — bouton « Envoyer SMS » : modèles SMS, lien `sms:` (`buildSms`),
  action journalisée, désactivé sans numéro (validé sur mobile réel)
- **`v3.4.0`** — suivi & mobile (retours Mickaël) : action future suspend l'inactivité
  sauf leads chauds (`hasFutureNextAction`) ; Kanban drop fiable + tactile ; responsive
- **`v3.4.1`** — confort mobile & dette : graphes lisibles en étroit, cibles tactiles
  ≥ 40px, dépose `@dnd-kit/sortable` + `@dnd-kit/utilities` (inutilisés)

### Lots du 17/06 (préparation déploiement + 3 canaux + agenda + heures)
- **`v3.5.0`** — **base vierge** : démarrage SANS données de démo à la première
  installation (localStorage absent / JSON invalide) ; équipe (`DEFAULT_COMMERCIALS`)
  et modèles (`DEFAULT_TEMPLATES`) conservés. Protection **N1 préservée** (un état
  persisté, même vide, n'est jamais re-seedé). `generateSeed*` gardées mais plus
  appelées. Harnais reducer 67.
- **`v3.6.0`** — **bouton WhatsApp** (3e canal) : modèles type `whatsapp`, lien
  `wa.me` au format international (`buildWhatsApp` / `toWaNumber`, indicatif défaut 33),
  action `whatsapp` journalisée, migration des modèles sûre (type inconnu → email).
  Harnais reducer 80. ⚠️ **Lien `wa.me` à confirmer sur mobile réel** (comme le SMS).
- **`v3.7.0`** — **AGENDA** : page dédiée, **3 vues** (semaine / mois / journée
  comparative par commercial), couleur par commercial + filtre + légende, actions
  échues signalées. **Interactif** (créer sur date vide / replanifier par drag en
  semaine + re-sélecteur en mois/journée), tout via `SET_NEXT_ACTION`. Helpers purs
  `lib/agenda.ts`, aucune lib calendrier ajoutée. Harnais reducer **91**.
- **`v3.8.0`** — **heure optionnelle** sur la prochaine action (champ séparé
  `Lead.nextActionTime?`, `nextActionDate` intouché) : éditeur fiche date + heure
  facultative, agenda affiche l'heure dans les pastilles + tri sans-heure d'abord
  puis chronologique (3 vues), drag/re-sélecteur conservent l'heure. Migration
  localStorage nulle. Harnais reducer **103**. *(= L1 du diagnostic « agenda
  complet », voir ci-dessous.)*
- **`v3.9.0`** — **agenda en grille horaire** : vues **Semaine** (7 jours × heures)
  et **Journée** (comparative préservée : heures × commerciaux) en grille type
  Google Agenda, plage **8h-18h** / créneaux **30 min** (en constantes). Bandeau
  « toute la journée » + report des actions hors-plage (aucune masquée).
  **Clic-créneau → création avec heure pré-remplie** (Semaine + Journée), drag
  conservé au **niveau jour** (l'heure suit). Mois inchangé. Helpers purs
  `buildTimeSlots`/`eventSlot`/`layoutDayEvents` + composant `TimeGrid`. Harnais
  reducer **121**. *(= L2 du diagnostic « agenda complet ».)*
- **`v3.10.0`** — **durée des actions** : heure de fin optionnelle (champ séparé
  `Lead.nextActionEndTime?`) → bloc qui s'étire sur ses créneaux, chevauchements
  côte à côte en couloirs, clamp 18h. Éditeur + créateur : champ Fin (validation
  fin > début). `TimeGrid` réécrit en column-major + positionnement absolu ;
  helper pur `layoutDayGrid`. Harnais reducer **148**.
- **`v3.11.0`** — **drag par créneau** : glisser un bloc change le **jour ET
  l'heure** (durée préservée, clamp 18h) ; drag activé en Journée (change l'heure,
  commercial jamais modifié). 1 droppable/colonne + `delta.y` ; helpers purs
  `startSlotIndex`/`shiftEventBySlots`. Harnais reducer **166**.
- **`v3.12.0`** — **redimensionner un bloc à la poignée** (souris + tactile,
  aperçu live, min 30 min, clamp 18h, début fixe). Helper pur `resizeEventBySlots`.
  Harnais reducer **176**. *(= le « glisser-pour-définir-la-durée » envisagé, fait.)*
- **`v3.13.0`** — **événements d'agenda libres** (non liés à un lead) : entité
  `CalendarEvent` isolée (tableau + ADD/UPDATE/DELETE confinés, migration nulle),
  catégories colorées (réunion/congé/déplacement/perso), création (clic créneau →
  choix Action/Événement) / édition / suppression, drag + resize, 3 vues. Affichage
  unifié `GridItem`. Harnais reducer **198**. *(= L3 du diagnostic, version
  localStorage ; L4 agenda partagé = backend.)*

---

## 🗺️ ROADMAP — issue des 3 RDV Ocean Boat

### 🟢 À TRAITER — ne dépend de personne (prêt à démarrer)

- [ ] *(en partie depuis la v4 : le lot 2 impose une prochaine action après chaque action, mais aucun délai J+3 / J+7 n'est proposé)* **Relances PROPOSÉES** (pré-remplies, modifiables) après certaines actions :
  ex. devis envoyé → proposer une relance à J+3 / J+7. **Pré-remplissage, PAS
  automatisme** (l'utilisateur valide/ajuste). S'appuie sur le mécanisme
  `SET_NEXT_ACTION` + la détection de risques existante.
- [ ] **Modèles multilingues** (FR / EN / PT) : étendre les modèles de message par langue.

### 🟡 À CLARIFIER — décision Mickaël ou dépend d'Infocob (ne pas coder avant réponse)

- [ ] **Noms des colonnes du pipeline** + statut **« Qualifié » ambigu** : décision
  métier qui touche le cœur (statuts). Attendre l'arbitrage de Mickaël.
- [ ] **Types d'actions à aligner sur Infocob** : attendre la liste de référence Infocob.
- [ ] **Export Infocob** : à quel moment exporter + quelles données synchroniser
  (dépend d'Infocob).
- [ ] **Historique de température** (oui/non) : le client penche pour **non** — à confirmer.
- [ ] **Vue Prospects** : exclure aussi perdus/reportés ? (aujourd'hui seuls les signés
  sont exclus — comportement documenté, changement = décision métier).

### 🔵 PLUS TARD — dépend du backend / d'éléments externes

- [ ] **Import Excel** de la vraie base Ocean Boat (après validation client). Spec de
  mapping prête : `mapping-import-excel.md`. ⚠️ À faire dans la base partagée, pas en
  localStorage. Pré-requis : commerciaux créés, sources/types alignés, clarifier "DV"/"BO".
- [x] ✅ v3 (boîte de réception, juillet) — **Import de leads depuis emails** : semi-manuel d'abord, puis agent IA. *Le client
  doit fournir 2-3 mails types* pour caler le parsing.
- [ ] **Supprimer un commercial** (pas juste le masquer/désactiver) — *évolution
  fonctionnelle, hors chantier migration, à traiter APRÈS le Lot 5, une fois sur la base.*
  Besoin : nettoyer les commerciaux de **test / doublons**. Aujourd'hui l'UI ne fait que
  **désactiver** (`TOGGLE_COMMERCIAL`), il n'y a **pas de suppression** (ni action reducer,
  ni endpoint). À **concevoir proprement** en gérant les **données liées** (leads, actions,
  `commercial_goals` référençant le commercial — FK `RESTRICT` aujourd'hui côté schéma) :
  soit **interdire** la suppression s'il a des leads/données, soit **réassigner d'abord**
  (comme le fait déjà `EquipePage` pour la désactivation), soit **cascade contrôlée**
  explicite. À cadrer le moment venu.
- [ ] **Agenda complet type Google/Outlook** (étude de faisabilité faite, 17/06) :
  - **L1 — heures** → ✅ **FAIT en v3.8.0** (créneaux horaires sur les actions de leads,
    propre en localStorage car champ par lead).
  - **L2 — grille horaire visuelle** (vues Semaine/Journée) → ✅ **FAIT en v3.9.0**,
    enrichi ensuite : **durée/blocs** (v3.10.0), **drag par créneau** jour+heure
    (v3.11.0), **resize à la poignée** (v3.12.0), **amplitude 0h-24h + scroll** (v3.19.2).
    Créneaux 30 min.
  - **L3 — événements libres** (réunion, congé, déplacement, bloc perso, non liés à
    un lead) → ✅ **FAIT en v3.13.0** (version test localStorage) : entité
    `CalendarEvent` isolée (tableau + ADD/UPDATE/DELETE confinés), catégories
    colorées, CRUD modale, drag + resize, 3 vues. Données **mono-poste** (non
    partagées) ; entité **isolée pour rebranchement backend** (L4) sans réécriture.
  - **L4 — agenda d'équipe PARTAGÉ** : impossible en localStorage (chaque poste est isolé).
    **Dépend du backend.** 👉 Reco du diagnostic : quand le backend arrivera, **évaluer
    d'abord la synchro Outlook 365** (Microsoft Graph) plutôt que reconstruire un
    calendrier maison — **Infocob est déjà connecté à Outlook 365**, donc Outlook EST
    déjà le calendrier partagé de l'équipe (Graph nécessite tout de même un broker
    d'auth côté serveur = backend).
- [ ] **Synchro Outlook / Infocob** : Infocob déjà connecté à Outlook 365 — point
  d'intégration clé (cf. L4 ci-dessus : alternative à un calendrier maison).
- [x] ✅ v3 (API + Turso) — **Base partagée multi-postes** (backend Vercel ou autre) — **LE grand jalon** : ce
  qui fait passer du prototype à l'outil utilisé par 4 commerciaux. Débloque comptes,
  déploiement chez eux, import Excel réel, agenda partagé (L3/L4). Bloqué sur le choix d'infra.
- [ ] **Enregistrement / transcription d'appels** : sujet à part, **enjeu RGPD** fort.

---

## ℹ️ POINTS D'USAGE — résolus, PAS du développement

- **« Le VCF ne pioche pas dans les contacts du téléphone »** (soulevé en RDV) :
  **FAUX BUG.** L'export `.vcf` et l'import `.vcf` (multiple + détection de doublons)
  **fonctionnent**. Le besoin sous-jacent — « sélectionner directement dans le carnet
  de contacts du téléphone » — est **impossible pour une page web** (barrière de
  sécurité du navigateur : pas d'accès au carnet natif). **Contournement utilisateur** :
  Contacts du téléphone → *Partager / Exporter en VCF* → importer le fichier dans le CRM.
  → **Question d'usage à expliquer au client, aucun développement requis.**

---

## ➕ FONCTIONNALITÉS EN PLUS (faisables sans backend, en réserve)

- [ ] **Onglet Paramètres** : exposer la **plage horaire de l'agenda** (aujourd'hui en
  constantes `AGENDA_HOUR_START` / `AGENDA_HOUR_END` / `AGENDA_SLOT_MIN`) en réglage UI —
  **petit lot séparé** à faire quand le besoin se présente. Porte d'entrée pour d'autres
  réglages plus tard.
- [ ] **Couche IA email** : pré-rédaction d'un mail lisant la fiche du lead (templates
  déjà en place ; nécessite une clé API). Recoupe l'import de leads par IA.
- [ ] **Comptes / mot de passe entreprise** : n'a de sens qu'avec le backend.

---

## 🐛 DETTE TECHNIQUE / À SURVEILLER (non bloquant)

- [x] **Bundle monolithique ~875 kB** (gzip ~250) : code-splitting par route
  (`React.lazy`) pour alléger le 1er chargement. → **FAIT en `v3.24.0`** : bundle
  initial ~200 kB (gzip ~64), recharts (~340 kB) isolé sur les seules pages à graphes.
- [ ] **Agenda — reportés exclus volontairement** : `buildAgendaEvents` ne liste que les
  leads actifs (cohérence alertes/risques). Ajoutable si Ocean Boat veut voir les
  reportés à l'agenda (one-liner).
- [ ] **Acquisition (onglets Volumes / Saisie)** : copient `state` dans un `useState`
  local au montage → désync possible + perte de saisie si on quitte sans « Enregistrer ».
- [ ] **Dashboard** : blocs « chauds sans action » / « devis sans relance » encore inline
  au lieu de réutiliser `getLeadRisks` (partiellement unifié).
- [ ] Dépendances très avancées (React 19, Vite 8, TS 6) — surveiller la repro du build.

---

## Prochain vrai jalon

Mise en production de la **v4.0.0** (voir « EN COURS » en tête), puis bascule VPS OVH.
En attente client : date de la fenêtre, arbitrages Mickaël (statuts/pipeline),
réponses Infocob (types d'actions, export), confirmation BoatsGroup.
