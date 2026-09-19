/**
 * LOT SALONS — harnais du RATTRAPAGE du statut de campagne
 * (scripts/rattrapage-statut-campagne-turso.ts).
 *
 * Exécution : npx tsx scripts/harness-rattrapage-statut.ts  (et `npm test`)
 *
 * Deux moitiés :
 *  1. le PLAN, module pur : qui est proposé, qui est écarté et pourquoi. C'est
 *     là que vit la règle sensible — ne rattraper QUE les leads travaillés
 *     APRÈS leur entrée dans la campagne ;
 *  2. l'ÉCRITURE, sur une base SQLite jetable (jamais Turso, le lanceur retire
 *     de toute façon les identifiants) : une seule transaction, les lignes déjà
 *     modifiées intactes, aucun lead touché, et le rejeu à zéro ligne.
 */
import { createClient } from '@libsql/client';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  msDepuis, planRattrapage, lireLignes, colonnesHorsStatut, appliquerRattrapage,
  prouverRattrapage, STATUT_PAR_DEFAUT, type LigneBrute,
} from './rattrapage-statut-campagne-turso';
import { fingerprint } from './apply-planned-actions-turso';
import { dbJetable, nettoyerDbJetables } from './lib/dbJetable';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const ENTREE = Date.parse('2026-09-18T10:00:00Z');   // le lead entre dans la campagne
const APRES = Date.parse('2026-09-19T09:00:00Z');    // … et il est travaillé le lendemain
const AVANT = Date.parse('2026-06-01T09:00:00Z');    // … ou il n'a pas bougé depuis juin

const ligne = (o: Partial<LigneBrute> = {}): LigneBrute => ({
  id: 'p1', leadId: 'l1', nom: 'Aurélien BILLECOQ', statutLead: 'contacte',
  statutCampagne: STATUT_PAR_DEFAUT, campagneNom: 'Grand Pavois 2026', campagneActive: true,
  leadUpdatedAt: APRES, participationCreatedAt: ENTREE, ...o,
});

// ---------------------------------------------------------------------------
section('Horodatages : les deux écritures possibles de la base');
// Prisma écrit un entier (ms) ; la migration écrite à la main écrit du texte via
// CURRENT_TIMESTAMP. Confondre les deux, ou lire le texte en heure locale,
// décalerait la comparaison de deux heures — et proposerait (ou écarterait) des
// lignes au hasard.
{
  check('entier (Prisma) lu tel quel', msDepuis(1758189600000) === 1758189600000);
  check('texte CURRENT_TIMESTAMP lu en UTC, pas en heure locale',
    msDepuis('2026-09-18 10:00:00') === Date.parse('2026-09-18T10:00:00Z'));
  check('texte ISO avec fuseau', msDepuis('2026-09-18T10:00:00Z') === Date.parse('2026-09-18T10:00:00Z'));
  check('entier passé en texte (certains pilotes)', msDepuis('1758189600000') === 1758189600000);
  check('date JS', msDepuis(new Date('2026-09-18T10:00:00Z')) === Date.parse('2026-09-18T10:00:00Z'));
  check('null / vide / illisible -> null (on n\'invente pas une date)',
    msDepuis(null) === null && msDepuis('') === null && msDepuis('jamais') === null && msDepuis(undefined) === null);
}

// ---------------------------------------------------------------------------
section('Plan : qui est rattrapé, qui ne l\'est pas');
{
  // LE CAS À RATTRAPER : la participation est restée à « À contacter » alors que
  // le lead a été passé « Contacté » APRÈS son entrée.
  const p = planRattrapage([ligne()]);
  check('lead travaillé après son entrée -> proposé',
    p.aCorriger.length === 1 && p.aCorriger[0].cible === 'Contacté sans retour');

  // LA RÈGLE SENSIBLE : un lead déjà « Contacté » AVANT son entrée n'est pas
  // rattrapé. C'est ce qui empêche d'afficher « Contactés : 132 » avant le
  // premier appel du salon.
  const ancien = planRattrapage([ligne({ leadUpdatedAt: AVANT })]);
  check('lead inchangé depuis son entrée -> ÉCARTÉ (frontière d\'entrée)',
    ancien.aCorriger.length === 0
    && ancien.ecartees.some(e => e.motif === 'lead inchangé depuis son entrée dans la campagne' && e.n === 1));
  check('égalité stricte : modifié à la seconde de l\'entrée -> écarté',
    planRattrapage([ligne({ leadUpdatedAt: ENTREE })]).aCorriger.length === 0);

  // Le mapping, vu depuis le script (il vient de src/lib/campagnes : une vérité).
  for (const [statutLead, cible] of [
    ['contacte', 'Contacté sans retour'],
    ['qualifie', 'Échange en cours'],
    ['devis_envoye', 'Échange en cours'],
    ['negociation', 'Échange en cours'],
    ['en_conclusion', 'Échange en cours'],
    ['reporte', 'Projet reporté'],
  ] as const) {
    check(`${statutLead} -> ${cible}`, planRattrapage([ligne({ statutLead })]).aCorriger[0]?.cible === cible);
  }
  for (const statutLead of ['signe', 'perdu', 'nouveau', 'a_contacter'] as const) {
    check(`${statutLead} : rien de proposé`, planRattrapage([ligne({ statutLead })]).aCorriger.length === 0);
  }

  check('participation dont le statut a été changé À LA MAIN : jamais réécrite',
    planRattrapage([ligne({ statutCampagne: 'Injoignable' })]).aCorriger.length === 0
    && planRattrapage([ligne({ statutCampagne: 'RDV confirmé' })]).aCorriger.length === 0);
  check('campagne archivée : écartée', planRattrapage([ligne({ campagneActive: false })]).aCorriger.length === 0);
  check('dates illisibles : écartées, avec leur motif',
    planRattrapage([ligne({ leadUpdatedAt: null })]).ecartees.some(e => e.motif === 'dates illisibles (prudence : on ne propose pas)'));
  check('aucune ligne : aucun plantage', planRattrapage([]).aCorriger.length === 0);

  // Le compte et la répartition annoncés à blanc.
  const melange = planRattrapage([
    ligne({ id: 'a', statutLead: 'contacte' }),
    ligne({ id: 'b', statutLead: 'qualifie' }),
    ligne({ id: 'c', statutLead: 'negociation' }),
    ligne({ id: 'd', statutLead: 'signe' }),
    ligne({ id: 'e', statutLead: 'contacte', leadUpdatedAt: AVANT }),
    ligne({ id: 'f', statutCampagne: 'Pas intéressé' }),
  ]);
  check('compte annoncé : 3 à rattraper sur 6 lignes', melange.aCorriger.length === 3);
  check('répartition annoncée : 2 Échange en cours, 1 Contacté sans retour',
    melange.attendu.get('Échange en cours') === 2 && melange.attendu.get('Contacté sans retour') === 1);
  check('toutes les lignes sont comptées quelque part (aucune disparition silencieuse)',
    melange.aCorriger.length + melange.ecartees.reduce((a, e) => a + e.n, 0) === 6);
  check('IDEMPOTENT : rejoué sur des lignes déjà corrigées, le plan est vide',
    planRattrapage(melange.aCorriger.map(c => ligne({ id: c.id, statutCampagne: c.cible }))).aCorriger.length === 0);
}

// ---------------------------------------------------------------------------
section('Écriture sur base SQLite jetable (jamais Turso)');
{
  const file = dbJetable('harness-rattrapage');
  const db = createClient({ url: `file:${file}` });
  const migrations = path.resolve('prisma/migrations');
  for (const suffixe of ['_init_crm_schema', '_lot2_planned_actions', '_lot_salons_campagnes']) {
    const dir = readdirSync(migrations).find(d => d.endsWith(suffixe))!;
    await db.executeMultiple(readFileSync(path.join(migrations, dir, 'migration.sql'), 'utf-8'));
  }
  await db.execute(`INSERT INTO commercials (id, name, active, createdAt, updatedAt) VALUES ('tom', 'Tom', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);

  const leads: Array<[string, string, string]> = [
    // id, statut du lead, updatedAt
    ['l1', 'contacte', '2026-09-19 09:00:00'],   // travaillé après l'entrée -> à rattraper
    ['l2', 'qualifie', '2026-09-19 09:30:00'],   // idem
    ['l3', 'contacte', '2026-06-01 09:00:00'],   // pas touché depuis juin -> écarté
    ['l4', 'signe', '2026-09-19 10:00:00'],      // fermé -> statut de campagne inchangé
    ['l5', 'qualifie', '2026-09-19 10:00:00'],   // participation déjà corrigée à la main
  ];
  for (const [id, statut, maj] of leads) {
    await db.execute({
      sql: `INSERT INTO leads (id, createdAt, updatedAt, source, commercialId, firstName, lastName, phone, email, boatType, boatCondition, boatInterest, brand, status, contactDate, currentBoat, comments, deliveryDate, temperature, priority, nextActionType, nextActionDate, lastActionDate, lossReason, signedAt, lostAt, reportedAt) VALUES (?, '2026-05-01', ?, 'Salon – Grand Pavois', 'tom', 'P', ?, '', '', '', '', '', '', ?, '', '', '', '', 'neutre', 'normale', '', '', '', '', '', '', '')`,
      args: [id, maj, id.toUpperCase(), statut],
    });
  }
  // Toutes les participations sont entrées le 18/09 à 10 h.
  const participations: Array<[string, string, string]> = [
    ['p1', 'l1', STATUT_PAR_DEFAUT],
    ['p2', 'l2', STATUT_PAR_DEFAUT],
    ['p3', 'l3', STATUT_PAR_DEFAUT],
    ['p4', 'l4', STATUT_PAR_DEFAUT],
    ['p5', 'l5', 'Injoignable'],
  ];
  for (const [id, leadId, statut] of participations) {
    await db.execute({
      sql: `INSERT INTO campagne_leads (id, createdAt, updatedAt, campagneId, leadId, responsableId, segment, priorite, statutCampagne, bateauxAVoir, notes) VALUES (?, '2026-09-18 10:00:00', '2026-09-18 10:00:00', 'campagne-grand-pavois-2026', ?, 'tom', '', 'Moyenne', ?, '', '')`,
      args: [id, leadId, statut],
    });
  }

  const plan = planRattrapage(await lireLignes(db));
  check('plan sur base réelle : 2 participations à rattraper (p1, p2)',
    plan.aCorriger.map(p => p.id).sort().join() === 'p1,p2', plan.aCorriger.map(p => p.id).join());
  check('le lead signé n\'est pas proposé', !plan.aCorriger.some(p => p.id === 'p4'));
  check('la participation déjà corrigée à la main n\'est pas proposée', !plan.aCorriger.some(p => p.id === 'p5'));

  const colonnes = await colonnesHorsStatut(db);
  check('colonnes comparées : toutes sauf statutCampagne et updatedAt',
    !colonnes.includes('statutCampagne') && !colonnes.includes('updatedAt') && colonnes.includes('segment') && colonnes.includes('notes'));
  const colonnesLeads = (await db.execute(`SELECT name FROM pragma_table_info('leads') ORDER BY cid`)).rows.map(r => String(r.name));
  const avant = {
    autres: await fingerprint(db, 'campagne_leads', colonnes), colonnes,
    leads: await fingerprint(db, 'leads', colonnesLeads), colonnesLeads,
  };

  const n = await appliquerRattrapage(db, plan.aCorriger);
  check('écriture : 2 lignes modifiées', n === 2, String(n));
  for (const c of await prouverRattrapage(db, avant, plan.aCorriger)) {
    if (c.label === 'répartition obtenue') { console.log(`    ${c.label} : ${c.detail}`); continue; }
    check(`preuve : ${c.label}`, c.ok, c.detail);
  }

  const apres = new Map((await lireLignes(db)).map(l => [l.id, l.statutCampagne]));
  check('p1 (lead Contacté) -> « Contacté sans retour »', apres.get('p1') === 'Contacté sans retour');
  check('p2 (lead Qualifié) -> « Échange en cours »', apres.get('p2') === 'Échange en cours');
  check('p3 (lead inchangé depuis juin) -> reste « À contacter »', apres.get('p3') === STATUT_PAR_DEFAUT);
  check('p4 (lead Signé) -> reste « À contacter », aucun jugement posé', apres.get('p4') === STATUT_PAR_DEFAUT);
  check('p5 (« Injoignable » posé à la main) -> intact', apres.get('p5') === 'Injoignable');

  check('REJEU : 0 ligne modifiée', (await appliquerRattrapage(db, planRattrapage(await lireLignes(db)).aCorriger)) === 0);
  check('aucun lead touché (empreinte identique après l\'écriture)',
    (await fingerprint(db, 'leads', colonnesLeads)).sha256 === avant.leads.sha256);

  db.close();
  nettoyerDbJetables(file);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais rattrapage : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
