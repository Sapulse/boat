/**
 * LOT SALONS (S1b) — harnais serveur des campagnes.
 *
 * Exécution : npx tsx scripts/harness-campagnes.ts  (et `npm test`, découverte auto)
 *
 * Prouve, sur une base SQLite LOCALE jetable (même adaptateur libSQL que Turso) :
 *
 *  1. BASE NON MIGRÉE — le CRM continue de fonctionner. C'est le risque n° 3 de
 *     l'audit : si detectSchema ne connaît pas les nouvelles tables, getState
 *     lève une erreur et c'est TOUT le CRM qui tombe, pas seulement l'onglet
 *     Campagnes. On monte donc une base SANS les tables et on exige un getState
 *     normal, sans campagnes.
 *  2. LA SOURCE D'UN LEAD EST IMMUABLE — après ajout en masse, édition en ligne
 *     et restauration, l'empreinte des sources est inchangée.
 *  3. AJOUT EN MASSE idempotent : un lead déjà participant est ignoré EN
 *     SILENCE, jamais dupliqué, et sa participation n'est pas réécrite.
 *  4. SAUVEGARDE / RESTAURATION — c'est le risque n° 1 : sans intégration, un
 *     clic sur « Restaurer » effacerait les participations en silence (cascade)
 *     ou casserait la restauration (FK). On exige l'aller-retour complet, le
 *     refus des participations orphelines, et le cas « vieille sauvegarde ».
 */
import { createClient } from '@libsql/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { readFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  getState, detectSchema, createLead, createCommercial, deleteLead,
  addCampagneLeads, updateCampagneLead, upsertCampagne, updateCampagne, deleteCampagneLead,
  restoreBackup,
} from '../api/_lib/store';
import type { Lead, Campagne, CampagneLead, AppState } from '../src/data/types';

const DB_FILE = path.resolve('.harness-campagnes.db');
const DB_URL = `file:${DB_FILE}`;
const DB_FILE_LEGACY = path.resolve('.harness-campagnes-legacy.db');
const DB_URL_LEGACY = `file:${DB_FILE_LEGACY}`;

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(title: string) { console.log(`\n— ${title}`); }

function migrationSql(suffixes: string[]): string {
  const dir = path.resolve('prisma/migrations');
  return suffixes.map(suffix => {
    const sub = readdirSync(dir).find(d => d.endsWith(suffix));
    if (!sub) throw new Error(`migration ${suffix} introuvable`);
    return readFileSync(path.join(dir, sub, 'migration.sql'), 'utf-8');
  }).join('\n');
}
const SCHEMA_V4 = ['_init_crm_schema', '_lot2_planned_actions', '_lot3_template_layout', '_lot4_weekly_objectives', '_lot5_social'];
const SCHEMA_SALONS = [...SCHEMA_V4, '_lot_salons_campagnes'];

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', createdAt: '2026-09-01', source: 'LBC', commercialId: 'nicolas',
    firstName: 'Jean', lastName: 'Test', phone: '0600000000', email: 'j@test.fr',
    boatType: 'Moteur', boatCondition: 'Neuf', boatInterest: 'Antares 9', brand: 'Beneteau',
    budget: 50000, status: 'contacte', contactDate: '2026-09-02', quoteAmount: null,
    probability: null, currentBoat: '', comments: '', deliveryDate: '', temperature: 'tiede',
    priority: 'normale', nextActionType: '', nextActionDate: '', lastActionDate: '2026-09-05',
    lossReason: '', signedAt: '', lostAt: '', reportedAt: '',
    noNextActionReason: '', noNextActionAt: '',
    ...over,
  };
}
function makeCampagne(over: Partial<Campagne> = {}): Campagne {
  return {
    id: 'camp1', nom: 'Grand Pavois 2026', type: 'salon', lieu: 'La Rochelle',
    dateDebut: '2026-09-18', dateFin: '', dateSalonDebut: '', dateSalonFin: '',
    objectifRdv: null, active: true, ...over,
  };
}
function makeParticipation(over: Partial<CampagneLead> = {}): CampagneLead {
  return {
    id: 'p1', campagneId: 'camp1', leadId: 'l1', responsableId: 'nicolas',
    segment: 'Client en portefeuille', priorite: 'Haute', statutCampagne: 'À contacter',
    bateauxAVoir: '', notes: '', ...over,
  };
}
/** Empreinte des sources : la garantie que ce lot ne touche jamais à l'origine d'un lead. */
const sourcesOf = (s: AppState) => s.leads.map(l => `${l.id}:${l.source}`).sort().join('|');

function envelope(data: AppState) {
  return { format: 'bob-crm-backup', version: 1, appVersion: '4.0.0', exportedAt: new Date().toISOString(), data };
}

async function main() {
  // ---------------------------------------------------------------------
  section('Base NON migrée (v4 sans le lot salons) — le CRM fonctionne normalement');
  {
    try { rmSync(DB_FILE_LEGACY, { force: true }); } catch { /* ignore */ }
    const setup = createClient({ url: DB_URL_LEGACY });
    await setup.executeMultiple('PRAGMA foreign_keys = ON;\n' + migrationSql(SCHEMA_V4));
    await setup.close();
    const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: DB_URL_LEGACY }) });

    const features = await detectSchema(prisma);
    check('detectSchema : campagnes = false sur une base v4', features.campagnes === false);
    check('detectSchema : les lots 2 à 5 restent détectés', features.lot2 && features.templateLayout && features.weeklyObjectives && features.social);

    await createCommercial(prisma, { id: 'nicolas', name: 'Nicolas', active: true });
    await createLead(prisma, makeLead());
    const s = await getState(prisma, { features });
    check('getState répond SANS erreur (tout le CRM reste debout)', s.leads.length === 1);
    check('aucune campagne dans l\'état renvoyé', s.campagnes === undefined && s.campagneLeads === undefined);
    await prisma.$disconnect();
  }

  // ---------------------------------------------------------------------
  try { rmSync(DB_FILE, { force: true }); } catch { /* ignore */ }
  const setup = createClient({ url: DB_URL });
  await setup.executeMultiple('PRAGMA foreign_keys = ON;\n' + migrationSql(SCHEMA_SALONS));
  await setup.close();
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: DB_URL }) });

  section('Base migrée — détection, seed, état');
  {
    const features = await detectSchema(prisma);
    check('detectSchema : campagnes = true', features.campagnes === true);
    await createCommercial(prisma, { id: 'nicolas', name: 'Nicolas', active: true });
    await createCommercial(prisma, { id: 'fred', name: 'Frédéric', active: true });
    await createLead(prisma, makeLead());
    await createLead(prisma, makeLead({ id: 'l2', source: 'Site BOB', lastName: 'Martin' }));
    await createLead(prisma, makeLead({ id: 'l3', source: 'Passage', lastName: 'Durand' }));
    const s = await getState(prisma);
    check('le seed de la migration est là (Grand Pavois 2026, salon, La Rochelle)',
      s.campagnes?.length === 1 && s.campagnes[0].nom === 'Grand Pavois 2026' && s.campagnes[0].type === 'salon' && s.campagnes[0].lieu === 'La Rochelle');
    check('seed : fenêtre d\'activité ouverte, dates du salon VIDES (TODO assumé)',
      s.campagnes?.[0].dateDebut === '2026-09-18' && s.campagnes[0].dateSalonDebut === '' && s.campagnes[0].dateSalonFin === '');
    check('seed : objectif de RDV non fixé (null)', s.campagnes?.[0].objectifRdv === null);
    check('aucune participation au départ', s.campagneLeads?.length === 0);
  }

  const sourcesAvant = sourcesOf(await getState(prisma));

  section('Campagne : upsert et saisie des dates du salon (simple UPDATE)');
  {
    await upsertCampagne(prisma, 'camp1', makeCampagne());
    const maj = await updateCampagne(prisma, 'campagne-grand-pavois-2026', {
      dateFin: '2026-09-27', dateSalonDebut: '2026-09-22', dateSalonFin: '2026-09-27', objectifRdv: 40,
    });
    check('dates du salon renseignées sans toucher à la fenêtre d\'activité',
      maj.dateSalonDebut === '2026-09-22' && maj.dateSalonFin === '2026-09-27' && maj.dateDebut === '2026-09-18');
    check('objectif de RDV enregistré', maj.objectifRdv === 40);
    const s = await getState(prisma);
    check('deux campagnes en base (seed + campagne de test)', s.campagnes?.length === 2);
  }

  section('Ajout EN MASSE — idempotent, jamais de doublon, jamais la source');
  {
    const r1 = await addCampagneLeads(prisma, [
      makeParticipation(),
      makeParticipation({ id: 'p2', leadId: 'l2', priorite: 'Moyenne', segment: 'Emailing Grand Pavois' }),
    ]);
    check('2 participations ajoutées', r1.ajoutes.length === 2 && r1.ignores.length === 0);
    check('valeurs par défaut correctes (statut « À contacter »)', r1.ajoutes.every(p => p.statutCampagne === 'À contacter'));

    // Deuxième ajout : un lead DÉJÀ participant + un nouveau.
    const r2 = await addCampagneLeads(prisma, [
      makeParticipation({ id: 'p1-bis', leadId: 'l1', priorite: 'Basse', segment: 'AUTRE SEGMENT' }),
      makeParticipation({ id: 'p3', leadId: 'l3', responsableId: 'fred' }),
    ]);
    check('lead déjà participant : IGNORÉ en silence (aucune erreur)', r2.ignores.length === 1 && r2.ignores[0] === 'l1');
    check('lead nouveau du même lot : ajouté', r2.ajoutes.length === 1 && r2.ajoutes[0].leadId === 'l3');
    const s = await getState(prisma);
    check('3 participations au total, aucun doublon', s.campagneLeads?.length === 3);
    const p1 = s.campagneLeads?.find(p => p.leadId === 'l1');
    check('la participation existante n\'a PAS été réécrite (segment et priorité d\'origine)',
      p1?.segment === 'Client en portefeuille' && p1?.priorite === 'Haute');
    check('sources des leads inchangées après ajout en masse', sourcesOf(s) === sourcesAvant, sourcesOf(s));

    let refus = '';
    try { await addCampagneLeads(prisma, [makeParticipation({ id: 'p9', campagneId: 'inconnue' })]); }
    catch (e) { refus = (e as Error).message; }
    check('campagne inconnue refusée (400)', /campagne inconnue/.test(refus), refus);

    let refusDoublon = '';
    try { await addCampagneLeads(prisma, [makeParticipation({ id: 'pa' }), makeParticipation({ id: 'pb' })]); }
    catch (e) { refusDoublon = (e as Error).message; }
    check('deux fois le même lead DANS LE MÊME LOT : refusé par la validation', /doublon/.test(refusDoublon), refusDoublon);
  }

  section('Édition en ligne — statut, priorité, responsable');
  {
    const maj = await updateCampagneLead(prisma, 'p2', { statutCampagne: 'RDV confirmé', priorite: 'Haute', responsableId: 'fred' });
    check('statut, priorité et responsable enregistrés', maj.statutCampagne === 'RDV confirmé' && maj.priorite === 'Haute' && maj.responsableId === 'fred');
    let refus = '';
    try { await updateCampagneLead(prisma, 'p2', { statutCampagne: 'Statut inventé' as CampagneLead['statutCampagne'] }); }
    catch (e) { refus = (e as Error).message; }
    check('statut hors liste refusé (enum strict)', /participation invalide/.test(refus), refus);
    const s = await getState(prisma);
    check('sources des leads toujours inchangées après édition', sourcesOf(s) === sourcesAvant);
  }

  section('Suppression : participation retirée, lead supprimé (cascade)');
  {
    await deleteCampagneLead(prisma, 'p3');
    let s = await getState(prisma);
    check('participation retirée, le lead reste', s.campagneLeads?.length === 2 && s.leads.some(l => l.id === 'l3'));
    await deleteLead(prisma, 'l2');
    s = await getState(prisma);
    check('suppression d\'un lead : sa participation suit (cascade, aucun orphelin)',
      s.campagneLeads?.length === 1 && s.campagneLeads[0].leadId === 'l1');
  }

  section('Sauvegarde / restauration — risque n° 1 de l\'audit');
  {
    const avant = await getState(prisma);
    const rapport = await restoreBackup(prisma, envelope(avant));
    check('le rapport de restauration COMPTE les campagnes et les participations',
      rapport.campagnes === avant.campagnes?.length && rapport.campagneLeads === avant.campagneLeads?.length,
      JSON.stringify({ campagnes: rapport.campagnes, participations: rapport.campagneLeads }));
    const restaure = await getState(prisma);
    check('aller-retour complet : campagnes restaurées', restaure.campagnes?.length === avant.campagnes?.length);
    check('aller-retour complet : participations restaurées', restaure.campagneLeads?.length === avant.campagneLeads?.length);
    check('restauration : la participation garde son segment et son statut',
      restaure.campagneLeads?.[0].segment === avant.campagneLeads?.[0].segment
      && restaure.campagneLeads?.[0].statutCampagne === avant.campagneLeads?.[0].statutCampagne);
    check('restauration : sources des leads inchangées', sourcesOf(restaure) === sourcesOf(avant));

    // Participation orpheline : mieux vaut un refus lisible qu'une ligne fantôme.
    let refusLead = '';
    const bancal = { ...avant, campagneLeads: [makeParticipation({ id: 'px', leadId: 'inconnu' })] };
    try { await restoreBackup(prisma, envelope(bancal as AppState)); } catch (e) { refusLead = (e as Error).message; }
    check("sauvegarde avec une participation d'un lead absent : REFUSÉE", /lead absent/.test(refusLead), refusLead);

    let refusResp = '';
    const bancal2 = { ...avant, campagneLeads: [makeParticipation({ id: 'py', leadId: 'l1', responsableId: 'inconnu' })] };
    try { await restoreBackup(prisma, envelope(bancal2 as AppState)); } catch (e) { refusResp = (e as Error).message; }
    check('sauvegarde avec un responsable absent : REFUSÉE', /responsable absent/.test(refusResp), refusResp);

    const apresRefus = await getState(prisma);
    check('après un refus, la base est INTACTE (validation avant toute écriture)',
      apresRefus.campagneLeads?.length === avant.campagneLeads?.length && apresRefus.leads.length === avant.leads.length);

    // Vieille sauvegarde (d'avant le lot) : aucune campagne, et surtout aucune erreur.
    const vieille = { ...avant };
    delete (vieille as Partial<AppState>).campagnes;
    delete (vieille as Partial<AppState>).campagneLeads;
    await restoreBackup(prisma, envelope(vieille as AppState));
    const apres = await getState(prisma);
    check("sauvegarde d'AVANT le lot : restaurée sans erreur, aucune campagne", apres.campagnes?.length === 0 && apres.campagneLeads?.length === 0);
    check("sauvegarde d'AVANT le lot : les leads sont bien là, sources intactes",
      apres.leads.length === avant.leads.length && sourcesOf(apres) === sourcesOf(avant));
  }

  await prisma.$disconnect();
  try { rmSync(DB_FILE, { force: true }); rmSync(DB_FILE_LEGACY, { force: true }); } catch { /* ignore */ }

  console.log('\n' + '='.repeat(50));
  console.log(`Harnais campagnes (lot salons) : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Échec du harnais :', e); process.exit(1); });
