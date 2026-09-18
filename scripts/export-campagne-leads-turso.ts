/**
 * LOT SALONS — export / réimport des PARTICIPATIONS, à part du reste.
 *
 * Pourquoi : à partir du déploiement de S2, revenir à un tag ANTÉRIEUR au lot
 * salons n'est plus un retour arrière sûr. L'ancien code ignore `campagnes` et
 * `campagne_leads` : « Restaurer » les efface par cascade, et une sauvegarde
 * prise avec l'ancien code ne les contient pas. Ce script est le filet : on
 * sort les participations dans un fichier AVANT, on les remet APRÈS.
 *
 * Exécution (cible TOUJOURS explicite, même verrou que les migrations) :
 *   export (lecture seule) :
 *     npx tsx scripts/export-campagne-leads-turso.ts --target=prod --out=participations.json
 *   réimport (écriture) :
 *     BOB_CONFIRM_PROD=bob-brestoceanboat npx tsx scripts/export-campagne-leads-turso.ts \
 *       --target=prod --in=participations.json --apply
 *
 * Le réimport est IDEMPOTENT : une participation déjà présente (même campagne,
 * même lead) est ignorée, jamais dupliquée — c'est l'index unique qui tranche.
 * Il ne crée ni lead ni commercial ni campagne : si l'un manque, il le DIT et
 * n'écrit pas cette ligne (mieux qu'une ligne fantôme).
 *
 * Ce script ne touche JAMAIS à `leads` : la source d'un lead reste immuable.
 */
import { createClient, type Client } from '@libsql/client';
import { readFileSync, writeFileSync } from 'node:fs';
import { guardDbTarget } from './lib/dbTarget';

const COLONNES = ['id', 'campagneId', 'leadId', 'responsableId', 'segment', 'priorite', 'statutCampagne', 'bateauxAVoir', 'notes'] as const;

function flag(name: string): string | undefined {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : '';
}

async function rows(db: Client, sql: string): Promise<Record<string, unknown>[]> {
  return (await db.execute(sql)).rows.map(r => ({ ...r }));
}

async function main() {
  const fichierOut = flag('out');
  const fichierIn = flag('in');
  if (!fichierOut && !fichierIn) {
    console.error('Préciser --out=<fichier> (export) ou --in=<fichier> (réimport).');
    process.exit(1);
  }
  // Export = lecture seule ; réimport = écriture (donc --apply + BOB_CONFIRM_PROD en prod).
  const guard = guardDbTarget({ scriptName: 'export-campagne-leads-turso', write: !!fichierIn });
  if (!guard) process.exit(1);
  const { target, apply } = guard;
  const db = createClient(target.kind === 'prod' ? { url: target.url, authToken: target.authToken } : { url: target.url });

  if (fichierOut) {
    const participations = await rows(db, `SELECT ${COLONNES.map(c => `"${c}"`).join(', ')} FROM campagne_leads ORDER BY "createdAt"`);
    const campagnes = await rows(db, 'SELECT * FROM campagnes ORDER BY "dateDebut"');
    const enveloppe = { format: 'bob-campagne-leads', version: 1, exporteLe: new Date().toISOString(), campagnes, participations };
    writeFileSync(fichierOut, JSON.stringify(enveloppe, null, 2), 'utf-8');
    console.log(`\n✅ ${participations.length} participation(s) et ${campagnes.length} campagne(s) écrites dans ${fichierOut}`);
    console.log('   (lecture seule : rien n\'a été modifié)');
    db.close();
    return;
  }

  const enveloppe = JSON.parse(readFileSync(fichierIn!, 'utf-8')) as { format?: string; participations?: Record<string, unknown>[] };
  if (enveloppe.format !== 'bob-campagne-leads') { console.error('Fichier non reconnu (format attendu : bob-campagne-leads).'); process.exit(1); }
  const liste = enveloppe.participations ?? [];
  const leads = new Set((await rows(db, 'SELECT id FROM leads')).map(r => String(r.id)));
  const commerciaux = new Set((await rows(db, 'SELECT id FROM commercials')).map(r => String(r.id)));
  const campagnes = new Set((await rows(db, 'SELECT id FROM campagnes')).map(r => String(r.id)));
  const refusees = liste.filter(p => !leads.has(String(p.leadId)) || !commerciaux.has(String(p.responsableId)) || !campagnes.has(String(p.campagneId)));
  const aEcrire = liste.filter(p => !refusees.includes(p));

  console.log(`\nFichier : ${liste.length} participation(s)`);
  console.log(`À réimporter : ${aEcrire.length} · refusées (lead, responsable ou campagne absent) : ${refusees.length}`);
  for (const p of refusees.slice(0, 10)) console.log(`  ✗ ${String(p.id)} — lead ${String(p.leadId)} / responsable ${String(p.responsableId)} / campagne ${String(p.campagneId)}`);

  if (!apply) { console.log('\nÀ blanc : rien n\'a été écrit. Relancer avec --apply (et, en prod, BOB_CONFIRM_PROD).'); db.close(); return; }

  const avant = Number((await rows(db, 'SELECT COUNT(*) n FROM campagne_leads'))[0].n);
  for (const p of aEcrire) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO campagne_leads (${COLONNES.map(c => `"${c}"`).join(', ')}, "updatedAt") VALUES (${COLONNES.map(() => '?').join(', ')}, CURRENT_TIMESTAMP)`,
      args: COLONNES.map(c => (p[c] ?? '') as string),
    });
  }
  const apres = Number((await rows(db, 'SELECT COUNT(*) n FROM campagne_leads'))[0].n);
  const leadsApres = Number((await rows(db, 'SELECT COUNT(*) n FROM leads'))[0].n);
  db.close();
  console.log(`\n— Preuve —`);
  console.log(`  ✅ participations : ${avant} → ${apres} (+${apres - avant}) ; les doublons éventuels ont été ignorés`);
  console.log(`  ✅ leads : ${leadsApres}, jamais écrits par ce script`);
  console.log('\n✅ Réimport terminé.');
}

if (process.argv[1]?.includes('export-campagne-leads-turso')) {
  main().catch(e => { console.error('Échec :', e); process.exit(1); });
}
