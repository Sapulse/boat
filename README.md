# CRM Brest Ocean Boat - Outil de Pilotage Commercial

> **Deploiement : lire [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) avant toute mise en prod.**
> Tant que la migration Turso du lot 2 n'est pas faite, **ne jamais deployer `main`** : correctif urgent = branche `hotfix/...` depuis le dernier tag `prod-*`.

Application web de suivi commercial pour le secteur nautique.

## Fonctionnalites

- **Dashboard** : KPIs, urgences, performance commerciaux, repartition pipeline
- **Leads** : Liste complete avec recherche, filtres, tri, alertes visuelles
- **Fiche Lead** : Informations client, projet bateau, suivi commercial, historique actions
- **Pipeline** : Vue kanban avec glisser-deposer pour faire evoluer les leads
- **Dashboard Analytique** : Graphiques filtrables par commercial, type, etat, statut
- **Stats du mois** : Saisie manuelle budget/leads par source, calcul CPL
- **Historique acquisition** : Volumes mensuels par plateforme

## Stack technique

- React 19 + TypeScript
- Vite 8
- Tailwind CSS 4
- Recharts (graphiques)
- @dnd-kit (drag and drop)
- date-fns
- localStorage (persistance)

## Demarrage

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
