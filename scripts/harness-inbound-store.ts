/**
 * Harnais de la couche d'accès de la file d'import (api/_lib/inboundStore.ts).
 *
 * Exécution : npx tsx scripts/harness-inbound-store.ts
 *
 * Base SQLite JETABLE (jamais Turso) + Graph SIMULÉ (données fictives) :
 *  - collecte : insertion, admin auto-rejeté, REJEU idempotent (0 réinséré) ;
 *  - curseur : la 2e collecte repart de max(receivedAt) - 1 h, pas du plancher ;
 *  - accept : lead créé (« Non attribué » résolu/créé), champs édités
 *    appliqués, email marqué accepté + lié ; re-accept -> 409 ;
 *  - reject ; validations (corps invalide 400, id inconnu 404, commercial
 *    inconnu 400) ; computeSinceFloor (env valide/invalide/absente).
 */
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@libsql/client';
import { readFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { collectInbound, listInbound, patchInbound, computeSinceFloor } from '../api/_lib/inboundStore';
import { INBOUND_EMAILS_DDL } from './apply-inbound-emails-turso';
import type { GraphEnv } from '../api/_lib/graph';
import { HttpError } from '../api/_lib/http';

const DB_FILE = path.resolve('.harness-inbound-store.db');
const DB_URL = `file:${DB_FILE}`;

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

function migrationSql(suffix: string): string {
  const dir = path.resolve('prisma/migrations');
  const sub = readdirSync(dir).find(d => d.endsWith(suffix));
  if (!sub) throw new Error(`migration ${suffix} introuvable`);
  return readFileSync(path.join(dir, sub, 'migration.sql'), 'utf-8');
}

const ENV: GraphEnv = { tenantId: 't', clientId: 'c', clientSecret: 's', mailbox: 'contact@brest-ocean-boat.fr' };
const FLOOR = '2026-07-21T00:00:00.000Z';

function resp(status: number, bodyObj: unknown): Response {
  return { ok: status < 300, status, text: async () => JSON.stringify(bodyObj), json: async () => bodyObj } as Response;
}
const TOKEN = { match: (u: string) => u.includes('login.microsoftonline.com'), response: resp(200, { access_token: 'jeton' }) };
const fam = (needle: string) => (u: string) => u.includes('/mailFolders/inbox/messages') && decodeURIComponent(u).includes(needle);

const PROSPECT_BODY = 'Bonjour, disponible ?\n\nPROSPECT INDIVIDUEL:\nNom:  Camille Martin\nTéléphone: +33 611223344\nE-mail: camille.martin@exemple.fr\n\nINFOS PROSPECT:\nOrigine du contact:     YachtWorld\nType de demande du prospect:INTERESTED-IN\n\nBATEAU À VENDRE:\nMarque: Jeanneau\nModèle: Merry Fisher 795\nAnnée: 2021\n\nINFOS BUREAU:\nNom: BREST OCEAN BOAT';

function gmsg(over: Record<string, string>): unknown {
  return {
    id: over.id, internetMessageId: over.imid, receivedDateTime: over.at,
    subject: over.subject ?? 'Objet',
    from: { emailAddress: { name: over.name ?? 'Test', address: over.from } },
    body: { contentType: 'text', content: over.content ?? 'Bonjour' },
  };
}

function stubFetch(routes: { match: (u: string) => boolean; response: Response }[], urls?: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    urls?.push(url);
    const r = routes.find(r => r.match(url));
    if (!r) throw new Error(`URL inattendue : ${url}`);
    return r.response;
  }) as typeof fetch;
}

/** Stub standard : 1 prospect boats.com fictif + 1 facture Band of Boats. */
function twoMessagesFetch(urls?: string[]): typeof fetch {
  return stubFetch([
    TOKEN,
    { match: fam('leads.boats.com'), response: resp(200, { value: [gmsg({ id: 'g1', imid: '<prospect@x>', at: '2026-07-24T10:00:00Z', from: '1-f@leads.boats.com', name: 'Camille Martin', subject: 'Used 2021 Jeanneau Merry Fisher 795 - YachtWorld', content: PROSPECT_BODY })] }) },
    { match: fam('noreply@brest-ocean-boat.fr'), response: resp(200, { value: [] }) },
    { match: fam('leboncoin'), response: resp(200, { value: [] }) },
    { match: fam('bandofboats'), response: resp(200, { value: [gmsg({ id: 'g2', imid: '<facture@x>', at: '2026-07-23T09:00:00Z', from: 'info@bandofboats.com', name: 'Band of Boats', subject: 'Votre facture Band of Boats', content: 'Vos factures en pièce jointe de ce message pour vos enregistrements comptables.' })] }) },
  ], urls);
}

async function expectHttpError(label: string, status: number, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, 'aucune erreur levée');
  } catch (e) {
    check(label, e instanceof HttpError && e.status === status, `${(e as HttpError).status} ${(e as Error).message}`);
  }
}

async function main() {
  rmSync(DB_FILE, { force: true });
  const raw = createClient({ url: DB_URL });
  for (const stmt of migrationSql('_init_crm_schema').split(';').map(s => s.trim()).filter(Boolean)) await raw.execute(stmt);
  for (const ddl of INBOUND_EMAILS_DDL) await raw.execute(ddl);
  await raw.execute("INSERT INTO commercials (id, name, active, createdAt, updatedAt) VALUES ('fred', 'Fred', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)");
  await raw.close();

  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: DB_URL }) });

  section('computeSinceFloor : IMPORT_EMAILS_SINCE sinon J-7');
  const now = Date.parse('2026-07-28T12:00:00Z');
  check('env valide -> reprise telle quelle', computeSinceFloor({ IMPORT_EMAILS_SINCE: '2026-07-01' } as NodeJS.ProcessEnv, now) === new Date('2026-07-01').toISOString());
  check('env invalide -> J-7', computeSinceFloor({ IMPORT_EMAILS_SINCE: 'demain' } as NodeJS.ProcessEnv, now) === '2026-07-21T12:00:00.000Z');
  check('env absente -> J-7', computeSinceFloor({} as NodeJS.ProcessEnv, now) === '2026-07-21T12:00:00.000Z');

  section('Collecte : insertion + admin auto-rejeté');
  const r1 = await collectInbound(prisma, ENV, { sinceFloorIso: FLOOR, fetchFn: twoMessagesFetch() });
  check('2 scannés, 2 insérés, 0 déjà vu', r1.scanned === 2 && r1.inserted === 2 && r1.alreadySeen === 0, JSON.stringify(r1));
  check('1 administratif auto-rejeté', r1.autoRejected === 1);
  const statuses = await prisma.inboundEmail.groupBy({ by: ['status'], _count: true });
  const byStatus = Object.fromEntries(statuses.map(s => [s.status, s._count]));
  check('1 à traiter + 1 rejeté en base', byStatus['a_traiter'] === 1 && byStatus['rejete'] === 1, JSON.stringify(byStatus));

  section('Rejeu : idempotent, curseur avancé');
  const urls2: string[] = [];
  const r2 = await collectInbound(prisma, ENV, { sinceFloorIso: FLOOR, fetchFn: twoMessagesFetch(urls2) });
  check('0 inséré, 2 déjà vus', r2.inserted === 0 && r2.alreadySeen === 2, JSON.stringify(r2));
  check('total en base inchangé (2)', await prisma.inboundEmail.count() === 2);
  const expectedCursor = new Date(Date.parse('2026-07-24T10:00:00Z') - 3_600_000).toISOString();
  check('fenêtre resserrée au curseur (max - 1 h)', r2.windowSince === expectedCursor, r2.windowSince);
  check('le filtre Graph porte bien le curseur', urls2.some(u => decodeURIComponent(u).includes(expectedCursor)));

  section('Liste pour l\'écran');
  const list = await listInbound(prisma);
  check('2 éléments, extracted désérialisé', list.length === 2 && list.some(m => m.extracted.lastName === 'Martin'));

  section('Accept : lead créé, « Non attribué » résolu, édits appliqués');
  const pendingItem = list.find(m => m.status === 'a_traiter')!;
  const out = await patchInbound(prisma, pendingItem.id, {
    action: 'accept', commercialId: '', extracted: { phone: '0600000001' },
  });
  check('lead retourné', !!out.lead && out.lead.firstName === 'Camille' && out.lead.lastName === 'Martin');
  check('édit appliqué au lead (téléphone corrigé)', out.lead?.phone === '0600000001');
  check('source du lead rapprochée (Yachtworld)', out.lead?.source === 'Yachtworld');
  check('email marqué accepté + lié au lead', out.inbound.status === 'accepte' && out.inbound.leadId === out.lead?.id);
  const unassigned = await prisma.commercial.findFirst({ where: { name: 'Non attribué' } });
  check('commercial « Non attribué » créé (inactif)', !!unassigned && unassigned.active === false);
  check('le lead pointe ce commercial', (await prisma.lead.findUnique({ where: { id: out.lead!.id } }))?.commercialId === unassigned?.id);
  check('aucune suppression : 1 lead en base', await prisma.lead.count() === 1);

  section('Garde-fous accept/reject');
  await expectHttpError('re-accept -> 409 (déjà traité)', 409, () => patchInbound(prisma, pendingItem.id, { action: 'accept', commercialId: 'fred' }));
  await expectHttpError('reject d\'un traité -> 409', 409, () => patchInbound(prisma, pendingItem.id, { action: 'reject' }));
  await expectHttpError('id inconnu -> 404', 404, () => patchInbound(prisma, 'inexistant', { action: 'reject' }));
  await expectHttpError('corps invalide -> 400', 400, () => patchInbound(prisma, pendingItem.id, { action: 'exploser' }));

  section('Reject d\'un nouvel email');
  const r3 = await collectInbound(prisma, ENV, {
    sinceFloorIso: FLOOR,
    fetchFn: stubFetch([
      TOKEN,
      { match: fam('leads.boats.com'), response: resp(200, { value: [] }) },
      { match: fam('noreply@brest-ocean-boat.fr'), response: resp(200, { value: [] }) },
      { match: fam('leboncoin'), response: resp(200, { value: [gmsg({ id: 'g3', imid: '<lbc@x>', at: '2026-07-25T08:00:00Z', from: 'abc@messagerie.leboncoin.fr', name: 'pseudo via leboncoin', subject: 'Nouveau message pour "Antares 8" sur leboncoin', content: 'E-mail : p@exemple.fr\n« Bonjour, disponible ? »' })] }) },
      { match: fam('bandofboats'), response: resp(200, { value: [] }) },
    ]),
  });
  check('3e email inséré', r3.inserted === 1);
  const lbc = (await listInbound(prisma)).find(m => m.status === 'a_traiter')!;
  const rej = await patchInbound(prisma, lbc.id, { action: 'reject' });
  check('rejet appliqué', rej.inbound.status === 'rejete' && !rej.lead);
  await expectHttpError('commercial inconnu -> 400', 400, async () => {
    const r4 = await collectInbound(prisma, ENV, { sinceFloorIso: FLOOR, fetchFn: twoMessagesFetch() });
    void r4;
    // ré-ouvre un cas : ré-insère le prospect ? non (idempotent) — on reprend
    // l'accepté ? non plus. On teste la validation directement sur un pending
    // artificiel : reject du même id déjà rejeté renvoie 409, donc on valide le
    // commercial inconnu via un nouvel élément.
    await prisma.inboundEmail.create({
      data: {
        id: 'manual-1', graphId: 'gX', internetMessageId: '<manual@x>', receivedAt: '2026-07-25T09:00:00Z',
        fromAddress: 'a@b.c', source: 'site', score: 50,
      },
    });
    await patchInbound(prisma, 'manual-1', { action: 'accept', commercialId: 'inconnu-999' });
  });

  await prisma.$disconnect();
  try { rmSync(DB_FILE, { force: true }); } catch { /* verrou Windows, sans gravité */ }

  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
