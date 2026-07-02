# Chantier migration — Étape 0 : cartographie du modèle de données

> Document **read-only** produit avant tout code. Décrit fidèlement le modèle
> actuel (localStorage) pour préparer la transposition en base relationnelle
> (Turso / libSQL + Prisma, comme SAForm). Aucune décision ici — voir
> [`01-decisions.md`](./01-decisions.md).

**Périmètre lu :** `src/data/types.ts`, `src/context/appReducer.ts`,
`src/lib/storage.ts`, `src/lib/utils.ts` (génération d'id), `src/lib/acquisition.ts`,
`src/lib/goals.ts`, `src/data/constants.ts`, `src/pages/ObjectifsPage.tsx`.

**Modèle de persistance actuel :** un objet unique `AppState` sérialisé en JSON
dans `localStorage`, clé **`crm-nautisme-data`** (`storage.ts:4`), lu/écrit
intégralement (`loadState`/`saveState`, `storage.ts:6-20`). Pas de granularité par
entité : chaque action du reducer reconstruit tout le state, puis le state entier
est réécrit.

---

## 1. Inventaire des entités (`src/data/types.ts`)

### Énumérations (valeurs figées → contraintes `CHECK` ou `String`)

| Type | Valeurs | Réf |
|---|---|---|
| `LeadStatus` | nouveau, a_contacter, contacte, qualifie, devis_envoye, negociation, en_conclusion, signe, perdu, reporte (10) | `types.ts:1-11` |
| `BoatType` | Moteur, Voile, Semi-rigide (3) | `:13` |
| `BoatCondition` | Neuf, BO, DV (3) | `:14` |
| `Temperature` | froid, tiede, chaud (3) | `:15` |
| `Priority` | basse, normale, haute, critique (4) | `:16` |
| `ActionType` | appel, email, sms, whatsapp, rdv, visite, devis, relance, negociation, conclusion, note, autre (12) | `:19-31` |
| `TemplateType` | email, sms, whatsapp (3) | `:44` |
| `CalendarEventCategory` | reunion, conge, deplacement, perso, autre (5) | `:127` |
| `AlertLevel` | none, orange, red — **dérivé à la volée** (`getAlertLevel`), jamais stocké | `:17` |

### Entités-collections (→ tables)

**`Commercial`** (`:33-42`) — pivot référentiel de l'app

| champ | type | null/opt | note |
|---|---|---|---|
| id | string | PK | **id sémantique** (`'fred'`, `'tom'`…), pas UUID (`constants.ts:157-163`) |
| name | string | — | |
| active | boolean | — | |
| createdAt | string | optionnel | absent avant Lot 2 |
| email | string | optionnel | fallback `''` |
| signature | string | optionnel | fallback `''` |

**`MessageTemplate`** (`:52-58`)

| champ | type | note |
|---|---|---|
| id | string (PK) | UUID **ou** id sémantique legacy (`'contact'`,`'relance'`,`'suivi'`) |
| type | `TemplateType` | figé à la création |
| title | string | |
| subject | string | `''` pour sms/whatsapp |
| body | string | |

**`Lead`** (`:73-113`) — entité centrale

- Identité/méta : `id` (PK), `createdAt`, `source`, `commercialId` (**FK→Commercial**).
- Contact : `firstName`, `lastName`, `phone`, `email`.
- Bateau : `boatType` (`BoatType | ''`), `boatCondition` (`BoatCondition | ''`), `boatInterest`, `brand`, `currentBoat`.
- Commercial/pipeline : `budget number|null`, `status LeadStatus`, `quoteAmount number|null`, `probability number|null`, `temperature`, `priority`, `comments`, `deliveryDate`.
- Prochaine action (dénormalisée sur le lead) : `nextActionType (ActionType|'')`, `nextActionDate string`, `nextActionTime? "HH:mm"`, `nextActionEndTime? "HH:mm"`.
- Jalons/dates : `contactDate`, `lastActionDate`, `signedAt`, `lostAt`, `reportedAt`, `lossReason`.
- ⚠️ Beaucoup de champs string utilisent `''` comme sentinelle « vide » (pas `null`) ; trois champs numériques utilisent `null` (`budget`, `quoteAmount`, `probability`).

**`LeadAction`** (`:60-71`) — historique

| champ | type | note |
|---|---|---|
| id | string (PK) | |
| leadId | string | **FK→Lead** |
| type | `ActionType` | |
| date | string (YYYY-MM-DD) | |
| result | string | |
| notes | string | |
| authorId | string | **FK→Commercial** (confirmé : `goals.ts:42` `a.authorId === commercialId`) |
| newStatus | `LeadStatus`? | optionnel |
| nextActionType | `ActionType`? | optionnel |
| nextActionDate | string? | optionnel |

**`MonthlyStat`** (`:118-125`) — acquisition

| champ | type | note |
|---|---|---|
| id | string (PK) | |
| year | number (int) | **clé naturelle (year, month, source)** |
| month | number (int) | |
| source | string | |
| budget | number\|null | |
| leads | number\|null | |

`cpl` **non stocké**, dérivé (`computeCpl`, `acquisition.ts:16-20`).

**`CalendarEvent`** (`:136-145`) — agenda libre (non lié à un lead)

| champ | type | note |
|---|---|---|
| id | string (PK) | |
| title | string | |
| date | string (YYYY-MM-DD) | |
| time | string? | absent = toute la journée |
| endTime | string? | donne une durée |
| commercialId | string? | **FK→Commercial, nullable** (absent = événement « équipe ») |
| category | `CalendarEventCategory`? | |
| note | string? | |

**`CommercialGoal`** (`:160-174`) — objectifs mensuels

| champ | type | note |
|---|---|---|
| id | string (PK) | `generateId()` (`ObjectifsPage.tsx:24`) |
| commercialId | string | **FK→Commercial** |
| year | number (int) | **clé naturelle (commercialId, year, month)** (`ObjectifsPage.tsx:62,83`) |
| month | number (int) | 1..12 |
| prospectsCreated, coldCalls, followups, meetings, revenue, conversionRate | `GoalMetric` ×6 | objets embarqués |

### Value object (pas d'entité propre)

**`GoalMetric`** (`:155-158`) — `{ target: number|null, override: number|null }`.
Embarqué 6× dans `CommercialGoal`. Pas d'`id`. `override` null = réalisé calculé
auto (jamais persisté).

### Valeur de config unique (PAS une collection)

**`DefaultGoal`** (`:182-189`) — 6 champs `number|null` (mêmes indicateurs que
`CommercialGoal`). Dans `AppState` c'est **une seule valeur**
(`defaultGoal: DefaultGoal`, `:207`), pas un tableau. Seul « singleton » du modèle.

---

## 2. Relations et clés étrangères naturelles

```
Commercial (1) ──< Lead             (Lead.commercialId)
Commercial (1) ──< LeadAction       (LeadAction.authorId)
Commercial (1) ──< CommercialGoal   (CommercialGoal.commercialId)
Commercial (0..1) ──< CalendarEvent (CalendarEvent.commercialId, NULLABLE)
Lead       (1) ──< LeadAction       (LeadAction.leadId)
```

- **`Commercial` est le référentiel pivot** : référencé par 4 entités.
- **Cascade existante** : `DELETE_LEAD` supprime aussi les actions du lead
  (`appReducer.ts:179-184`) → **`ON DELETE CASCADE`** naturel sur `LeadAction.leadId`.
- `MonthlyStat`, `MessageTemplate`, `DefaultGoal` : **aucune FK** (`MonthlyStat.source`
  est une string libre, pas une FK vers une table sources).
- Clés naturelles composites (candidates à `UNIQUE`) :
  `MonthlyStat(year, month, source)`, `CommercialGoal(commercialId, year, month)`.
- Relations **implicites non contraintes aujourd'hui** : `nextActionType`/`newStatus`
  sont des enums, pas des FK. `Lead.source` et `MonthlyStat.source` sont des strings
  libres (pas de table `Source`).

---

## 3. Identifiants

- **Génération actuelle :** `generateId()` = `crypto.randomUUID()` (`utils.ts:11-12`)
  → UUID v4 en string.
- **Exceptions — ids sémantiques legacy** (chaînes courtes stables, PAS des UUID) :
  - `Commercial` : `'fred'`, `'tom'`, `'nicolas'`, `'oceane'`, `'camaret'` (`constants.ts:157-163`).
  - `MessageTemplate` par défaut : `'contact'`, `'relance'`, `'suivi'` (`constants.ts:246+`).
- **Conséquence migration :** les PK doivent rester des `TEXT` (accepter UUID **et**
  ids sémantiques existants). Ne pas basculer en `INTEGER AUTOINCREMENT` sous peine de
  casser les données existantes et les références en dur.

---

## 4. Structure de `AppState` : collections vs config

`AppState` (`types.ts:191-208`) = **7 collections + 1 singleton** :

| Champ AppState | Cardinalité | Devient |
|---|---|---|
| `leads[]` | collection | table `leads` |
| `actions[]` | collection | table `lead_actions` |
| `commercials[]` | collection | table `commercials` |
| `monthlyStats[]` | collection | table `monthly_stats` |
| `templates[]` | collection | table `message_templates` |
| `calendarEvents[]` | collection | table `calendar_events` |
| `goals[]` | collection | table `commercial_goals` |
| **`defaultGoal`** | **valeur unique** | **1 ligne de config** (table dédiée) |

Actions reducer qui **remplacent tout un tableau** (à retraduire en upsert/delete
côté DB) : `SAVE_MONTHLY_STATS` (`:260`), `SAVE_GOALS` (`:263`),
`SAVE_DEFAULT_GOAL` (`:266`). Les autres sont déjà des opérations unitaires
ADD/UPDATE/DELETE → mapping direct vers INSERT/UPDATE/DELETE.

---

## 5. Points sensibles pour la migration (hydratations défensives)

L'hydratation (`appReducer.ts:93-141`) documente les **formats legacy** que la base
cible devra pouvoir ingérer sans perte :

1. **Templates — double nom de champ + type manquant** (`hydrateTemplates`, `:43-51`) :
   ancien champ `emailTemplates` (avant v3.2) lu en repli de `templates` ; items sans
   `type` → `'email'` ; type inconnu → `'email'`.
2. **Objectifs — metric `calls` abandonné** (`hydrateGoals` + `StoredGoal`, `:53-91`) :
   anciens goals pouvaient porter `calls` (abandonné, **non reporté**) et ne pas
   porter `prospectsCreated`/`coldCalls` (→ défaut `{null,null}`).
3. **Acquisition — fusion `acquisitionVolumes` → `monthlyStats`** (`mergeAcquisition`,
   `acquisition.ts:75-98`, appelé `:112`) : ancien tableau séparé `acquisitionVolumes`
   (champ **retiré du modèle**) replié en `MonthlyStat{budget:null, leads:leadCount}`,
   **idempotent** (collision sur `(year,month,source)` → la stat existante prime).
4. **Migrations nulles `?? []` / `?? EMPTY_DEFAULT_GOAL`** (`:105-123`) :
   `calendarEvents`, `goals`, `defaultGoal` absents des vieux states → valeurs vides.
5. **Protection N1 anti-reseed** (`:95-99`) : un state existant, même à 0 lead, ne
   re-seed jamais. Sémantique applicative à préserver, mais sans objet en base.
6. **Garde-fou min-1 templates** (`DELETE_TEMPLATE`, `:299-308`) : on ne supprime
   jamais le dernier modèle. Règle **métier applicative**, à réimplémenter côté service.
7. **Sentinelles `''`** : de nombreux champs string « vides » valent `''` et non `null`.

---

## 6. Schéma relationnel cible (Turso / libSQL = SQLite)

> Notes SQLite/Prisma : pas d'`enum` natif → **`String` + validation applicative**
> (décision retenue). Booléens = `INTEGER 0/1`. Dates ISO conservées en **`TEXT`**
> (`YYYY-MM-DD` / `HH:mm`) pour **préserver à l'identique** les comparaisons de
> chaînes du code métier (`isInMonth`, `eventStatus`, tris) — **ne pas convertir**
> en `DATE`/`DATETIME`. Sentinelles `''` **conservées** (décision retenue).
> `created_at` / `updated_at` ajoutés **systématiquement** (décision retenue).

```
commercials
  id            TEXT PK              -- id sémantique OU uuid
  name          TEXT NOT NULL
  active        INTEGER NOT NULL DEFAULT 1
  email         TEXT                 -- nullable (candidate future colonne login/auth, étape 4)
  signature     TEXT                 -- nullable
  created_at    TEXT NOT NULL
  updated_at    TEXT NOT NULL

leads
  id                 TEXT PK
  created_at         TEXT NOT NULL
  updated_at         TEXT NOT NULL
  source             TEXT NOT NULL DEFAULT ''
  commercial_id      TEXT NOT NULL REFERENCES commercials(id)
  first_name         TEXT NOT NULL DEFAULT ''
  last_name          TEXT NOT NULL DEFAULT ''
  phone              TEXT NOT NULL DEFAULT ''
  email              TEXT NOT NULL DEFAULT ''
  boat_type          TEXT NOT NULL DEFAULT ''   -- 'Moteur'|'Voile'|'Semi-rigide'|''
  boat_condition     TEXT NOT NULL DEFAULT ''   -- 'Neuf'|'BO'|'DV'|''
  boat_interest      TEXT NOT NULL DEFAULT ''
  brand              TEXT NOT NULL DEFAULT ''
  budget             REAL                        -- nullable
  status             TEXT NOT NULL               -- LeadStatus
  contact_date       TEXT NOT NULL DEFAULT ''
  quote_amount       REAL                        -- nullable
  probability        REAL                        -- nullable
  current_boat       TEXT NOT NULL DEFAULT ''
  comments           TEXT NOT NULL DEFAULT ''
  delivery_date      TEXT NOT NULL DEFAULT ''
  temperature        TEXT NOT NULL               -- Temperature
  priority           TEXT NOT NULL               -- Priority
  next_action_type   TEXT NOT NULL DEFAULT ''    -- ActionType | ''
  next_action_date   TEXT NOT NULL DEFAULT ''
  next_action_time     TEXT                       -- nullable "HH:mm"
  next_action_end_time TEXT                       -- nullable "HH:mm"
  last_action_date   TEXT NOT NULL DEFAULT ''
  loss_reason        TEXT NOT NULL DEFAULT ''
  signed_at          TEXT NOT NULL DEFAULT ''
  lost_at            TEXT NOT NULL DEFAULT ''
  reported_at        TEXT NOT NULL DEFAULT ''
  INDEX (commercial_id), INDEX (status)

lead_actions
  id                TEXT PK
  created_at        TEXT NOT NULL
  updated_at        TEXT NOT NULL
  lead_id           TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE
  author_id         TEXT NOT NULL REFERENCES commercials(id)
  type              TEXT NOT NULL               -- ActionType
  date              TEXT NOT NULL
  result            TEXT NOT NULL DEFAULT ''
  notes             TEXT NOT NULL DEFAULT ''
  new_status        TEXT                        -- nullable, LeadStatus
  next_action_type  TEXT                        -- nullable
  next_action_date  TEXT                        -- nullable
  INDEX (lead_id), INDEX (author_id)

message_templates
  id         TEXT PK
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  type       TEXT NOT NULL               -- 'email'|'sms'|'whatsapp'
  title      TEXT NOT NULL
  subject    TEXT NOT NULL DEFAULT ''
  body       TEXT NOT NULL

monthly_stats
  id         TEXT PK
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
  year       INTEGER NOT NULL
  month      INTEGER NOT NULL
  source     TEXT NOT NULL
  budget     REAL                         -- nullable
  leads      INTEGER                      -- nullable
  UNIQUE (year, month, source)

calendar_events
  id            TEXT PK
  created_at    TEXT NOT NULL
  updated_at    TEXT NOT NULL
  title         TEXT NOT NULL
  date          TEXT NOT NULL
  time          TEXT                    -- nullable
  end_time      TEXT                    -- nullable
  commercial_id TEXT REFERENCES commercials(id)  -- nullable = équipe
  category      TEXT                    -- nullable, CalendarEventCategory
  note          TEXT                    -- nullable

commercial_goals
  id                         TEXT PK
  created_at                 TEXT NOT NULL
  updated_at                 TEXT NOT NULL
  commercial_id              TEXT NOT NULL REFERENCES commercials(id)
  year                       INTEGER NOT NULL
  month                      INTEGER NOT NULL   -- 1..12
  -- GoalMetric ×6 aplati en 2 colonnes chacun (target/override) :
  prospects_created_target   REAL
  prospects_created_override REAL
  cold_calls_target          REAL
  cold_calls_override        REAL
  followups_target           REAL
  followups_override         REAL
  meetings_target            REAL
  meetings_override          REAL
  revenue_target             REAL
  revenue_override           REAL
  conversion_rate_target     REAL
  conversion_rate_override   REAL
  UNIQUE (commercial_id, year, month)

default_goal   (table dédiée — 1 seule ligne)
  id                 INTEGER PK CHECK (id = 1)
  created_at         TEXT NOT NULL
  updated_at         TEXT NOT NULL
  prospects_created  REAL
  cold_calls         REAL
  followups          REAL
  meetings           REAL
  revenue            REAL
  conversion_rate    REAL
```

**Choix de conception intégrés (voir `01-decisions.md`) :**

- `GoalMetric` **aplati** en 12 colonnes sur `commercial_goals` (6 metrics fixes)
  plutôt qu'une table fille → pas de jointure, reflète l'objet actuel.
- `DefaultGoal` = **table dédiée à 1 ligne** (`id=1`).
- Dates gardées en `TEXT` ISO ; sentinelles `''` conservées ; enums en `String`.
