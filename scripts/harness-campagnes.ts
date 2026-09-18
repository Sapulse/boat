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
import { readFileSync, rmSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  getState, detectSchema, createLead, createCommercial, deleteLead,
  addCampagneLeads, updateCampagneLead, upsertCampagne, updateCampagne, deleteCampagneLead,
  restoreBackup,
} from '../api/_lib/store';
import type { Lead, Campagne, CampagneLead, AppState } from '../src/data/types';
import { SAUVEGARDE_ANTERIEURE_SALONS } from '../api/_lib/http';
import { dbJetable } from './lib/dbJetable';

const DB_FILE = dbJetable('harness-campagnes');
const DB_URL = `file:${DB_FILE}`;
const DB_FILE_LEGACY = dbJetable('harness-campagnes-legacy');
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
// Schéma COMPLET de la prod v4 (login et boîte de réception compris) : sans eux,
// la garde anti-brute-force du login tourne à vide (fail-open) et le test HTTP
// ne prouverait pas grand-chose.
const SCHEMA_V4 = [
  '_init_crm_schema', '_add_login_attempts', '_add_inbound_emails',
  '_lot2_planned_actions', '_lot3_template_layout', '_lot4_weekly_objectives', '_lot5_social',
];
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

/**
 * LE TEST DU SOIR DE MIGRATION — ANCIEN CODE SUR BASE MIGRÉE.
 *
 * Le reste du harnais prouve l'inverse (code neuf sur base ancienne). Or la
 * séquence réelle est : on migre la base le soir, et la PROD EN PLACE — celle du
 * tag, qui ne connaît pas les nouvelles tables — continue de tourner dessus
 * toute la nuit. Si elle s'en trouvait perturbée, on l'apprendrait avec l'équipe
 * devant l'écran.
 *
 * On extrait donc le VRAI code du tag (git archive) et on le fait tourner contre
 * une base migrée : store (detectSchema, getState) ET HTTP (login + /api/state),
 * puis on compare l'état renvoyé à celui obtenu sur une base NON migrée — s'il
 * est identique au caractère près, aucun écran ne peut changer.
 *
 * Réutilisable à chaque lot : changer TAG_PROD.
 */
const TAG_PROD = process.env.BOB_TAG_PROD ?? 'prod-2026-09-18-lot2a5';
const CODE_DIR = path.resolve('.tmp-code-prod');

function tagDisponible(tag: string): boolean {
  try { execFileSync('git', ['rev-parse', '--verify', `${tag}^{commit}`], { stdio: 'pipe' }); return true; }
  catch { return false; }
}

/** Extrait `api/` et `src/` du tag DANS le projet (pour que node_modules se résolve). */
function extraireCodeDuTag(tag: string): void {
  rmSync(CODE_DIR, { recursive: true, force: true });
  mkdirSync(CODE_DIR, { recursive: true });
  const archive = execFileSync('git', ['archive', tag, 'api', 'src'], { maxBuffer: 256 * 1024 * 1024 });
  const tarFile = path.join(CODE_DIR, 'code.tar');
  writeFileSync(tarFile, archive);
  // `tar` depuis le dossier, avec un nom RELATIF : sous Windows, « C:\… » est
  // pris pour un hôte distant (« Cannot connect to C: »).
  execFileSync('tar', ['-xf', 'code.tar'], { cwd: CODE_DIR });
  rmSync(tarFile, { force: true });
}

async function ancienCodeSurBaseMigree(): Promise<void> {
  section(`Ancien code de PROD (${TAG_PROD}) sur une base MIGRÉE — le test du soir de migration`);
  if (!tagDisponible(TAG_PROD)) {
    console.log(`  ⓘ SAUTÉ : le tag ${TAG_PROD} n'est pas disponible ici (dépôt sans tags).`);
    console.log('    Ce saut est ANNONCÉ, jamais silencieux — le test tourne sur le poste avant chaque migration.');
    return;
  }
  extraireCodeDuTag(TAG_PROD);
  const vieux = await import(pathToFileURL(path.join(CODE_DIR, 'api/_lib/store.ts')).href) as {
    detectSchema: (p: PrismaClient) => Promise<Record<string, boolean>>;
    getState: (p: PrismaClient) => Promise<AppState>;
    createCommercial: (p: PrismaClient, c: unknown) => Promise<unknown>;
    createLead: (p: PrismaClient, l: unknown) => Promise<unknown>;
    createAction: (p: PrismaClient, a: unknown) => Promise<unknown>;
    upsertPlannedAction: (p: PrismaClient, id: string, body: unknown) => Promise<unknown>;
  };

  // Deux bases, MÊMES données : l'une v4, l'autre v4 + lot salons.
  const bases: Record<string, { file: string; url: string }> = {
    v4: { file: dbJetable('harness-vieux-v4'), url: '' },
    migree: { file: dbJetable('harness-vieux-migree'), url: '' },
  };
  const etats: Record<string, AppState> = {};
  for (const [nom, b] of Object.entries(bases)) {
    b.url = `file:${b.file}`;
    rmSync(b.file, { force: true });
    const setup = createClient({ url: b.url });
    await setup.executeMultiple('PRAGMA foreign_keys = ON;\n' + migrationSql(nom === 'v4' ? SCHEMA_V4 : SCHEMA_SALONS));
    await setup.close();
    const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: b.url }) });
    // Jeu de données minimal mais représentatif des écrans : un commercial, un
    // lead, une action d'historique, une action programmée (Agenda + Dashboard).
    await vieux.createCommercial(prisma, { id: 'nicolas', name: 'Nicolas', active: true });
    await vieux.createLead(prisma, makeLead());
    await vieux.createAction(prisma, { id: 'a1', leadId: 'l1', authorId: 'nicolas', type: 'appel', date: '2026-09-17', result: 'OK', notes: '' });
    await vieux.upsertPlannedAction(prisma, 'pa1', {
      id: 'pa1', leadId: 'l1', type: 'relance', customLabel: '', date: '2026-09-19', originalDate: '2026-09-19',
      note: '', status: 'a_faire', people: [{ commercialId: 'nicolas', role: 'responsable' }],
    });
    etats[nom] = await vieux.getState(prisma);
    if (nom === 'migree') {
      const f = await vieux.detectSchema(prisma);
      check('ancien code : detectSchema ne lève RIEN sur la base migrée', typeof f === 'object' && f !== null);
      check('ancien code : detectSchema ignore les tables du lot (aucune clé campagnes)', !('campagnes' in f));
      check('ancien code : les lots 2 à 5 restent détectés', f.lot2 === true && f.social === true);
    }
    await prisma.$disconnect();
  }

  check('ancien code : getState répond sur la base migrée (leads, actions, actions programmées)',
    etats.migree.leads.length === 1 && etats.migree.actions.length === 1 && etats.migree.plannedActions.length === 1);
  check('ancien code : AUCUNE clé campagnes dans l\'état renvoyé',
    etats.migree.campagnes === undefined && etats.migree.campagneLeads === undefined);
  // LA preuve que le Dashboard, l'Agenda et la fiche ne peuvent pas changer :
  // l'ancien code renvoie EXACTEMENT le même état, migration ou pas.
  check('ancien code : état IDENTIQUE au caractère près, base migrée ou non (aucun écran ne peut changer)',
    JSON.stringify(etats.migree) === JSON.stringify(etats.v4));

  // --- Niveau HTTP : /api/state répond bien, avec le handler du tag ---
  {
    process.env.DATABASE_URL = bases.migree.url;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.SESSION_SECRET = 'secret-de-harnais-32-caracteres-min';
    process.env.APP_USERNAME = 'equipe@test.local';
    const auth = await import(pathToFileURL(path.join(CODE_DIR, 'api/_lib/auth.ts')).href) as {
      hashPassword: (p: string) => string; signSession: (s: string, n: number) => string;
    };
    process.env.APP_PASSWORD_HASH = auth.hashPassword('mot-de-passe-de-test');
    const handlerMod = await import(pathToFileURL(path.join(CODE_DIR, 'api/[...slug].ts')).href) as { default: Handler };
    const jeton = auth.signSession(process.env.SESSION_SECRET, Math.floor(Date.now() / 1000));

    const login = await appeler(handlerMod.default, 'POST', '/api/login', { username: process.env.APP_USERNAME, password: 'mot-de-passe-de-test' });
    check('ancien code, HTTP : POST /api/login répond 200 sur la base migrée', login.status === 200, `${login.status} ${login.body}`);
    const sansSession = await appeler(handlerMod.default, 'GET', '/api/state');
    check('ancien code, HTTP : /api/state sans session -> 401 (garde intacte)', sansSession.status === 401, String(sansSession.status));
    const avecSession = await appeler(handlerMod.default, 'GET', '/api/state', undefined, `session=${jeton}`);
    check('ancien code, HTTP : GET /api/state répond 200 sur la base migrée', avecSession.status === 200, `${avecSession.status} ${avecSession.body.slice(0, 200)}`);
    const etat = avecSession.status === 200 ? JSON.parse(avecSession.body) as AppState : ({} as AppState);
    check('ancien code, HTTP : la charge utile porte bien les données des écrans (lead, action, action programmée)',
      etat.leads?.length === 1 && etat.actions?.length === 1 && etat.plannedActions?.length === 1);
    check('ancien code, HTTP : aucune trace des campagnes dans la charge utile',
      !('campagnes' in (etat as object)) && !JSON.stringify(etat).includes('campagne'));
  }

  // Constat mesuré, PAS un blocage de ce soir : avec l'ancien code, « Restaurer »
  // efface les participations par cascade (il ne connaît pas la table). C'est ce
  // qui justifie le verrou de l'écran de restauration livré avec S2a.
  {
    const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: bases.migree.url }) });
    await addCampagneLeads(prisma, [makeParticipation({ campagneId: 'campagne-grand-pavois-2026' })]);
    const avant = Number((await prisma.campagneLead.count()));
    const vieuxRestore = await import(pathToFileURL(path.join(CODE_DIR, 'api/_lib/store.ts')).href) as {
      restoreBackup: (p: PrismaClient, payload: unknown) => Promise<unknown>;
      getState: (p: PrismaClient) => Promise<AppState>;
    };
    await vieuxRestore.restoreBackup(prisma, envelope(await vieuxRestore.getState(prisma)));
    const apres = Number((await prisma.campagneLead.count()));
    check('constat : avec l\'ancien code, « Restaurer » efface les participations (cascade) -> verrou UI livré avec S2a',
      avant === 1 && apres === 0, `avant ${avant}, après ${apres}`);
    await prisma.$disconnect();
  }

  // Nettoyage TOLÉRANT : sous Windows, le fichier d'une base tout juste fermée
  // reste parfois verrouillé quelques instants. Ces fichiers sont hors git
  // (*.db) et réécrits à chaque exécution — un échec de ménage n'est pas un
  // échec de test.
  try { rmSync(CODE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  for (const b of Object.values(bases)) { try { rmSync(b.file, { force: true }); } catch { /* ignore */ } }
}

/** Appel du handler Vercel HORS HTTP (même adaptateur minimal que scripts/dev-local-test.ts). */
type Handler = (req: unknown, res: unknown) => Promise<void> | void;
async function appeler(handler: Handler, method: string, url: string, body?: unknown, cookie?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    let status = 200;
    let payload = '';
    const res = {
      statusCode: 200,
      setHeader() { /* ignoré */ },
      status(code: number) { status = code; return res; },
      json(o: unknown) { payload = JSON.stringify(o); resolve({ status, body: payload }); },
      end(chunk?: string) { payload = chunk ?? ''; resolve({ status, body: payload }); },
    };
    const req = { method, url, headers: cookie ? { cookie } : {}, body };
    void Promise.resolve(handler(req, res)).catch(e => resolve({ status: 500, body: String(e) }));
  });
}

async function main() {
  await ancienCodeSurBaseMigree();

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

    // PIÈGE DE LA VIEILLE SAUVEGARDE : tant qu'il reste des participations, une
    // sauvegarde antérieure au lot doit être REFUSÉE, en chiffrant la perte.
    {
      const vieille = { ...avant };
      delete (vieille as Partial<AppState>).campagnes;
      delete (vieille as Partial<AppState>).campagneLeads;
      let refus = '';
      try { await restoreBackup(prisma, envelope(vieille as AppState)); } catch (e) { refus = (e as Error).message; }
      check('sauvegarde antérieure au lot + participations en base : REFUSÉE (jamais un succès muet)',
        refus.startsWith(SAUVEGARDE_ANTERIEURE_SALONS), refus);
      check('le refus CHIFFRE la perte et NOMME la campagne',
        /1 participation à la campagne « Grand Pavois 2026 »/.test(refus), refus);
      const intacte = await getState(prisma);
      check('après ce refus, les participations sont toujours là',
        intacte.campagneLeads?.length === avant.campagneLeads?.length);
      // Confirmation explicite : la restauration passe, la perte est assumée.
      const rapportForce = await restoreBackup(prisma, envelope(vieille as AppState), { accepterPerteCampagnes: true });
      check('avec confirmation explicite, la restauration passe et annonce 0 participation',
        rapportForce.campagneLeads === 0);
      const apresForce = await getState(prisma);
      check('la base reflète bien la perte assumée (0 participation)', apresForce.campagneLeads?.length === 0);
      check('la perte assumée emporte aussi les campagnes (le fichier n\'en portait aucune)',
        apresForce.campagnes?.length === 0);
    }

    // Vieille sauvegarde SANS participation en base : aucune erreur, rien à perdre.
    const vieille2 = { ...avant };
    delete (vieille2 as Partial<AppState>).campagnes;
    delete (vieille2 as Partial<AppState>).campagneLeads;
    await restoreBackup(prisma, envelope(vieille2 as AppState), { accepterPerteCampagnes: true });
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
