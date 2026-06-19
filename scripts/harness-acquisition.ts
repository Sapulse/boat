/**
 * Harnais acquisition (lot refonte-acquisition, etape 1).
 *
 * Execution : npx tsx scripts/harness-acquisition.ts
 * (hors tsc -b et hors bundle Vite, comme les autres harnais.)
 *
 * Couvre la logique PURE de fusion / CPL (lib/acquisition) :
 *  - computeCpl : derivation budget/leads, arrondi, cas null / 0 lead ;
 *  - mergeAcquisition : repli des volumes dans les stats (leads=leadCount,
 *    budget=null), SANS PERTE (conservation du compte), IDEMPOTENT (re-fusion
 *    sans doublon), collision (annee/mois/source) -> la stat existante prime,
 *    cas realiste 7 regies + 11 plateformes disjointes.
 */

import { computeCpl, mergeAcquisition } from '../src/lib/acquisition';
import type { MonthlyStat, AcquisitionVolume } from '../src/data/types';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✔ ${label}`);
  } else {
    failed++;
    console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n— ${title}`);
}

function stat(over: Partial<MonthlyStat> = {}): MonthlyStat {
  return {
    id: 's1', year: 2026, month: 1, source: 'Google Ads',
    budget: 1000, leads: 10, cpl: 100, ...over,
  };
}

function vol(over: Partial<AcquisitionVolume> = {}): AcquisitionVolume {
  return { id: 'v1', year: 2026, month: 1, source: 'Youboat', leadCount: 5, ...over };
}

// ---------------------------------------------------------------------------
section('computeCpl — derivation pure');
{
  check('budget/leads arrondi', computeCpl(1000, 10) === 100);
  check('arrondi a l\'euro', computeCpl(1000, 3) === 333, `got ${computeCpl(1000, 3)}`);
  check('0 lead -> null (pas de division)', computeCpl(1000, 0) === null);
  check('leads null -> null', computeCpl(1000, null) === null);
  check('budget null -> null', computeCpl(null, 10) === null);
  check('budget 0 valide -> 0', computeCpl(0, 10) === 0, `got ${computeCpl(0, 10)}`);
}

// ---------------------------------------------------------------------------
section('mergeAcquisition — repli sans perte');
{
  const volumes = [vol()];
  const out = mergeAcquisition([], volumes);
  check('1 volume -> 1 stat', out.length === 1);
  const f = out[0];
  check('leadCount -> leads', f.leads === 5);
  check('budget = null (plateforme)', f.budget === null);
  check('cpl derive = null (pas de budget)', f.cpl === null);
  check('source / annee / mois preserves', f.source === 'Youboat' && f.year === 2026 && f.month === 1);
}

// ---------------------------------------------------------------------------
section('mergeAcquisition — conservation du compte (disjoint)');
{
  const stats = [stat({ source: 'Google Ads' }), stat({ id: 's2', source: 'Instapage' })];
  const volumes = [vol({ source: 'Youboat' }), vol({ id: 'v2', source: 'Inautia' })];
  const out = mergeAcquisition(stats, volumes);
  check('total = stats + volumes (aucune perte)', out.length === 4, `got ${out.length}`);
  check('stats existantes intactes (budget conserve)',
    out.filter(s => s.budget === 1000).length === 2);
  check('volumes replies presents',
    out.some(s => s.source === 'Youboat' && s.leads === 5) &&
    out.some(s => s.source === 'Inautia' && s.leads === 5));
}

// ---------------------------------------------------------------------------
section('mergeAcquisition — idempotence');
{
  const stats = [stat()];
  const volumes = [vol()];
  const once = mergeAcquisition(stats, volumes);
  const twiceEmpty = mergeAcquisition(once, []);     // re-hydratation : volumes vides
  check('re-hydrater (volumes=[]) ne change rien', twiceEmpty.length === once.length);
  const reRun = mergeAcquisition(once, volumes);      // re-fusion des MEMES volumes
  check('re-fusion des memes volumes -> aucun doublon', reRun.length === once.length,
    `got ${reRun.length} vs ${once.length}`);
}

// ---------------------------------------------------------------------------
section('mergeAcquisition — collision (meme annee/mois/source)');
{
  const stats = [stat({ source: 'Le Bon Coin', budget: 800, leads: 8, cpl: 100 })];
  const volumes = [vol({ source: 'Le Bon Coin', leadCount: 99 })]; // meme cle
  const out = mergeAcquisition(stats, volumes);
  check('collision -> pas de doublon', out.length === 1);
  check('collision -> stat existante prime (leads 8, budget 800)',
    out[0].leads === 8 && out[0].budget === 800);
  // doublons internes aux volumes
  const dupVols = [vol({ source: 'X' }), vol({ id: 'v9', source: 'X' })];
  check('doublons internes aux volumes -> 1 seul replie', mergeAcquisition([], dupVols).length === 1);
}

// ---------------------------------------------------------------------------
section('Cas realiste — 7 regies + 11 plateformes (1 mois)');
{
  const stats: MonthlyStat[] = Array.from({ length: 7 }, (_, i) =>
    stat({ id: `s${i}`, source: `Regie${i}`, budget: 500, leads: 10, cpl: 50 }));
  const volumes: AcquisitionVolume[] = Array.from({ length: 11 }, (_, i) =>
    vol({ id: `v${i}`, source: `Plateforme${i}`, leadCount: 3 }));
  const out = mergeAcquisition(stats, volumes);
  check('18 lignes apres fusion', out.length === 18, `got ${out.length}`);
  const totalLeads = out.reduce((s, r) => s + (r.leads ?? 0), 0);
  check('total leads = 7*10 + 11*3 = 103 (aucune perte)', totalLeads === 103, `got ${totalLeads}`);
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais acquisition : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Tous les invariants tiennent. ✅');
}
