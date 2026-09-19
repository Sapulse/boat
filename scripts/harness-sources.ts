/**
 * Harnais lot 3 — normalisation des sources (src/lib/sources.ts) + table de fusion.
 * Exécution : npx tsx scripts/harness-sources.ts
 */
import { normalizeSource, referenceSource, sourceKey } from '../src/lib/sources';
import { SOURCE_FUSION, planSourceFusion, sourceDistribution, leadColumnsExceptSource, applySourceFusion, proveSourceFusion } from './fusion-sources-turso';
import { fingerprint } from './apply-planned-actions-turso';
import { createClient } from '@libsql/client';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { SOURCES, PROSPECTION_SOURCES, isSourceSalon } from '../src/data/constants';
import { dbJetable } from './lib/dbJetable';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
const eq = (input: string, expected: string) => check(`« ${input} » -> « ${expected} »`, normalizeSource(input) === expected, normalizeSource(input));

console.log('\n— Casse, accents, espaces, ponctuation');
eq('Site BOB', 'Site BOB');
eq('  site   bob ', 'Site BOB');
eq('SALON GP', 'Salon – Grand Pavois'); // ancien libellé, désormais alias (lot salons, S0)
eq('annonces du bateau', 'Annonces du bateau');
eq('demarchage-terrain', 'Démarchage terrain');
eq('BOATS.COM', 'boats.com');
eq('lbc', 'LBC');

console.log('\n— Adresses web');
eq('http://topbarcos.com/', 'Top barcos');
eq('TopBarcos.com', 'Top barcos');
eq('https://www.inautia.es/annonce/123', 'Inautia');
eq('www.yachtworld.com', 'Yachtworld');

console.log('\n— Alias');
eq('LEBONCOIN', 'LBC');
eq('Le Bon Coin', 'LBC');
eq('leboncoin.fr', 'LBC');

console.log('\n— BoatsGroup : référence à part, jamais boats.com');
eq('BoatsGroup', 'BoatsGroup');
eq('boats group', 'BoatsGroup');
check('boats.com ne devient jamais BoatsGroup', normalizeSource('boats.com') === 'boats.com');
check('BoatsGroup n\'est pas un alias de boats.com', referenceSource('BoatsGroup') === 'BoatsGroup');

console.log('\n— Inconnu : gardé, nettoyé ; vide');
eq('  Salon de Paris  2026 ', 'Salon de Paris 2026');
eq('Instagram', 'Instagram');
check('vide -> vide', normalizeSource('   ') === '' && normalizeSource(undefined) === '' && normalizeSource(null) === '');
check('« Annonce du bateau » (nom des stats mensuelles) n\'est pas modifié en silence', normalizeSource('Annonce du bateau') === 'Annonce du bateau');

console.log('\n— Liste de référence');
// --- Lot salons (S0) : libellés SANS millésime, anciens libellés en alias ---
eq('Salon GP', 'Salon – Grand Pavois');
eq('salon gp', 'Salon – Grand Pavois');
eq('GP', 'Salon – Grand Pavois');
eq('gp 2026', 'Salon – Grand Pavois');
eq('Grand Pavois', 'Salon – Grand Pavois');
eq('grand  pavois', 'Salon – Grand Pavois');
eq('pavois', 'Salon – Grand Pavois');
eq('Salon CAN', 'Salon – Cannes');
eq('Cannes', 'Salon – Cannes');
eq('cannes ', 'Salon – Cannes');
eq('Salon PRS', 'Salon – Nautique Paris');
eq('Paris 2026', 'Salon – Nautique Paris');
eq('La Rochelle 2026', 'Salon – Nautique La Rochelle');
eq('Salon – Grand Pavois', 'Salon – Grand Pavois');
check('les 4 salons sont dans SOURCES', ['Salon – Grand Pavois', 'Salon – Cannes', 'Salon – Nautique Paris', 'Salon – Nautique La Rochelle'].every(s => (SOURCES as readonly string[]).includes(s)));
check("aucun libellé de salon ne porte d'année (le millésime est celui de la campagne)",
  (SOURCES as readonly string[]).filter(isSourceSalon).every(s => !/\d{4}/.test(s)));
check('le préfixe « Salon – » identifie exactement les 4 salons',
  (SOURCES as readonly string[]).filter(isSourceSalon).length === 4);
check('INVARIANT : PROSPECTION_SOURCES reste un sous-ensemble de SOURCES (les salons compris)',
  PROSPECTION_SOURCES.every(s => (SOURCES as readonly string[]).includes(s)));
check('les 4 salons comptent comme prospection active (objectif « leads rentrés »)',
  (SOURCES as readonly string[]).filter(isSourceSalon).every(s => PROSPECTION_SOURCES.includes(s)));
// Pas de faux positif : la comparaison porte sur la chaîne ENTIÈRE.
check("« GPS » n'est PAS capté par l'alias « gp »", normalizeSource('GPS') === 'GPS');
check("« Cannes-la-Bocca » n'est PAS capté par l'alias « cannes »", normalizeSource('Cannes-la-Bocca') === 'Cannes-la-Bocca');
check("« Paris » seul reste inchangé (l'alias est « paris 2026 »)", normalizeSource('Paris') === 'Paris');

// Concessionnaire (19/09) — apporteur d'affaires, hors groupe Salon.
check('« Concessionnaire » est une source de référence', (SOURCES as readonly string[]).includes('Concessionnaire'));
check('« Concessionnaire » compte comme prospection active', PROSPECTION_SOURCES.includes('Concessionnaire'));
check("« Concessionnaire » n'est PAS dans le groupe Salon", !isSourceSalon('Concessionnaire'));
eq('concessionnaire', 'Concessionnaire');
eq('Concessionnaires', 'Concessionnaire');
eq('CONCESSION', 'Concessionnaire');
eq('apporteur', 'Concessionnaire');
eq("Apporteur d'affaires", 'Concessionnaire');
check("« Concession Beneteau » n'est PAS capté (chaîne entière, pas sous-chaîne)", normalizeSource('Concession Beneteau') === 'Concession Beneteau');

check('toutes les sources de référence sont stables (idempotent)', SOURCES.every(s => normalizeSource(s) === s));
check('clés de référence toutes distinctes (pas d\'ambiguïté)', new Set(SOURCES.map(sourceKey)).size === SOURCES.length);
check('BoatsGroup fait partie de la liste de référence', (SOURCES as readonly string[]).includes('BoatsGroup'));

console.log('\n— Table de fusion (script, décision du 17/09)');
check('une seule correspondance : http://topbarcos.com/ -> Top barcos', SOURCE_FUSION.length === 1 && SOURCE_FUSION[0].from === 'http://topbarcos.com/' && SOURCE_FUSION[0].to === 'Top barcos');
check('BoatsGroup absent de la table', SOURCE_FUSION.every(m => m.from !== 'BoatsGroup' && m.to !== 'boats.com'));
check('chaque cible est une source de référence', SOURCE_FUSION.every(m => (SOURCES as readonly string[]).includes(m.to)));
const plan = planSourceFusion([{ source: 'LBC', n: 82 }, { source: 'http://topbarcos.com/', n: 1 }, { source: 'Top barcos', n: 1 }, { source: 'BoatsGroup', n: 60 }]);
check('plan : 1 lead à modifier', plan.changes.length === 1 && plan.changes[0].n === 1);
check('plan : répartition après = Top barcos 2, BoatsGroup 60 inchangé, total identique', plan.after.get('Top barcos') === 2 && plan.after.get('BoatsGroup') === 60 && !plan.after.has('http://topbarcos.com/') && [...plan.after.values()].reduce((a, b) => a + b, 0) === 144);
check('plan rejoué sur la répartition d\'après : rien à faire', planSourceFusion([...plan.after].map(([source, n]) => ({ source, n }))).changes.length === 0);

console.log('\n— Script de fusion sur base SQLite jetable (jamais Turso)');
{
  const file = dbJetable('harness-sources-fusion');
  rmSync(file, { force: true });
  const db = createClient({ url: `file:${file}` });
  await db.executeMultiple(readFileSync(path.join('prisma/migrations', readdirSync('prisma/migrations').find(d => d.endsWith('_init_crm_schema'))!, 'migration.sql'), 'utf-8'));
  await db.execute(`INSERT INTO commercials (id, name, active, createdAt, updatedAt) VALUES ('tom', 'Tom', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
  const sources = ['LBC', 'http://topbarcos.com/', 'Top barcos', 'BoatsGroup', 'BoatsGroup', 'boats.com'];
  for (const [i, s] of sources.entries()) {
    await db.execute({ sql: `INSERT INTO leads (id, createdAt, updatedAt, source, commercialId, firstName, lastName, phone, email, boatType, boatCondition, boatInterest, brand, status, contactDate, currentBoat, comments, deliveryDate, temperature, priority, nextActionType, nextActionDate, lastActionDate, lossReason, signedAt, lostAt, reportedAt) VALUES (?, '2026-08-01', '2026-09-16T08:00:00Z', ?, 'tom', 'P', ?, '', '', '', '', '', '', 'contacte', '', '', '', '', 'neutre', 'normale', '', '', '', '', '', '', '')`, args: [`l${i}`, s, `N${i}`] });
  }
  const dist = await sourceDistribution(db);
  const plan = planSourceFusion(dist);
  const columns = await leadColumnsExceptSource(db);
  check('colonnes comparées : toutes sauf source', !columns.includes('source') && columns.includes('updatedAt') && columns.includes('lastName'));
  const before = { others: await fingerprint(db, 'leads', columns), columns };
  const n = await applySourceFusion(db);
  check('fusion : 1 lead modifié', n === 1);
  for (const c of await proveSourceFusion(db, before, plan.after)) check(`preuve : ${c.label}`, c.ok, c.detail);
  check('rejeu : 0 ligne', (await applySourceFusion(db)) === 0);
  check('updatedAt des leads non touché par la fusion', Number((await db.execute(`SELECT COUNT(*) n FROM leads WHERE updatedAt = '2026-09-16T08:00:00Z'`)).rows[0].n) === 6);
  db.close();
  try { rmSync(file, { force: true }); } catch { /* verrou Windows : fichier ignoré par git */ }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais sources : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
