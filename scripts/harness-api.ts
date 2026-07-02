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
  saveGoals, saveMonthlyStats, saveDefaultGoal,
} from '../api/_lib/store';
import type { Lead, LeadAction, CommercialGoal } from '../src/data/types';
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

  section('Routage (catch-all api/[...slug].ts) : mêmes URLs, mêmes réponses, garde');
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
    async function invoke(method: string, slug: string[], opts: { token?: string; body?: unknown } = {}): Promise<Captured> {
      const cap: Captured = { statusCode: 0, payload: undefined, ended: false };
      const res = {
        status(s: number) { cap.statusCode = s; return res; },
        json(d: unknown) { cap.payload = d; cap.ended = true; return res; },
        end() { cap.ended = true; return res; },
        setHeader() { return res; },
      };
      const req = { method, query: { slug }, headers: { authorization: opts.token ? `Bearer ${opts.token}` : undefined }, body: opts.body };
      await handler(req as unknown as VercelRequest, res as unknown as VercelResponse);
      return cap;
    }

    const r401 = await invoke('GET', ['state']);
    check('GET /api/state SANS jeton -> 401', r401.statusCode === 401);

    const rPost = await invoke('POST', ['leads'], { token: TOK, body: makeLead({ id: 'route-1', commercialId: 'fred' }) });
    check('POST /api/leads -> 201', rPost.statusCode === 201);
    check('POST /api/leads renvoie le lead créé', (rPost.payload as Lead)?.id === 'route-1');

    const rState = await invoke('GET', ['state'], { token: TOK });
    check('GET /api/state -> 200', rState.statusCode === 200);
    check('state contient bien route-1', (rState.payload as { leads: Lead[] }).leads.some(l => l.id === 'route-1'));

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
  }

  await prisma.$disconnect();
  try { rmSync(DB_FILE, { force: true }); } catch { /* ignore */ }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais API : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  console.log(failed === 0 ? 'Tous les invariants tiennent. ✅' : 'ÉCHECS détectés. ❌');
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Harnais API — erreur fatale :', e); process.exit(1); });
