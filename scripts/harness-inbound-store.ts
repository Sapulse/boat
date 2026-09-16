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
 *    inconnu 400) ; computeSinceFloor (env valide/invalide/absente) ;
 *  - ATTACH (retour terrain) : aucun lead créé, une action 'note' datée du jour
 *    de réception, lead cible NON modifié (`lastActionDate` intacte) ;
 *  - « TRAITÉS » PAGINÉS (étape B) : tout l'historique atteignable au-delà des
 *    50, sans doublon entre pages, filtre + recherche + comptes, rejet ancien
 *    remis en file ;
 *  - REOPEN : réversibilité du seul rejet — accepté et rattaché sont refusés
 *    parce qu'ils ont créé des données que ce module ne défait jamais ;
 *  - purge de rétention RGPD (le seul DELETE du module).
 */
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@libsql/client';
import { readFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  collectInbound, listInbound, listProcessedInbound, patchInbound, computeSinceFloor,
  listPurgeableInbound, purgeRejectedInbound, inboundRetentionCutoff, INBOUND_RETENTION_DAYS,
} from '../api/_lib/inboundStore';
import { createLead, createCommercial } from '../api/_lib/store';
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
  await raw.executeMultiple(migrationSql('_lot2_planned_actions')); // lot 2 : colonnes + tables ajoutées
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

  // --- Modèle d'actions de la file : RATTACHER et REMETTRE EN FILE -----------
  // Retour terrain : un prospect qui refait la même demande ne doit ni créer un
  // doublon (accept) ni voir sa demande perdue (reject).
  section('RATTACHER à un lead existant');
  {
    await createCommercial(prisma, { id: 'oceane', name: 'Océane', active: true });
    const cible = await createLead(prisma, {
      id: 'lead-cible', createdAt: '2026-01-10', source: 'LBC', commercialId: 'oceane',
      firstName: 'Marc', lastName: 'Le Goff', phone: '0611223344', email: 'marc@test.fr',
      boatType: 'Moteur', boatCondition: 'Neuf', boatInterest: 'Antares 9', brand: 'Beneteau',
      budget: 50000, status: 'negociation', contactDate: '2026-01-11', quoteAmount: null,
      probability: null, currentBoat: '', comments: '', deliveryDate: '',
      temperature: 'froid', priority: 'normale', nextActionType: '', nextActionDate: '',
      lastActionDate: '2026-01-20', lossReason: '', signedAt: '', lostAt: '', reportedAt: '',
    });
    check('lead cible créé, froid, dernière activité au 2026-01-20',
      cible.temperature === 'froid' && cible.lastActionDate === '2026-01-20');

    await prisma.inboundEmail.create({
      data: {
        id: 'ib-attach', graphId: 'g-att', internetMessageId: '<att@lbc>',
        receivedAt: '2026-07-23T21:19:00Z', fromAddress: 'marc@test.fr',
        subject: 'Nouveau message pour "Antares 9" sur leboncoin',
        excerpt: 'Bonjour, toujours disponible ?', source: 'leboncoin',
        sourceLabel: 'Leboncoin', sourceDetail: 'Annonce Antares', leadSource: 'LBC', score: 80,
      },
    });

    const leadsBefore = await prisma.lead.count();
    const out = await patchInbound(prisma, 'ib-attach', { action: 'attach', leadId: 'lead-cible' });

    check('AUCUN lead créé (c\'est tout l\'intérêt)', (await prisma.lead.count()) === leadsBefore,
      `${leadsBefore} -> ${await prisma.lead.count()}`);
    check('email marqué « rattache »', out.inbound.status === 'rattache', out.inbound.status);
    check('email lié au lead existant', out.inbound.leadId === 'lead-cible');

    const actions = await prisma.leadAction.findMany({ where: { leadId: 'lead-cible' } });
    check('exactement 1 action créée', actions.length === 1, String(actions.length));
    const a = actions[0];
    check("type 'note' — PAS 'email' (qui compterait dans les objectifs du commercial)",
      a.type === 'note', a.type);
    check('datée du jour de RÉCEPTION, pas d\'aujourd\'hui', a.date === '2026-07-23', a.date);
    check('auteur = commercial du lead (FK Restrict : ne peut pas être vide)', a.authorId === 'oceane');
    check('result porte la provenance', a.result === 'Demande entrante — Leboncoin — Annonce Antares', a.result);
    check("notes portent l'objet ET le message",
      a.notes.includes('Nouveau message pour') && a.notes.includes('toujours disponible'), a.notes);
    check('aucun changement de statut du lead imposé', a.newStatus === null || a.newStatus === undefined);

    // Le lead cible n'est PAS touché : depuis 2026-09 le système ne pose plus la
    // température (elle appartient au commercial). Le lead a été créé FROID, il
    // reste FROID — la demande entrante se signale par l'action d'historique et
    // par la file « Traités », pas en repeignant la fiche.
    const after = await prisma.lead.findUnique({ where: { id: 'lead-cible' } });
    check('température INCHANGÉE (le système ne la décide plus)', after?.temperature === 'froid', after?.temperature);
    check('aucun lead retourné : aucun lead modifié', out.lead === undefined);
    check('lastActionDate INCHANGÉE : personne ne l\'a encore rappelé, l\'alerte doit rester vraie',
      after?.lastActionDate === '2026-01-20', String(after?.lastActionDate));
    check('la file « traités » inclut les rattachés',
      (await listInbound(prisma)).some(m => m.id === 'ib-attach' && m.status === 'rattache'));
  }

  section('Rattachement — refus');
  {
    await prisma.inboundEmail.create({
      data: {
        id: 'ib-att2', graphId: 'g-att2', internetMessageId: '<att2@lbc>',
        receivedAt: '2026-07-24T10:00:00Z', fromAddress: 'x@y.z', subject: 'S',
        excerpt: 'E', source: 'site', sourceLabel: 'Formulaire du site', leadSource: 'Site BOB', score: 60,
      },
    });
    await expectHttpError('lead cible inconnu -> 400', 400,
      () => patchInbound(prisma, 'ib-att2', { action: 'attach', leadId: 'fantome' }));
    await expectHttpError('rattacher un email DÉJÀ rattaché -> 409', 409,
      () => patchInbound(prisma, 'ib-attach', { action: 'attach', leadId: 'lead-cible' }));
    await expectHttpError('leadId absent du corps -> 400', 400,
      () => patchInbound(prisma, 'ib-att2', { action: 'attach' }));
  }

  section('REMETTRE EN FILE — seul le rejet est réversible');
  {
    // Le cas vécu : l'équipe a rejeté 4 vraies demandes faute de « rattacher ».
    await patchInbound(prisma, 'ib-att2', { action: 'reject' });
    check('email bien rejeté', (await prisma.inboundEmail.findUnique({ where: { id: 'ib-att2' } }))?.status === 'rejete');

    const back = await patchInbound(prisma, 'ib-att2', { action: 'reopen' });
    check('rejeté -> remis « a_traiter »', back.inbound.status === 'a_traiter', back.inbound.status);
    check('leadId effacé (jamais de lien mort dans la file)', back.inbound.leadId === undefined);

    // Et il redevient réellement actionnable : c'est tout le but.
    const re = await patchInbound(prisma, 'ib-att2', { action: 'attach', leadId: 'lead-cible' });
    check('un email remis en file est de nouveau actionnable', re.inbound.status === 'rattache');

    await expectHttpError('remettre en file un ACCEPTÉ -> 409 (un lead a été créé)', 409,
      () => patchInbound(prisma, pendingItem.id, { action: 'reopen' }));
    await expectHttpError('remettre en file un RATTACHÉ -> 409 (une action a été créée)', 409,
      () => patchInbound(prisma, 'ib-attach', { action: 'reopen' }));

    await prisma.inboundEmail.create({
      data: {
        id: 'ib-att3', graphId: 'g-att3', internetMessageId: '<att3@lbc>',
        receivedAt: '2026-07-25T10:00:00Z', fromAddress: 'a@b.c', subject: 'S',
        excerpt: 'E', source: 'site', sourceLabel: 'Formulaire du site', leadSource: 'Site BOB', score: 60,
      },
    });
    await expectHttpError('remettre en file un email DÉJÀ à traiter -> 409', 409,
      () => patchInbound(prisma, 'ib-att3', { action: 'reopen' }));

    check('action inconnue -> refus', await (async () => {
      try { await patchInbound(prisma, 'ib-att3', { action: 'nawak' }); return false; } catch { return true; }
    })());
  }

  section('Date de traitement exposée (« Traités » ne montrait que le statut)');
  {
    const all = await listInbound(prisma);
    const enAttente = all.filter(m => m.status === 'a_traiter');
    const traites = all.filter(m => m.status !== 'a_traiter');

    check('un email « à traiter » n\'a PAS de date de traitement',
      enAttente.every(m => m.processedAt === undefined),
      JSON.stringify(enAttente.map(m => m.processedAt)));
    check('tout email traité en porte une',
      traites.length > 0 && traites.every(m => !!m.processedAt),
      JSON.stringify(traites.map(m => [m.status, m.processedAt])));
    check('la date est de l\'ISO exploitable par l\'affichage',
      traites.every(m => !Number.isNaN(Date.parse(m.processedAt!))));
    check('les 3 statuts traités en portent une (accepté, rejeté, rattaché)',
      ['accepte', 'rejete', 'rattache'].every(st => traites.some(m => m.status === st && !!m.processedAt)),
      JSON.stringify(traites.map(m => m.status)));

    // Une remise en file EFFACE la date : l'email redevient « à traiter ».
    await prisma.inboundEmail.create({
      data: {
        id: 'ib-date', graphId: 'g-date', internetMessageId: '<date@x>',
        receivedAt: '2026-07-26T10:00:00Z', fromAddress: 'a@b.c', subject: 'S',
        excerpt: 'E', source: 'site', sourceLabel: 'Formulaire du site', leadSource: 'Site BOB', score: 60,
      },
    });
    const rejete = await patchInbound(prisma, 'ib-date', { action: 'reject' });
    check('le rejet pose la date', !!rejete.inbound.processedAt);
    const remis = await patchInbound(prisma, 'ib-date', { action: 'reopen' });
    check('la remise en file EFFACE la date (il n\'est plus traité)',
      remis.inbound.processedAt === undefined, String(remis.inbound.processedAt));
  }

  // --- Purge de rétention (RGPD) — le SEUL DELETE du module ------------------
  // On ne bricole pas `updatedAt` (champ @updatedAt, format de stockage interne
  // à Prisma) : on déplace la BORNE. Un cutoff dans le futur rend tout « hors
  // délai », un cutoff dans le passé ne rend rien éligible — ce qui exerce
  // exactement le même prédicat, dans les deux sens.
  section('Purge de rétention : périmètre étroit, prouvé dans les deux sens');
  {
    const mk = (id: string, status: string) => prisma.inboundEmail.create({
      data: {
        id, graphId: `g-${id}`, internetMessageId: `<${id}@purge>`, receivedAt: '2026-07-20T08:00:00Z',
        fromAddress: `${id}@prospect.fr`, subject: `Sujet ${id}`, source: 'site', score: 55, status,
      },
    });
    await mk('pg-pending', 'a_traiter');
    await mk('pg-accepted', 'accepte');
    await mk('pg-rejected', 'rejete');

    const leadsBefore = await prisma.lead.count();
    const totalBefore = await prisma.inboundEmail.count();
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);

    // Mode « à blanc » : lister ne supprime RIEN.
    const listed = await listPurgeableInbound(prisma, future);
    check('listPurgeableInbound voit le rejeté hors délai', listed.some(r => r.id === 'pg-rejected'));
    check('listPurgeableInbound ignore « à traiter » et « accepté »',
      !listed.some(r => r.id === 'pg-pending' || r.id === 'pg-accepted'));
    check('lister ne supprime rien (mode à blanc réellement inoffensif)',
      (await prisma.inboundEmail.count()) === totalBefore);

    // Borne dans le passé : rien n'est hors délai.
    check('cutoff antérieur -> 0 suppression', (await purgeRejectedInbound(prisma, past)) === 0);
    check('la file est intacte après un cutoff antérieur',
      (await prisma.inboundEmail.count()) === totalBefore);

    // Borne dans le futur : les rejetés partent, et EUX SEULS.
    const deleted = await purgeRejectedInbound(prisma, future);
    check('cutoff postérieur -> les rejetés sont supprimés', deleted >= 1, `deleted=${deleted}`);
    check('le rejeté a disparu', (await prisma.inboundEmail.findUnique({ where: { id: 'pg-rejected' } })) === null);
    check('« à traiter » SURVIT (travail en attente)',
      (await prisma.inboundEmail.findUnique({ where: { id: 'pg-pending' } })) !== null);
    check('« accepté » SURVIT (porte le lien vers le lead créé)',
      (await prisma.inboundEmail.findUnique({ where: { id: 'pg-accepted' } })) !== null);
    check('AUCUN lead touché par la purge', (await prisma.lead.count()) === leadsBefore);
    check('plus aucun rejeté éligible après purge (idempotent)',
      (await purgeRejectedInbound(prisma, future)) === 0);

    // La constante de politique est bien celle annoncée.
    const cutoff = inboundRetentionCutoff(new Date('2026-07-30T12:00:00Z'));
    check(`inboundRetentionCutoff = J-${INBOUND_RETENTION_DAYS}`,
      cutoff.toISOString().slice(0, 10) === '2026-05-01', cutoff.toISOString());
  }

  section('« Traités » paginés : TOUT l\'historique est atteignable (étape B)');
  {
    // 70 rejets de plus : au-delà des 50 que listInbound renvoie. Deux formats de
    // `updatedAt`, comme en prod : CURRENT_TIMESTAMP (« AAAA-MM-JJ HH:MM:SS »,
    // rejets automatiques de la collecte) et l'ISO écrit par Prisma.
    for (let i = 0; i < 70; i++) {
      const id = `old-${String(i).padStart(2, '0')}`;
      const updatedAt = i % 5 === 0 ? `2026-06-${String(1 + (i % 28)).padStart(2, '0')} 08:00:00` : `2026-06-${String(1 + (i % 28)).padStart(2, '0')}T09:00:00.000+00:00`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO inbound_emails (id, graphId, internetMessageId, receivedAt, fromAddress, subject, excerpt, source, sourceLabel, leadSource, extracted, score, scoreReasons, status, updatedAt)
         VALUES (?, ?, ?, '2026-06-01T08:00:00Z', 'noreply@leboncoin.fr', ?, 'x', 'leboncoin', 'Leboncoin', 'LBC', ?, 70, '[]', 'rejete', ?)`,
        id, `g-${id}`, `<${id}@hist>`, `Nouveau message pour "Bateau ${i}"`,
        JSON.stringify({ firstName: i === 42 ? 'Hélène' : 'Prospect', lastName: `N${i}`, email: `p${i}@x.fr`, phone: i === 42 ? '06 99 88 77 66' : '', boatInterest: `Bateau ${i}`, brand: '' }),
        updatedAt,
      );
    }
    const totalTraites = await prisma.inboundEmail.count({ where: { status: { in: ['accepte', 'rejete', 'rattache'] } } });
    check('plus de 50 traités en base (sinon le test ne prouve rien)', totalTraites > 50, String(totalTraites));
    check('listInbound plafonne toujours à 50 traités (inchangé)',
      (await listInbound(prisma)).filter(m => m.status !== 'a_traiter').length === 50);

    // Parcours complet par « Charger plus » : chaque ligne une fois, aucune perdue.
    const seen: string[] = [];
    let offset: number | undefined = 0;
    let pages = 0;
    let first: Awaited<ReturnType<typeof listProcessedInbound>> | null = null;
    while (offset !== undefined && pages < 20) {
      const p = await listProcessedInbound(prisma, { status: 'tous', q: '', offset, limit: 25 });
      first ??= p;
      seen.push(...p.items.map(m => m.id));
      offset = p.nextOffset;
      pages++;
    }
    check('toutes les pages parcourues atteignent TOUT l\'historique', seen.length === totalTraites, `${seen.length}/${totalTraites}`);
    check('aucun doublon entre pages', new Set(seen).size === seen.length);
    check(`${Math.ceil(totalTraites / 25)} pages, la dernière sans nextOffset`, pages === Math.ceil(totalTraites / 25), String(pages));
    check('total et compte « tous » = nombre réel', first!.total === totalTraites && first!.counts.tous === totalTraites);
    check('aucun « à traiter » dans les traités', seen.every(id => !id.startsWith('ib-pending')) &&
      (await prisma.inboundEmail.findMany({ where: { id: { in: seen }, status: 'a_traiter' } })).length === 0);
    check('page complète : extrait et date de traitement présents', first!.items.every(m => typeof m.excerpt === 'string' && !!m.processedAt));
    check('le plus ancien (hors des 50) est bien atteint', seen.includes('old-00'));

    const rej = await listProcessedInbound(prisma, { status: 'rejete', q: '', offset: 0, limit: 100 });
    check('filtre « rejetés » : que des rejetés', rej.items.length > 0 && rej.items.every(m => m.status === 'rejete'));
    check('comptes cohérents : tous = acceptés + rattachés + rejetés',
      rej.counts.tous === rej.counts.accepte + rej.counts.rattache + rej.counts.rejete, JSON.stringify(rej.counts));

    const helene = await listProcessedInbound(prisma, { status: 'tous', q: 'helene n42', offset: 0, limit: 25 });
    check('recherche sans accent retrouve « Hélène N42 » au fond de l\'historique',
      helene.total === 1 && helene.items[0]?.id === 'old-42', JSON.stringify(helene.items.map(m => m.id)));
    const tel = await listProcessedInbound(prisma, { status: 'rejete', q: '0699887766', offset: 0, limit: 25 });
    check('recherche par téléphone (sans espaces)', tel.total === 1 && tel.items[0]?.id === 'old-42');
    const none = await listProcessedInbound(prisma, { status: 'tous', q: 'introuvable-xyz', offset: 0, limit: 25 });
    check('recherche sans résultat -> page vide, sans nextOffset', none.items.length === 0 && none.total === 0 && none.nextOffset === undefined);
    const beyond = await listProcessedInbound(prisma, { status: 'tous', q: '', offset: 10_000, limit: 25 });
    check('décalage au-delà de la fin -> page vide, pas d\'erreur', beyond.items.length === 0 && beyond.nextOffset === undefined);

    // Le but de l'étape : un rejet ANCIEN se remet en file depuis « Traités ».
    const remis = await patchInbound(prisma, 'old-42', { action: 'reopen' });
    check('rejet ancien -> remis en file', remis.inbound.status === 'a_traiter');
    const apres = await listProcessedInbound(prisma, { status: 'rejete', q: 'helene', offset: 0, limit: 25 });
    check('il sort des « Traités »', apres.total === 0);
    check('et rien n\'a été écrit par la lecture paginée (compte inchangé)',
      (await prisma.inboundEmail.count({ where: { status: { in: ['accepte', 'rejete', 'rattache'] } } })) === totalTraites - 1);
  }

  await prisma.$disconnect();
  try { rmSync(DB_FILE, { force: true }); } catch { /* verrou Windows, sans gravité */ }

  console.log(`\n${passed} OK, ${failed} KO`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
