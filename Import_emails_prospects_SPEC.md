# SAPulse × Brest Ocean Boat — Import automatique des prospects par email

*Cartographie d'extraction, grille de tri prospect / parasite, et architecture semi-automatique*

**Document de spécification — v1**

Établi à partir de ~22 emails réels fournis par l'équipe (4 familles de sources).

**Statut : préparation — à brancher sur un backend + accès Microsoft 365 (voir §7).**

---

## 0. En bref

**Objectif :** supprimer la ressaisie manuelle des prospects qui arrivent par email (site, plateformes d'annonces, Leboncoin…) en les extrayant automatiquement et en les présentant, pré-remplis, à une validation humaine avant enregistrement dans le CRM.

**Principe retenu : semi-automatique.** Le système lit et prépare ; un humain valide, attribue à un commercial (ou laisse « non attribué »), puis enregistre. Rien n'entre dans le CRM sans validation.

**Pourquoi pas 100 % automatique : 40 % des emails sont des parasites** (démarchage web, hôtelier, arnaques B2B, factures, cotations) qui arrivent par les mêmes canaux que les vrais prospects. Seul un contrôle humain garantit un fichier propre.

**Ce que ce document N'EST PAS :** *spécification* qui servira (a) à construire l'outil le moment venu, et (b) de support à la décision « backend + accès boîte mail » avec la direction d'Ocean Boat.

---

## 1. Les 4 familles de sources

Chaque source a une structure d'email différente ; il faut donc un extracteur par source, reconnu d'abord par l'adresse d'expédition. Vue d'ensemble :

| Source | Reconnaissance (expéditeur) | Richesse des données | Fiabilité « vrai prospect » |
|---|---|---|---|
| boats.com / BoatWizard | `@leads.boats.com` | ★★★ Très riche, étiqueté | **100 %** |
| Formulaire du site | `noreply@brest-ocean-boat.fr` | ★★★ Riche, étiqueté | Moyenne (ouvert au démarchage) |
| Leboncoin | `@messagerie.leboncoin.fr` | ★★ Variable (2 formats) | Bonne |
| Band of Boats | `info@bandofboats.com` | ★ Pauvre (HTML, minces) | Faible (mélange tout) |

**Regroupement clé : tous le même format** via le réseau boats.com. Un seul extracteur couvre ces 6+ plateformes.

---

## 2. Cartographie d'extraction, source par source

Pour chaque source : comment la reconnaître, ce qu'on extrait de façon fiable, et ce qui est incertain. Le mapping vers le modèle de lead du CRM (champs `firstName`, `lastName`, `email`, `phone`, `boatInterest`, `brand`, `source`) figure au §4.

### 2.1 — boats.com / BoatWizard (la meilleure source)

Format « machine » à champs étiquetés, identique sur toutes les plateformes du réseau. Exemple réel (anonymisé) :

> PROSPECT INDIVIDUEL — Nom, Téléphone, E-mail · INFOS PROSPECT — Origine du contact (YachtWorld…) · BATEAU — Marque, Modèle, Année, N° de série, URL de l'annonce.

- **Extraction fiable :** nom complet, téléphone (souvent international), email, plateforme d'origine réelle, marque + modèle + année du bateau.
- **Bonus commercial :** un bloc « LEADSMART » liste d'autres bateaux consultés récemment par le prospect → signal d'un acheteur actif (à consigner dans les notes du lead).
- **Incertitudes :** quasi aucune. C'est la source à automatiser en priorité (candidate à l'auto complet dans un second temps).

### 2.2 — Formulaire du site (riche mais ouvert à tous)

- **Extraction fiable :** Nom, Prénom, Téléphone, Email, Adresse, Code postal, Ville — tous étiquetés — + le message libre.
- **Piège n°1 — transfert interne :** *sous* le fil de transfert : l'extracteur doit descendre jusqu'au formulaire original.
- **Piège n°2 — démarchage :** le formulaire public reçoit beaucoup de sollicitations commerciales (développeurs web, hôteliers…). C'est la source la plus « bruitée » avec Band of Boats → validation humaine indispensable.

### 2.3 — Leboncoin (deux formats à gérer)

- **Format récent (riche) :** Prénom, Nom, Email, Téléphone, Ville étiquetés + bateau et prix dans le corps → extraction quasi complète.
- **Format ancien (pauvre) :** email + pseudo seulement, message enfoui en bas d'un fil de conversation, pas de téléphone.
- **Règle :** chercher d'abord les champs étiquetés ; à défaut, retomber sur email + bateau (objet) + dernier message du fil.

### 2.4 — Band of Boats (la plus difficile)

- **Contenu en HTML :** le texte brut est quasi vide ; l'info utile (qui a écrit, quel message) est dans la partie HTML, noyée dans du tracking.
- **Données minces :** souvent juste un prénom + le bateau (dans l'objet). Ni email ni téléphone directs — il faut répondre via leur plateforme.
- **Mélange tout :** depuis la même adresse arrivent de vrais prospects, du démarchage, des factures et des cotations. Le tri ne peut pas se faire sur l'expéditeur seul → il faut lire l'objet et le contenu (voir §3).

---

## 3. Tri « vrai prospect » / « parasite »

Le point le plus sensible. Sur l'échantillon, ~40 % des emails ne sont pas des prospects. La validation humaine tranche, mais un **score de pertinence** pré-trie la file (les plus probables en haut, les suspects signalés).

### Signaux de VRAI prospect (score +)

- Mentionne un bateau précis : marque, modèle, ou une annonce (Antarès 8, Prestige 32, Highfield 700…).
- Intention claire : acheter, vendre/reprendre, faire entretenir, stocker, obtenir un devis.
- Message court et concret, coordonnées personnelles (email perso, mobile FR).
- Source fiable : tout email boats.com (toujours « INTERESTED-IN »).

### Signaux de PARASITE (score −)

- **Parle de SON offre, pas de TON bateau :** « je suis développeur », « notre groupe hôtelier », « I am Sales Manager », « partnership / collaboration ».
- **Émetteur = entreprise tierce :** adresse pro d'un autre domaine, ton non francophone, signature commerciale.
- **Objet non-prospect :** « facture », « cotation », « devis pour VOUS », newsletter, promotion.

### Exemples réels de l'échantillon

| Émetteur | Verdict | Motif |
|---|---|---|
| Prospects boats.com (échantillon) | **Prospect** | Bateau précis + intérêt explicite, format fiable |
| Demandes via le site : achat zodiac / entretien / pièces | **Prospect** | Concret, coordonnées personnelles |
| Répondeurs Leboncoin (×2) | **Prospect** | Intérêt bateau + reprise |
| Démarcheur web (×2, via le formulaire) | **Parasite** | Développeur web qui démarche |
| Groupe hôtelier régional | **Parasite** | Vend des hébergements |
| Faux acheteurs B2B (« grande enseigne », négoce) | **Parasite** | Démarchage B2B / probable arnaque |

*Identités retirées de ce document (RGPD) : les exemples nominatifs restent consultables dans l'échantillon local non versionné (`docs/emails-echantillon/`).*
| Facture / Cotation Band of Boats | **À écarter** | Administratif, pas un prospect |

> ***Note :** le score aide, il ne décide pas. La décision finale reste humaine — c'est le rôle de l'écran de validation (§5).*

---

## 4. Correspondance avec le modèle de lead du CRM

Ce que chaque source alimente dans les champs existants du lead. « ✔ » = fiable, « ~ » = parfois/à vérifier, « ✗ » = absent.

| Champ lead | boats.com | Site | Leboncoin | Band of Boats |
|---|---|---|---|---|
| `firstName` / `lastName` | ✔ | ✔ | ~ (pseudo) | ~ (prénom) |
| `email` | ✔ | ✔ | ✔ | ✗ (via plateforme) |
| `phone` | ✔ | ✔ | ~ | ✗ |
| `brand` / `boatInterest` | ✔ | ~ (dans msg) | ✔ (objet) | ✔ (objet) |
| `source` | ✔ (plateforme) | ✔ | ✔ | ✔ |
| `notes` (message) | ✔ + LeadSmart | ✔ | ~ (fil) | ~ (HTML) |
| `commercialId` | *attribué à la main à la validation* | → | → | → |

**Point de vigilance « source » :** les valeurs réelles (YachtWorld, iNautia, Leboncoin, Band of Boats, Site…) doivent exister dans la liste SOURCES du CRM. Un rapprochement avec l'existant sera nécessaire (certaines valeurs à ajouter).

---

## 5. Fonctionnement semi-automatique retenu

Le parcours d'un email, de la boîte de réception au lead enregistré :

1. **Collecte —** Le système lit les nouveaux emails de la boîte (dossier dédié). Nécessite l'accès Microsoft 365 (§7).
2. **Reconnaissance —** Identifie la source via l'expéditeur → choisit le bon extracteur.
3. **Extraction —** Extrait les champs selon la cartographie (§2) et calcule le score de pertinence (§3).
4. **File « à valider » —** Chaque email devient une fiche lead pré-remplie dans une file d'attente, triée par score.
5. **Validation humaine —** Un humain lit la fiche : ACCEPTER (choix du commercial, ou « non attribué ») ou REJETER.
6. **Enregistrement —** Sur ACCEPTER, le lead entre dans le CRM, déjà attribué. Sur REJETER, il est écarté (et sert à améliorer le score).

**Décisions figées :** semi-auto partout ; attribution manuelle du commercial à la validation ; « non attribué » autorisé ; un lead = un commercial.

**Évolution possible (plus tard) :** basculer la seule source boats.com en automatique complet (fiable à 100 % sur l'échantillon), le reste restant en validation humaine — modèle « hybride ».

---

## 6. L'écran « Leads entrants à valider » (esquisse)

Une nouvelle page du CRM, pensée pour une validation en quelques secondes par lead :

- **Une liste de cartes**, une par email entrant, triées par score (prospects probables en haut).
- **Chaque carte montre** : source, nom, coordonnées extraites, bateau concerné, extrait du message, et un indicateur de score.
- **Deux actions** : « Accepter » (avec un sélecteur de commercial — ou « non attribué ») et « Rejeter ».
- **Champs éditables avant acceptation** : on peut corriger un téléphone mal extrait, compléter un nom, avant que le lead entre en base.

**Prototype possible dès aujourd'hui :** *avant* de brancher la vraie collecte. C'est une démo utile pour la décision (§7).

---

## 7. Ce qu'il reste à débloquer (le vrai sujet)

Toute l'analyse ci-dessus est faisable et prête. Mais l'import ***réel*** — qui va chercher les emails tout seul — a besoin de deux briques qui n'existent pas encore côté Ocean Boat :

**a) L'accès à la boîte email — Microsoft 365.**

- Sans accès à la boîte qui reçoit les prospects, aucun système ne peut lire les emails à importer. C'est le prérequis n°1.

**b) Un socle qui tourne en continu — backend.**

- Le CRM actuel est une application front-end (données locales au poste) : elle ne s'exécute que quand quelqu'un l'ouvre, et n'a aucun accès mail. La collecte/extraction doit tourner côté serveur (backend, fonction planifiée, ou scénario d'automatisation).

**Recommandation de séquence :** (1) valider l'ergonomie de l'écran de validation via une maquette (§6) ; (2) présenter cette maquette + le présent document à la direction pour décider du backend et obtenir l'accès Microsoft 365 ; (3) construire l'extraction réelle une fois ces deux briques disponibles.

> ***En un mot : la préparation (comprendre quoi extraire, comment trier, comment valider) est faite. La prochaine étape décisive n'est pas du code — c'est la décision « backend + accès boîte mail » avec Ocean Boat.***

---

*SAPulse — RGPD-by-design. Rappel : traiter des emails de prospects implique des données personnelles ; l'accès à la boîte, la durée de conservation et l'information des personnes devront être cadrés (registre / mention d'information) au moment de la mise en œuvre.*
