/**
 * Harnais de CONTRAT de l'API (chantier migration, Lot 4).
 *
 * Exécution : npx tsx scripts/harness-api.ts
 *
 * Prouve la couche d'accès serveur (api/_lib/store.ts) SANS HTTP ni cloud :
 * on monte une base SQLite LOCALE jetable (via l'adaptateur libSQL en mode
 * fichier, exactement comme tournera Turso), on applique le schéma (la migration
 * du Lot 1), puis on exerce les fonctions du store.
 *
 * Couvre :
 *  - round-trip CRUD (create -> getState -> update -> delete) par entité ;
 *  - mappers domaine<->Prisma (sentinelles '', null vs undefined, GoalMetric
 *    aplati/déplié) ;
 *  - INVARIANTS DE BASE : cascade lead->actions (FK ON DELETE CASCADE) et clés
 *    UNIQUE (monthly_stats year+month+source, commercial_goals commercial+year+month) ;
 *  - batch saveGoals/saveMonthlyStats (upsert + suppression des absents) ;
 *  - garde d'enum (valeur invalide rejetée).
 */
import { createClient } from '@libsql/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import { readFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  getState, createLead, updateLead, deleteLead,
  createAction, createCommercial, updateCommercial,
  createTemplate, deleteTemplate, createCalendarEvent,
  saveGoals, saveMonthlyStats, saveDefaultGoal, bulkImport, restoreBackup,
} from '../api/_lib/store';
import type { Lead, LeadAction, CommercialGoal, AppState } from '../src/data/types';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const DB_FILE = path.resolve('.harness-api.db');
const DB_URL = `file:${DB_FILE}`;

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(title: string) { console.log(`\n— ${title}`); }

function migrationSql(): string {
  const dir = path.resolve('prisma/migrations');
  const sub = readdirSync(dir).find(d => d.endsWith('_init_crm_schema'));
  if (!sub) throw new Error('migration init_crm_schema introuvable');
  return readFileSync(path.join(dir, sub, 'migration.sql'), 'utf-8');
}

// --- fabriques minimales ---
function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', createdAt: '2026-06-01', source: 'Tel', commercialId: 'fred',
    firstName: 'Jean', lastName: 'Test', phone: '0600000000', email: 'j@test.fr',
    boatType: 'Moteur', boatCondition: 'Neuf', boatInterest: 'Antares 9', brand: 'Beneteau',
    budget: 50000, status: 'contacte', contactDate: '2026-06-02', quoteAmount: null,
    probability: null, currentBoat: '', comments: '', deliveryDate: '', temperature: 'tiede',
    priority: 'normale', nextActionType: '', nextActionDate: '', lastActionDate: '2026-06-05',
    lossReason: '', signedAt: '', lostAt: '', reportedAt: '', ...over,
  };
}
function makeAction(over: Partial<LeadAction> = {}): LeadAction {
  return { id: 'a1', leadId: 'l1', type: 'appel', date: '2026-06-05', result: 'OK', notes: '', authorId: 'fred', ...over };
}
// Lead d'import : forme envoyée à bulkImport (sans id ni commercialId, résolus serveur).
function importLead(over: Partial<Lead> = {}): Omit<Lead, 'id' | 'commercialId'> {
  const rest: Record<string, unknown> = { ...makeLead(over) };
  delete rest.id;
  delete rest.commercialId;
  return rest as unknown as Omit<Lead, 'id' | 'commercialId'>;
}
function emptyMetric() { return { target: null, override: null }; }
function makeGoal(over: Partial<CommercialGoal> = {}): CommercialGoal {
  return {
    id: 'g1', commercialId: 'fred', year: 2026, month: 6,
    prospectsCreated: emptyMetric(), coldCalls: emptyMetric(), followups: emptyMetric(),
    meetings: emptyMetric(), revenue: emptyMetric(), conversionRate: emptyMetric(), ...over,
  };
}

async function main() {
  // Base neuve à chaque run.
  try { rmSync(DB_FILE, { force: true }); } catch { /* ignore */ }
  const setup = createClient({ url: DB_URL });
  await setup.executeMultiple('PRAGMA foreign_keys = ON;\n' + migrationSql());
  await setup.close();

  const adapter = new PrismaLibSql({ url: DB_URL });
  const prisma = new PrismaClient({ adapter });

  section('Base vierge — getState renvoie des collections vides + defaultGoal neutre (D9)');
  {
    const s = await getState(prisma);
    check('0 lead / 0 action / 0 commercial', s.leads.length === 0 && s.actions.length === 0 && s.commercials.length === 0);
    check('defaultGoal neutre (tous null)', s.defaultGoal.revenue === null && s.defaultGoal.followups === null);
  }

  section('Commercial + Lead : create -> getState (mappers), update, sentinelles ""');
  {
    await createCommercial(prisma, { id: 'fred', name: 'Fred', active: true });
    const lead = await createLead(prisma, makeLead());
    check('lead créé, id conservé', lead.id === 'l1');
    check('sentinelle "" préservée (comments)', lead.comments === '', JSON.stringify(lead.comments));
    check('null préservé (quoteAmount)', lead.quoteAmount === null);
    check('optionnel absent -> undefined (nextActionTime)', lead.nextActionTime === undefined);
    const s = await getState(prisma);
    check('getState : 1 commercial + 1 lead', s.commercials.length === 1 && s.leads.length === 1);
    check('commercial mappé (email absent -> undefined)', s.commercials[0].email === undefined);
    await updateLead(prisma, 'l1', { status: 'devis_envoye', quoteAmount: 42000 });
    const s2 = await getState(prisma);
    check('update lead : statut + montant', s2.leads[0].status === 'devis_envoye' && s2.leads[0].quoteAmount === 42000);
  }

  section('Cascade FK : supprimer un lead supprime ses actions (ON DELETE CASCADE)');
  {
    await createAction(prisma, makeAction());
    const before = await getState(prisma);
    check('1 action rattachée au lead', before.actions.length === 1);
    await deleteLead(prisma, 'l1');
    const after = await getState(prisma);
    check('lead supprimé', after.leads.length === 0);
    check('action supprimée EN CASCADE', after.actions.length === 0, `reste ${after.actions.length}`);
  }

  section('Clé UNIQUE monthly_stats (year, month, source)');
  {
    await saveMonthlyStats(prisma, [{ id: 'm1', year: 2026, month: 1, source: 'Google Ads', budget: 100, leads: 4 }]);
    let rejected = false;
    try {
      // Même (year, month, source) avec un autre id -> doit violer l'unique.
      await prisma.monthlyStat.create({ data: { id: 'm2', year: 2026, month: 1, source: 'Google Ads', budget: 200, leads: 9 } });
    } catch { rejected = true; }
    check('doublon (year,month,source) rejeté', rejected);
  }

  section('Batch saveGoals : upsert + suppression des absents ; GoalMetric aplati/déplié');
  {
    await saveGoals(prisma, [makeGoal({ id: 'g1', revenue: { target: 100000, override: null } })]);
    let s = await getState(prisma);
    check('1 goal, cible revenue dépliée', s.goals.length === 1 && s.goals[0].revenue.target === 100000);
    // Nouveau set SANS g1 (+ g2) -> g1 supprimé, g2 créé.
    await saveGoals(prisma, [makeGoal({ id: 'g2', month: 7, meetings: { target: 8, override: 3 } })]);
    s = await getState(prisma);
    check('g1 supprimé (absent du nouvel ensemble)', !s.goals.some(g => g.id === 'g1'));
    check('g2 présent, meetings target/override', s.goals.length === 1 && s.goals[0].meetings.target === 8 && s.goals[0].meetings.override === 3);
    check('clé UNIQUE (commercialId,year,month) respectée', s.goals[0].commercialId === 'fred');
  }

  section('defaultGoal singleton (upsert id=1)');
  {
    await saveDefaultGoal(prisma, { prospectsCreated: 10, coldCalls: 20, followups: 30, meetings: 5, revenue: 200000, conversionRate: 25 });
    const s = await getState(prisma);
    check('defaultGoal persos lus', s.defaultGoal.prospectsCreated === 10 && s.defaultGoal.conversionRate === 25);
    await saveDefaultGoal(prisma, { prospectsCreated: 11, coldCalls: null, followups: null, meetings: null, revenue: null, conversionRate: null });
    const s2 = await getState(prisma);
    check('upsert (pas de 2e ligne) : valeur MAJ', s2.defaultGoal.prospectsCreated === 11 && s2.defaultGoal.coldCalls === null);
  }

  section('Templates + CalendarEvent + toggle commercial (patch active)');
  {
    await createTemplate(prisma, { id: 't1', type: 'sms', title: 'Relance', subject: '', body: 'Coucou' });
    await createCalendarEvent(prisma, { id: 'e1', title: 'Réunion', date: '2026-06-10', category: 'reunion' });
    await updateCommercial(prisma, 'fred', { active: false });
    const s = await getState(prisma);
    check('template sms (subject "")', s.templates.length === 1 && s.templates[0].type === 'sms' && s.templates[0].subject === '');
    check('event mappé (time absent -> undefined)', s.calendarEvents.length === 1 && s.calendarEvents[0].time === undefined);
    check('toggle commercial : active=false', s.commercials[0].active === false);
    await deleteTemplate(prisma, 't1');
    check('template supprimé', (await getState(prisma)).templates.length === 0);
  }

  section('Garde d\'enum : valeur invalide rejetée (400)');
  {
    let rejected = false;
    try { await createLead(prisma, makeLead({ id: 'lx', status: 'zzz' as Lead['status'] })); } catch { rejected = true; }
    check('status invalide rejeté', rejected);
  }

  section('Validation zod — payloads INVALIDES refusés (400 clair) SANS écriture');
  {
    // Attend une HttpError au statut donné (400/404/409) ; échec si aucune erreur.
    async function expectStatus(status: number, label: string, fn: () => Promise<unknown>) {
      try { await fn(); check(label, false, 'aucune erreur levée'); }
      catch (e) {
        const he = e as { status?: number; message?: string };
        check(label, he.status === status, `status=${he.status} — ${he.message}`);
      }
    }
    const leadsBefore = (await getState(prisma)).leads.length;

    // Champ requis manquant (status retiré).
    const noStatus = makeLead({ id: 'vz1' }) as Record<string, unknown>;
    delete noStatus.status;
    await expectStatus(400, 'lead sans status -> 400', () => createLead(prisma, noStatus as unknown as Lead));
    // Type incohérent.
    await expectStatus(400, 'budget "abc" (string) -> 400', () => createLead(prisma, makeLead({ id: 'vz2', budget: 'abc' as unknown as number })));
    // Taille déraisonnable (bornes larges mais finies).
    await expectStatus(400, 'comments de 60 000 caractères -> 400', () => createLead(prisma, makeLead({ id: 'vz3', comments: 'x'.repeat(60_000) })));
    // Id mal formé.
    await expectStatus(400, "id 'a b!' mal formé -> 400", () => createLead(prisma, makeLead({ id: 'a b!' })));
    // Date mal formée.
    await expectStatus(400, "createdAt 'demain' -> 400", () => createLead(prisma, makeLead({ id: 'vz4', createdAt: 'demain' })));
    check('AUCUNE écriture sur les 5 refus (leads inchangés)', (await getState(prisma)).leads.length === leadsBefore);

    // Champ inconnu -> STRIPPÉ (tolérance, pas de rejet).
    const withExtra = { ...makeLead({ id: 'strip-1' }), foo: 'bar' } as unknown as Lead;
    const created = await createLead(prisma, withExtra);
    check('champ inconnu ignoré (strippé), création OK', created.id === 'strip-1' && !('foo' in (created as unknown as Record<string, unknown>)));
    // PATCH : l'id du corps est strippé -> jamais de renommage de clé primaire.
    await updateLead(prisma, 'strip-1', { id: 'HACKED', status: 'qualifie' } as Partial<Lead>);
    const afterPatch = await getState(prisma);
    check('PATCH ne renomme jamais la PK (id du corps strippé)',
      afterPatch.leads.some(l => l.id === 'strip-1' && l.status === 'qualifie') && !afterPatch.leads.some(l => l.id === 'HACKED'));
    await deleteLead(prisma, 'strip-1');

    // Autres entités.
    const noType = { id: 'va1', leadId: 'x', authorId: 'fred', date: '2026-06-05', result: '', notes: '' } as unknown as LeadAction;
    await expectStatus(400, 'action sans type -> 400', () => createAction(prisma, noType));
    await expectStatus(400, "commercial active:'true' (string) -> 400", () => createCommercial(prisma, { id: 'vc1', name: 'X', active: 'true' as unknown as boolean }));
    await expectStatus(400, 'commercial nom vide -> 400', () => createCommercial(prisma, { id: 'vc2', name: '', active: true }));
    await expectStatus(400, "événement date 'demain' -> 400", () => createCalendarEvent(prisma, { id: 've1', title: 'Réunion', date: 'demain' }));

    // Batchs : sémantique + forme + unicité intra-payload.
    const goalsBefore = JSON.stringify((await getState(prisma)).goals);
    await expectStatus(400, 'goal month 13 -> 400', () => saveGoals(prisma, [makeGoal({ id: 'vg1', month: 13 })]));
    await expectStatus(400, 'goals corps non-tableau -> 400 (plus de crash .map)', () => saveGoals(prisma, {} as unknown as CommercialGoal[]));
    await expectStatus(400, 'goals doublon (commercial, année, mois) -> 400',
      () => saveGoals(prisma, [makeGoal({ id: 'vg2' }), makeGoal({ id: 'vg3' })]));
    check('AUCUNE écriture goals sur refus', JSON.stringify((await getState(prisma)).goals) === goalsBefore);
    await expectStatus(400, 'stats doublon (année, mois, source) -> 400', () => saveMonthlyStats(prisma, [
      { id: 'vs1', year: 2026, month: 2, source: 'X', budget: null, leads: 1 },
      { id: 'vs2', year: 2026, month: 2, source: 'X', budget: null, leads: 2 },
    ]));
    await expectStatus(400, "defaultGoal revenue:'abc' -> 400", () => saveDefaultGoal(prisma, {
      prospectsCreated: null, coldCalls: null, followups: null, meetings: null,
      revenue: 'abc' as unknown as number, conversionRate: null,
    }));

    // NB : le mapping des erreurs Prisma (P2025 -> 404, P2002 -> 409) vit dans le
    // HANDLER (toHttpError), pas dans store -> testé dans la section Routage,
    // qui passe par le vrai chemin de prod.
  }

  section('Routage (catch-all api/[...slug].ts) : parse req.url comme Vercel');
  {
    // Le catch-all utilise le singleton _lib/prisma : on le fait viser la MÊME
    // base jetable (DATABASE_URL) et on active la garde par jeton, AVANT de
    // charger le module (import dynamique) pour que le singleton lise ces vars.
    process.env.API_SHARED_TOKEN = 'test-token';
    process.env.DATABASE_URL = DB_URL;
    const mod = await import('../api/[...slug].ts');
    const handler = mod.default as (req: VercelRequest, res: VercelResponse) => Promise<void>;
    const TOK = 'test-token';

    type Captured = { statusCode: number; payload: unknown; ended: boolean };
    // On passe par req.URL (forme réelle Vercel), PAS req.query.slug : c'est le
    // mécanisme exact de prod -> plus de décalage test-vert / prod-cassée.
    async function call(method: string, url: string, opts: { token?: string; body?: unknown } = {}): Promise<Captured> {
      const cap: Captured = { statusCode: 0, payload: undefined, ended: false };
      const res = {
        status(s: number) { cap.statusCode = s; return res; },
        json(d: unknown) { cap.payload = d; cap.ended = true; return res; },
        end() { cap.ended = true; return res; },
        setHeader() { return res; },
      };
      const req = { method, url, headers: { authorization: opts.token ? `Bearer ${opts.token}` : undefined }, body: opts.body };
      await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);
      return cap;
    }
    const invoke = (method: string, slug: string[], opts: { token?: string; body?: unknown; query?: string } = {}) =>
      call(method, '/api/' + slug.join('/') + (opts.query ?? ''), opts);

    const r401 = await invoke('GET', ['state']);
    check('GET /api/state SANS jeton -> 401', r401.statusCode === 401);

    const rPost = await invoke('POST', ['leads'], { token: TOK, body: makeLead({ id: 'route-1', commercialId: 'fred' }) });
    check('POST /api/leads -> 201', rPost.statusCode === 201);
    check('POST /api/leads renvoie le lead créé', (rPost.payload as Lead)?.id === 'route-1');

    const rState = await invoke('GET', ['state'], { token: TOK });
    check('GET /api/state -> 200', rState.statusCode === 200);
    check('state contient bien route-1', (rState.payload as { leads: Lead[] }).leads.some(l => l.id === 'route-1'));

    // Robustesse du parsing : query string ignorée, préfixe /api optionnel.
    const rQuery = await invoke('GET', ['state'], { token: TOK, query: '?ts=123&x=y' });
    check('GET /api/state?ts=123 -> 200 (query string ignorée)', rQuery.statusCode === 200);
    const rNoApi = await call('GET', '/state', { token: TOK });
    check('GET /state (sans préfixe /api) -> 200 (parsing robuste)', rNoApi.statusCode === 200);

    const rPatch = await invoke('PATCH', ['leads', 'route-1'], { token: TOK, body: { status: 'devis_envoye' } });
    check('PATCH /api/leads/:id -> 200 + maj', rPatch.statusCode === 200 && (rPatch.payload as Lead).status === 'devis_envoye');

    const rDel = await invoke('DELETE', ['leads', 'route-1'], { token: TOK });
    check('DELETE /api/leads/:id -> 204 (vide)', rDel.statusCode === 204 && rDel.ended && rDel.payload === undefined);

    const rGoals = await invoke('PUT', ['goals'], { token: TOK, body: [] });
    check('PUT /api/goals (batch) -> 200', rGoals.statusCode === 200);

    const r405 = await invoke('GET', ['nope'], { token: TOK });
    check('GET /api/nope -> 405 (route inconnue)', r405.statusCode === 405);

    const r405b = await invoke('GET', ['leads'], { token: TOK });
    check('GET /api/leads -> 405 (méthode non gérée sur route connue)', r405b.statusCode === 405);

    const r405c = await invoke('DELETE', ['commercials', 'fred'], { token: TOK });
    check('DELETE /api/commercials/:id -> 405 (non supporté)', r405c.statusCode === 405);

    // Corps JSON malformé (string non parsable) -> 400 propre (SyntaxError mappée).
    const rBadJson = await invoke('POST', ['leads'], { token: TOK, body: '{oops' });
    check('POST corps JSON malformé -> 400 (pas 500)', rBadJson.statusCode === 400);

    // Mapping erreurs Prisma via le handler (vrai chemin de prod) :
    const r404 = await invoke('PATCH', ['leads', 'inexistant-xyz'], { token: TOK, body: { status: 'contacte' } });
    check('PATCH id inexistant -> 404 (P2025 mappée)', r404.statusCode === 404);
    const r409 = await invoke('POST', ['commercials'], { token: TOK, body: { id: 'fred', name: 'Doublon', active: true } });
    check('POST id déjà existant -> 409 (P2002 mappée)', r409.statusCode === 409);
    const rBadPayload = await invoke('POST', ['leads'], { token: TOK, body: { id: 'zz', status: 'zzz' } });
    check('POST payload invalide via handler -> 400 zod', rBadPayload.statusCode === 400);
  }

  section('Import en masse (bulkImport) : atomique, idempotent, rollback');
  {
    const before = await getState(prisma);
    const comBefore = before.commercials.length;
    const leadsBefore = before.leads.length;
    // 'Fred' (id 'fred') existe déjà (créé plus haut) : servira à tester la
    // résolution PAR NOM d'un commercial préexistant, absent de la liste à créer.

    // 1) Import valide : crée les manquants (Tom, Non attribué), résout Fred existant.
    const rep = await bulkImport(prisma, {
      commercials: ['Tom', 'Non attribué'],
      leads: [
        { ...importLead({ lastName: 'ImpA' }), commercialName: 'Tom' },
        { ...importLead({ lastName: 'ImpB' }), commercialName: 'Non attribué' },
        { ...importLead({ lastName: 'ImpC' }), commercialName: 'Fred' },
      ],
    });
    check('compte-rendu : 2 commerciaux créés, 3 leads', rep.commercialsCreated === 2 && rep.leadsCreated === 3, JSON.stringify(rep));
    const v = await getState(prisma);
    check('commerciaux +2 / leads +3', v.commercials.length === comBefore + 2 && v.leads.length === leadsBefore + 3);
    const fredId = v.commercials.find(c => c.name === 'Fred')?.id;
    const tomId = v.commercials.find(c => c.name === 'Tom')?.id;
    check('résolution PAR NOM : ImpC -> id de Fred existant', v.leads.some(l => l.lastName === 'ImpC' && l.commercialId === fredId));
    check('ImpA -> commercial Tom nouvellement créé', v.leads.some(l => l.lastName === 'ImpA' && l.commercialId === tomId));

    // 2) Idempotence : réimport ne recrée pas Tom.
    const rep2 = await bulkImport(prisma, {
      commercials: ['Tom'],
      leads: [{ ...importLead({ lastName: 'ImpD' }), commercialName: 'Tom' }],
    });
    check('idempotent : 0 créé, 1 déjà présent', rep2.commercialsCreated === 0 && rep2.commercialsExisting === 1, JSON.stringify(rep2));
    check('pas de doublon Tom (un seul)', (await getState(prisma)).commercials.filter(c => c.name === 'Tom').length === 1);

    // 3) Rollback : une entité invalide -> RIEN écrit (même le lead valide du lot).
    const b3 = await getState(prisma);
    let rejected3 = false;
    try {
      await bulkImport(prisma, {
        commercials: [],
        leads: [
          { ...importLead({ lastName: 'ImpOK' }), commercialName: 'Tom' },
          { ...importLead({ lastName: 'ImpBAD', status: 'zzz' as Lead['status'] }), commercialName: 'Tom' },
        ],
      });
    } catch { rejected3 = true; }
    check('entité invalide -> rejet', rejected3);
    check('ROLLBACK : aucun lead écrit (ni ImpOK ni ImpBAD)', (await getState(prisma)).leads.length === b3.leads.length);

    // 4) Nom de commercial introuvable -> rejet + rollback.
    const b4 = await getState(prisma);
    let rejected4 = false;
    try {
      await bulkImport(prisma, { commercials: [], leads: [{ ...importLead({ lastName: 'ImpZ' }), commercialName: 'Fantome' }] });
    } catch { rejected4 = true; }
    check('commercial introuvable -> rejet', rejected4);
    check('ROLLBACK : aucun lead écrit', (await getState(prisma)).leads.length === b4.leads.length);
  }

  section('Restauration (restoreBackup) : remplacement total, id-préservant, rollback');
  {
    // Normalisation ordre-indépendante (tri par id) pour comparer deux AppState.
    const norm = (s: AppState) => JSON.stringify({
      leads: [...s.leads].sort((a, b) => a.id.localeCompare(b.id)),
      actions: [...s.actions].sort((a, b) => a.id.localeCompare(b.id)),
      commercials: [...s.commercials].sort((a, b) => a.id.localeCompare(b.id)),
      templates: [...s.templates].sort((a, b) => a.id.localeCompare(b.id)),
      calendarEvents: [...s.calendarEvents].sort((a, b) => a.id.localeCompare(b.id)),
      goals: [...s.goals].sort((a, b) => a.id.localeCompare(b.id)),
      monthlyStats: [...s.monthlyStats].sort((a, b) => a.id.localeCompare(b.id)),
      defaultGoal: s.defaultGoal,
    });

    const snap: AppState = {
      commercials: [
        { id: 'com-a', name: 'Alice', active: true },
        { id: 'com-b', name: 'Bob', active: false },
      ],
      leads: [
        makeLead({ id: 'ld-1', commercialId: 'com-a' }),
        makeLead({ id: 'ld-2', commercialId: 'com-b', status: 'signe' }),
      ],
      actions: [makeAction({ id: 'ac-1', leadId: 'ld-1', authorId: 'com-a' })],
      templates: [{ id: 'tp-1', type: 'email', title: 'T', subject: 'S', body: 'B' }],
      calendarEvents: [{ id: 'ev-1', title: 'Réunion', date: '2026-06-10', category: 'reunion' }],
      goals: [makeGoal({ id: 'gl-1', commercialId: 'com-a' })],
      monthlyStats: [{ id: 'ms-1', year: 2026, month: 3, source: 'LBC', budget: 100, leads: 5 }],
      defaultGoal: { prospectsCreated: 7, coldCalls: null, followups: null, meetings: null, revenue: null, conversionRate: null },
    };

    // 1) Restauration : la base (peuplée par les sections précédentes) est REMPLACÉE.
    const rep = await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: snap });
    check('compte-rendu par entité', rep.leads === 2 && rep.commercials === 2 && rep.actions === 1 && rep.goals === 1);
    const s1 = await getState(prisma);
    check('base REMPLACÉE (exactement le snapshot)',
      s1.leads.length === 2 && s1.commercials.length === 2 && s1.actions.length === 1 &&
      s1.templates.length === 1 && s1.calendarEvents.length === 1 && s1.monthlyStats.length === 1 && s1.goals.length === 1);
    check('ids PRÉSERVÉS + relations (action -> lead + author)',
      s1.actions[0].leadId === 'ld-1' && s1.actions[0].authorId === 'com-a' &&
      s1.leads.some(l => l.id === 'ld-1' && l.commercialId === 'com-a'));
    check('commercial INACTIF restauré tel quel', s1.commercials.some(c => c.id === 'com-b' && c.active === false));
    check('defaultGoal restauré', s1.defaultGoal.prospectsCreated === 7);

    // 2) Round-trip : restore(getState) reproduit l'état à l'identique.
    const before = await getState(prisma);
    await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: before });
    check('round-trip identique (getState -> restore -> getState)', norm(await getState(prisma)) === norm(before));

    // 3) Fichier invalide -> rejet + ROLLBACK (base INCHANGÉE) : le test critique.
    const b3 = await getState(prisma);
    let rej3 = false;
    try {
      await restoreBackup(prisma, { format: 'bob-crm-backup', version: 1, data: { ...snap, leads: [makeLead({ id: 'bad', commercialId: 'com-a', status: 'zzz' as Lead['status'] })] } });
    } catch { rej3 = true; }
    check('entité invalide -> rejet', rej3);
    check('ROLLBACK : base strictement inchangée', norm(await getState(prisma)) === norm(b3));

    // 4) Enveloppe : mauvais format / version -> 400, aucune écriture.
    const b4 = await getState(prisma);
    let badFmt = false;
    try { await restoreBackup(prisma, { format: 'autre', version: 1, data: snap }); } catch (e) { badFmt = (e as { status?: number }).status === 400; }
    check('format inconnu -> 400', badFmt);
    let badVer = false;
    try { await restoreBackup(prisma, { format: 'bob-crm-backup', version: 2, data: snap }); } catch (e) { badVer = (e as { status?: number }).status === 400; }
    check('version > 1 -> 400', badVer);
    check('enveloppe refusée -> base inchangée', norm(await getState(prisma)) === norm(b4));

    // 5) Chemin HTTP complet (handler -> dispatch -> restoreBackup). L'env a été
    // posé par la section Routage (API_SHARED_TOKEN + DATABASE_URL) ; cette section
    // est la DERNIÈRE (le remplacement final ne gêne aucune autre).
    const mod = await import('../api/[...slug].ts');
    const handler = mod.default as (req: VercelRequest, res: VercelResponse) => Promise<void>;
    async function callRestore(token: string | undefined, bdy: unknown) {
      const cap = { statusCode: 0, payload: undefined as unknown };
      const res = {
        status(s: number) { cap.statusCode = s; return res; },
        json(dd: unknown) { cap.payload = dd; return res; },
        end() { return res; }, setHeader() { return res; },
      };
      const req = { method: 'POST', url: '/api/restore', headers: { authorization: token ? `Bearer ${token}` : undefined }, body: bdy };
      await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);
      return cap;
    }
    const rHttp = await callRestore('test-token', { format: 'bob-crm-backup', version: 1, data: snap });
    check('POST /api/restore -> 201 + compte-rendu', rHttp.statusCode === 201 && (rHttp.payload as { leads: number }).leads === 2);
    const rHttpNoTok = await callRestore(undefined, {});
    check('POST /api/restore SANS jeton -> 401', rHttpNoTok.statusCode === 401);
  }

  await prisma.$disconnect();
  try { rmSync(DB_FILE, { force: true }); } catch { /* ignore */ }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais API : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  console.log(failed === 0 ? 'Tous les invariants tiennent. ✅' : 'ÉCHECS détectés. ❌');
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Harnais API — erreur fatale :', e); process.exit(1); });
