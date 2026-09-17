# Lots CRM Ocean Boat — décisions validées

## Méthode commune
- Diagnostic + plan, validation, puis code. Commit local par sous-étape, push en fin de lot,
  STOP avec bilan + captures (ordinateur + 375 px). Aucun déploiement.
- Migrations additives écrites à la main, script au verrou prod, ajouté à DEPLOIEMENT.md et à
  migrations-guard. Anciennes sauvegardes restaurables.
- Aucune dépendance nouvelle à Vercel (migration VPS OVH prévue).
- Compte unique partagé.

## Lot 2 — Prochaine action obligatoire + Agenda : TERMINÉ (voir historique git)

## Lot 3 — Ergonomie : TERMINÉ (8cb7738, fe4fa9c, eedae0f)
- Alias « leboncoin » → « LBC » conservé dans la normalisation.
- BoatsGroup reste une source séparée (en attente de confirmation client).
- Plus tard : aligner les noms des stats mensuelles (Le Bon Coin, Site web BOB, Annonce du bateau,
  Boats Wizard) sur ceux des leads.

## Lot 4 — Dashboard + Objectifs de la semaine
### Dashboard (/dashboard)
- 3 indicateurs en haut, une seule source de calcul :
  a) À faire aujourd'hui : actions programmées « à faire » du jour. Total : une action compte UNE
     fois. Par commercial : responsable OU participant (action Tom + Fred = 1 chez Tom, 1 chez Fred,
     1 dans le total, mention sous le chiffre). Inclut les leads Signés / Perdus. Action dont la
     seule personne est « Non attribué » : dans le total, chez personne.
  b) En retard : exactement countOverdue (même calcul que la pastille du menu).
  c) À planifier : exactement needsPlanning (même que le filtre Leads), avec « dont N sans
     commercial » en vue Tous.
- Clics : a) Agenda vue Journée, aujourd'hui, filtré commercial ; b) Agenda avec bandeau repliable
  « N actions en retard » (liste filtrée, chaque ligne ouvre Fait / Pas fait / Reporter) — la
  pastille du menu mène aussi à ce bandeau ; c) #/leads?view=a-planifier&commercial=…
- L'Agenda lit ?vue= ?date= ?commercial= ?retards=1.
- UN SEUL sélecteur commercial en haut, qui pilote aussi les widgets du bas.
- Widgets existants : « Leads urgents » et « Devis sans relance » visibles sous les indicateurs ;
  6 cartes, « Leads chauds sans action », « Sans prochaine action », graphiques statut / commercial,
  graphique sources + détail par commercial → repliés dans « Plus d'indicateurs » (graphiques
  chargés à l'ouverture). Filtres période et source dans « Plus d'indicateurs ».
- Mobile : 3 indicateurs empilés, pleine largeur.
- Harnais sur les 3 calculs (dont le cas action à plusieurs et Non attribué).

### Page « Objectifs de la semaine » (entrée de menu dédiée, distincte des Objectifs commerciaux)
- Objectifs COMMUNS à l'équipe, semaine lundi → dimanche, 5 actifs max (client + serveur).
- Table weekly_objectives : id, weekStart, position, text (200 max), done, doneAt, active,
  copiedFromId, modifiedAfterWeekAt, ownerId (porteur FACULTATIF, un commercial hors Non attribué,
  affiché en petit), createdAt, updatedAt.
- Semaine courante en haut + compteur « N/M faits » ; semaine suivante préparable ; historique.
- « Reprendre la semaine suivante » : copie l'objectif (copiedFromId). Pas de report automatique.
- Modifier après la fin de semaine : autorisé, tracé (modifiedAfterWeekAt, « modifié le … »).
- Jamais de suppression : désactivation. PUT /api/weekly-objectives/:id, pas de DELETE.
- Sauvegarde / restauration incluses (ancienne sauvegarde → liste vide).
- Script apply-weekly-objectives-turso.ts. Mobile : cartes, cases 44 px.

## Lot 5 — Réseaux sociaux dans Acquisition : À FAIRE
- 3e onglet « Réseaux sociaux » dans Acquisition (à côté de Saisie et Dashboard).
- MonthlyStat NON réutilisé (fausserait totaux, CPL, exports) ; réutiliser le MÉCANISME : navigation
  mois par mois, garde « modifications non enregistrées », enregistrement groupé, synchro, sauvegarde.
- Table social_networks : id, name, position, archived, dates. Script crée Facebook, Instagram,
  LinkedIn avec identifiants fixes (INSERT OR IGNORE, rejouable).
- Table social_stats : id, networkId, year, month, followers (obligatoire), posts, reach,
  comment (facultatifs), dates ; unique réseau + mois ; pas de suppression, un mois se corrige.
- Routes PUT /api/social-networks et PUT /api/social-stats (upsert, sans suppression).
- Interface : saisie du mois (une carte par réseau actif) ; tableau mois par mois avec abonnés,
  variation +/− (vert / rouge), icône 💬 qui déplie le commentaire ; cartes par mois sur mobile ;
  courbe des abonnés par réseau (recharts chargé à la demande) ; gestion des réseaux : ajouter,
  renommer, archiver (archivé = visible dans l'historique, absent de la saisie).
- Restauration d'une ancienne sauvegarde : 3 réseaux par défaut, aucune stat.
- Script apply-social-turso.ts.

## Fin de lot 5 — obligatoire avant la mise en prod
- Répétition complète sur une copie locale d'une sauvegarde prod fraîche : TOUS les scripts
  enchaînés dans l'ordre de DEPLOIEMENT.md, preuve de chaque étape, rejeu complet sans effet,
  app chargée (Agenda, Leads, fiche, Dashboard, Modèles, Objectifs de la semaine, Acquisition),
  durée mesurée, copie supprimée.
- Mettre à jour TODO.md et CHANGELOG.md (lots 2 à 5).

## Mise en production
- Suivre docs/DEPLOIEMENT.md. Recompter les chiffres « Le premier jour » juste avant d'envoyer
  la fiche équipe. Retour arrière uniquement dans l'heure ; jamais le bouton Restaurer de
  prod-2026-09-16.
- Le soir de la mise en prod (ou de la bascule VPS) : rotation du token Turso.
