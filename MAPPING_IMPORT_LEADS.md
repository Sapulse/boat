# Mapping d'import — Fichier de suivi des leads → CRM Ocean Boat

**Source :** `FICHIER_SUIVIT_DES_LEADS_.csv` / `.xlsm` (même structure)
**Séparateur CSV :** `;` — encodage UTF-8 avec BOM
**Volume :** 294 leads réels (les lignes/colonnes vides au-delà sont du bruit Excel à ignorer)
**Cible :** table `leads` (+ rattachement `commercials`) de la base Turso

> Ce document est le **plan de l'import**. Il fige les décisions métier validées par Mickaël.
> Il ne code rien — il dit à quoi doit ressembler l'import. Les points marqués ⚠️ demandent
> une vérification au caractère près contre les valeurs autorisées du CRM (validation zod) au
> moment de coder.

---

## 1. Décisions métier validées (à respecter absolument)

- **Commerciaux retenus :** Tom, Fred, Océane, Nicolas. Toutes les variantes de casse du fichier
  sont fusionnées vers ces 4 (voir §4).
- **Camaret (11 leads) et cmys (1 lead) :** NE SONT PAS des commerciaux → leads importés en
  **"non attribué"**, en conservant la mention `Camaret` / `cmys` dans le champ Commentaires
  (préfixe, voir §4).
- **⚠️ Le commercial est OBLIGATOIRE côté CRM (clé étrangère lead→commercial, testé et confirmé).**
  Un lead ne peut PAS être créé sans commercial. Décision (Option A) : créer un commercial spécial
  **"Non attribué"** (une vraie entrée dans `commercials`) auquel sont rattachés TOUS les leads
  orphelins (Camaret, cmys, et les 5 commerciaux vides). Il servira de "boîte" de leads à
  réassigner à la main ensuite. À exclure éventuellement des stats de performance par commercial
  (à voir). PAS de modif du schéma (le champ reste obligatoire).
- **Doublons (7 emails récurrents) :** on importe TOUT tel quel (pas de dédoublonnage). Nettoyage
  manuel dans le CRM ensuite.
- **Colonnes vides du fichier** (Conclusion, % Réalisation, Bateau actuel, Date de livraison =
  0 valeur ; Montant devis = 1 valeur) : ignorées ou mappées mais arriveront vides.

---

## 2. Structure source — 25 colonnes réelles

| # | Colonne Excel | Remplissage | Destination |
|---|---------------|-------------|-------------|
| 0 | Date de création | 293/294 | `createdAt` (date métier) |
| 1 | Source | 294/294 | `source` |
| 2 | Commercial | 289/294 | rattachement commercial (voir §4) |
| 3 | Nom | ~294 | `lastName` (ou `name`) |
| 4 | Prénom | ~294 | `firstName` |
| 5 | Téléphone | 220/294 | `phone` (nettoyage, voir §5) |
| 6 | Email | 289/294 | `email` |
| 7 | Type de bateau | 292/294 | `boatType` (voir §4) |
| 8 | Etat | 280/294 | catégorie état (voir §4) |
| 9 | Intérêt bateau | élevé | `boatInterest` (modèle recherché) |
| 10 | Marque | élevé | `boatBrand` |
| 11 | Budget (€) | élevé | `budget` (→ nombre, voir §5) |
| 12 | En conclusion | 293/294 | `status` (statut du lead, voir §4) |
| 13 | Date de contact | 174/294 | date de contact / 1re action |
| 14 | Relance 1 | 70/294 | action de relance (voir §6) |
| 15 | Relance 2 | 16/294 | action de relance |
| 16 | Négociation/Devis | 49/294 | action / étape |
| 17 | Relance 3 | 2/294 | action de relance |
| 18 | Conclusion | 0 | — (vide, ignorer) |
| 19 | Signé/Perdu | 18/294 | date de clôture si applicable |
| 20 | Montant devis (€) | 1/294 | `quoteAmount` (→ nombre) |
| 21 | % Réalisation | 0 | — (vide, ignorer) |
| 22 | Bateau actuel | 0 | — (vide, ignorer) |
| 23 | Commentaires | 211/294 | `comments` / note |
| 24 | Date de livraison | 0 | — (vide, ignorer) |

> ⚠️ Les noms de champs cible ci-dessus sont indicatifs — **à aligner sur les vrais noms du
> schéma Prisma / du type Lead du CRM** au moment de coder (César a le schéma exact).

---

## 3. Ordre d'import (dépendances)

1. **Commerciaux d'abord** : s'assurer que Tom, Fred, Océane, Nicolas existent en base (table
   `commercials`) avec des ids stables AVANT d'importer les leads (clé étrangère lead→commercial).
2. **Leads ensuite**, chacun rattaché au bon commercial (ou "non attribué").
3. (Actions de relance : voir §6 — décision à prendre.)

---

## 4. Tables de correspondance (normalisation)

### 4.1 Commercial (col 2) — fusion de casse

| Valeurs source | → Commercial CRM |
|----------------|------------------|
| `tom`, `Tom`, `TOM` (174) | **Tom** |
| `FRED`, `fred`, `Fred` (62) | **Fred** |
| `oceane`, `Océane`, `OCEANE`, `océane`, `Oceane` (31) | **Océane** |
| `Nicolas`, `NICOLAS`, `nicolas` (10) | **Nicolas** |
| `Camaret`, `camaret` (11), `cmys` (1) | **commercial "Non attribué"** + préfixe commentaire `[Camaret]` ou `[cmys]` |
| vide (5) | **commercial "Non attribué"** |

Normalisation recommandée : passer la valeur source en minuscules + trim, puis matcher.

> **Prérequis import :** créer 5 commerciaux avant les leads → **Tom, Fred, Océane, Nicolas,
> Non attribué**. Les leads orphelins pointent vers "Non attribué" (le commercial est obligatoire).

### 4.2 Type de bateau (col 7) — fusion de casse

| Valeurs source | → CRM |
|----------------|-------|
| `moteur`, `Moteur`, `MOTEUR`, `moter` (faute) | **Moteur** |
| `voile`, `Voile`, `VOILE` | **Voile** |
| `Semi-rigide`, `semi-rigide` | **Semi-rigide** |

### 4.3 État / catégorie (col 8) — codes métier

| Valeurs source | Signification | → CRM |
|----------------|---------------|-------|
| `dv`, `DV` (193) | Dépôt-vente | **Dépôt-vente** |
| `BO`, `bo` (13) | Bateau d'occasion | **Occasion** |
| `occasion`, `OCASSION` (10) | occasion | **Occasion** |
| `Neuf`, `neuf`, `NEUF` (62) | neuf | **Neuf** |
| `BN` (1) | Bateau neuf | **Neuf** |
| `neuf ou occasion` (1) | ambigu | à trancher (défaut : **Neuf** ou commentaire) |
| *(catégorie **Location**)* | — | valeur CRM prévue, **aucun lead source ne l'utilise** |

> ⚠️ Vérifier que le champ « état/catégorie » du CRM accepte bien ces 4 valeurs (Dépôt-vente,
> Occasion, Neuf, Location) côté validation zod. Sinon les caler sur les valeurs exactes autorisées.

### 4.4 Statut « En conclusion » (col 12) → statut CRM

Mickaël confirme : **ce sont exactement les statuts du CRM.** Mapping = identité (normaliser la casse au besoin).

| Valeur source | → statut CRM |
|---------------|--------------|
| `Perdu` (151), `Contacté` (71), `Reporté` (33), `Nouveau` (19), `En cours` (9), `Client relancé` (6), `Signé` (3), `Négociation` (1) | **identique** |

> ⚠️ Vérification au caractère près contre les valeurs zod (accents, majuscules) au moment de coder.
> Une seule divergence et l'API refuserait la ligne.

---

## 5. Transformations de format

- **Dates** (col 0, 13, 14, 15, 16, 17, 19) : format source `JJ/MM/AAAA` → convertir vers le
  format date interne du CRM (ISO `AAAA-MM-JJ` string, cf. dates métier en String). **Anomalie
  connue :** une valeur `10:06:26` en col 0 → à traiter en exception (ignorer / date par défaut).
- **Budget** (col 11) : `64 900 €` → nombre `64900`. Retirer espaces, `€`, séparateurs de milliers.
- **Montant devis** (col 20) : `34 000,00 €` → `34000` (gérer la virgule décimale). 1 seule valeur.
- **Téléphone** (col 5) : ⚠️ **données sales** — formats hétérogènes (`06 07 76 04 08`,
  `336 98 33 46 45`, `+31630954825`, `66177 88 36 61 80`, indicatifs collés...). Recommandation :
  importer la valeur **nettoyée a minima** (trim, espaces multiples réduits) SANS chercher à
  reformater agressivement (risque de corrompre des numéros valides). Ne jamais bloquer un lead
  sur un téléphone mal formé — le garder tel quel vaut mieux que le perdre.

---

## 6. Décision restante — les colonnes de « suivi » (relances)

Les colonnes Date de contact / Relance 1-2-3 / Négociation-Devis contiennent des **dates
d'actions passées**. Deux façons de les traiter, **à trancher avec Mickaël** :

- **Option simple :** ne pas les importer comme actions ; juste garder la date de contact et
  éventuellement résumer les relances dans le champ Commentaires. Import plus léger.
- **Option riche :** générer de vraies **actions/relances** dans l'historique du lead (une action
  par date de relance remplie). Plus fidèle, mais plus de travail et suppose de mapper vers le
  modèle d'actions du CRM.

**Recommandation :** commencer **simple** (identité + bateau + budget + statut + date de contact +
commentaires) pour un premier import fiable, et enrichir avec les relances dans un second temps
si besoin.

---

## 7. Champ Commentaires (col 23) — cas particuliers à préserver

- Contenu libre (211/294 remplis) → `comments`.
- Pour les leads Camaret/cmys : **préfixer** le commentaire par `[Camaret]` / `[cmys]` pour ne
  pas perdre l'info d'origine (puisqu'ils passent en « non attribué »).

---

## 8. Points de vigilance transverses

- **RGPD :** le fichier contient des données personnelles réelles → ne JAMAIS le committer dans
  le repo git ; le traiter en local, le supprimer après import.
- **Idempotence / réimport :** cet import est pensé pour le **peuplement initial** (base vierge).
  Un futur import récurrent devra gérer les doublons (clé de dédoublonnage : email ? email+bateau ?)
  — hors périmètre de ce premier import.
- **Test à blanc obligatoire :** exécuter l'import d'abord sur une **base de test** (pas la base
  Turso de prod), vérifier les 294 leads, les rattachements commerciaux, les statuts, AVANT tout
  import réel.
- **Validation zod :** chaque ligne passera par la validation de l'API → toute valeur non conforme
  (statut, état, type) sera refusée. D'où l'importance des tables de correspondance §4.
