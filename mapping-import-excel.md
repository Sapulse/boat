# Mapping d'import Excel → CRM Brest Ocean Boat

Spec de conception pour l'import de la base Excel existante d'Ocean Boat vers l'app.
À fournir à Claude Code au moment de coder l'import (après la mise en place du backend).

> ⚠️ Séquencement : l'import doit se faire **dans la base partagée (backend)**, pas
> dans la version localStorage actuelle. Importer dans localStorage = base dans un seul
> navigateur, à refaire ensuite. Donc : backend d'abord, puis import.

---

## 1. Mapping des colonnes → champs du Lead

Correspondance directe entre colonnes Excel et champs du modèle `Lead` de l'app.

| Colonne Excel | → Champ app | Transformation |
|---|---|---|
| Date de création | `createdAt` | parser la date (format FR jj/mm/aaaa) → ISO |
| Source | `source` | mapper vers les valeurs SOURCES de l'app (à aligner — voir §4) |
| Commercial | `commercialId` | **normaliser la casse** (TOM/tom → un seul), relier à un commercial existant dans l'app (voir §4) |
| Nom | `lastName` | direct |
| Prénom | `firstName` | direct |
| Téléphone | `phone` | direct (garder le format tel quel) |
| Email | `email` | trim + minuscule |
| Type de bateau | `boatType` | mapper vers BOAT_TYPES (Moteur/Voile/Semi-rigide) — vérifier les libellés |
| État | `boatCondition` | mapper vers BOAT_CONDITIONS (Neuf/DV/BO — vérifier) |
| Intérêt bateau | `boatInterest` | direct (texte libre, ex. "Sun Odyssey 410") |
| Marque | `boatBrand` | direct |
| Budget (€) | `budget` | parser le nombre (retirer espaces, €, séparateurs milliers) |
| Statut | `status` | mapper vers les 10 statuts (voir §2) |
| Montant devis (€) | `quoteAmount` | parser le nombre |
| Commentaires | → **action 'note'** | voir §3 (devient une action, pas un champ) |

### Champs IGNORÉS à l'import (décision validée)
- `% Réalisation` — ignoré
- `Bateau actuel` — ignoré

---

## 2. Mapping des statuts

9 valeurs Excel → 10 statuts app. (`a_contacter` n'a pas de source Excel, restera inutilisé après import.)

| Statut Excel | → Statut app | Note |
|---|---|---|
| Nouveau | `nouveau` | direct |
| Contacté | `contacte` | direct |
| Client relancé | `contacte` | pas de statut "relancé" dans l'app ; le lead reste "contacté", la relance est tracée via les colonnes Relance 1/2/3 (§3) |
| En cours | `qualifie` | "en cours" = lead travaillé, avant négo formelle (l'app a "Négociation" distinct) |
| Négociation | `negociation` | direct |
| En conclusion | `en_conclusion` | direct |
| Signé | `signe` | direct |
| Reporté | `reporte` | direct |
| Perdu | `perdu` | direct |

> Note technique : le mapping de statut doit **aussi** alimenter les dates de jalon via
> le helper existant `statusMilestoneDates` (signedAt/lostAt/reportedAt/contactDate),
> OU on laisse le statut importé tel quel et les dates de jalon viennent des colonnes
> dédiées (Date de contact, etc. — §3). À arbitrer au moment du code pour éviter les
> incohérences entre statut importé et dates.

---

## 3. Colonnes-dates → actions horodatées dans l'historique

Décision validée : les colonnes contenant des dates deviennent des **actions** dans
l'historique du lead. Chaque cellule remplie = une action datée. Cellule vide = pas d'action.

| Colonne Excel | → Action | Type d'action | Date de l'action | Libellé |
|---|---|---|---|---|
| Date de contact | action | `contact` | la date de la cellule | "Premier contact" |
| Relance 1 | action | `relance` | la date de la cellule | "Relance 1" |
| Relance 2 | action | `relance` | la date de la cellule | "Relance 2" |
| Relance 3 | action | `relance` | la date de la cellule | "Relance 3" |
| Négociation/Devis | action | `note` | la date de la cellule | "Négociation / Devis" |
| Conclusion | action | `note` | la date de la cellule | "Conclusion" |

> Ces colonnes ne contiennent QUE des dates (confirmé). Le type d'action est une simple
> étiquette ; le libellé porte le sens.

### Colonne Commentaires → action 'note' non datée

- Le contenu de **Commentaires** (souvent des corps/résumés de mails, parfois des notes
  internes) → une **action de type `note`**.
- **Type** : `note` (neutre, ne présuppose pas que c'est un mail).
- **Date** : pas de date réelle disponible → utiliser la **date de création du lead**
  comme date technique (une action doit avoir une date pour se ranger dans le fil), sans
  prétendre que c'est la date réelle du commentaire.
- Contenu : le texte intégral de la cellule, préservé tel quel.

---

## 4. Points à vérifier / aligner AVANT de coder l'import

Ces points nécessitent soit une vérification dans l'Excel réel, soit une décision :

1. **Liste des commerciaux** : récupérer toutes les valeurs distinctes de la colonne
   Commercial (TOM, FRED, NICOLAS, nicolas, tom…), normaliser la casse, et s'assurer que
   chaque commercial existe dans la table Équipe de l'app AVANT l'import (sinon le
   `commercialId` ne pourra pas être relié). Créer les commerciaux manquants d'abord.

2. **Valeurs de Source** : lister les valeurs distinctes de la colonne Source de l'Excel
   (Annonces du bateau, LBC, Yachtworld, Band of Boats, Site BOB, BoatsGroup…) et les
   aligner avec les SOURCES de l'app. Ajouter les sources manquantes à l'app, ou mapper.

3. **Type de bateau / État** : vérifier que les libellés Excel (MOTEUR, voile / DV, NEUF,
   neuf, BO…) correspondent aux BOAT_TYPES et BOAT_CONDITIONS de l'app. Normaliser la
   casse. Mapper "DV", "BO" vers les bonnes valeurs (DV = ? / BO = ? — à confirmer avec
   Ocean Boat : occasion ? bateau d'occasion ?).

4. **Format des dates** : confirmer le format des dates dans l'Excel (jj/mm/aaaa ?) pour
   un parsing fiable.

5. **Format du fichier** : l'import se fera depuis un export **.csv** ou **.xlsx** ? Si
   xlsx, il faut une lib de lecture (SheetJS/xlsx) ; si csv, parsing texte (plus léger).
   À décider.

6. **Lignes colorées** : le surlignage Excel (rouge/vert/orange/bleu) porte peut-être un
   sens métier — confirmer qu'il est redondant avec une colonne (le statut, sans doute) et
   ne porte pas d'info unique. Le formatage ne s'importe pas.

7. **Cohérence statut ↔ dates** : voir note §2 — décider si les dates de jalon viennent
   du statut importé (via helper) ou des colonnes-dates dédiées, pour éviter les doublons
   ou incohérences.

---

## 5. Récap du flux d'import (proposition)

1. Lire le fichier (csv ou xlsx).
2. Pour chaque ligne :
   - construire le Lead (champs §1 + statut §2).
   - générer les actions à partir des colonnes-dates (§3) + l'action note du commentaire.
   - relier le commercial (§4.1).
3. Détection de doublons (réutiliser la logique vCard `splitNewVsDuplicates` : email/tél
   normalisés) — proposer un récap avant création.
4. Création en base (backend).
5. Récap final : X leads importés, Y actions créées, Z doublons traités.

> La logique de parsing + mapping doit être un **helper pur testable au harnais**
> (comme email.ts / vcard.ts), avec des cas de test sur le mapping statuts, le parsing
> dates/montants, et la génération d'actions.
