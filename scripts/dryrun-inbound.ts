/**
 * TEST À BLANC du pipeline d'import email (Option C — validation humaine).
 *
 * Exécution : npx tsx scripts/dryrun-inbound.ts [--days N]   (défaut : 7)
 *
 * Montre ce que le robot AURAIT importé : collecte réelle (LECTURE SEULE,
 * Inbox, 4 familles, fenêtre de N jours, cap 50) -> parseEmail -> file triée
 * par score, exactement comme l'écran « Boîte de réception prospects ».
 *
 * N'ÉCRIT RIEN : ni base (aucun client Prisma/Turso importé), ni Outlook
 * (Mail.Read app-only, aucune écriture possible), ni fichier.
 */
import 'dotenv/config';
import { readGraphEnv } from '../api/_lib/graph';
import { fetchRecentSourceEmails, toParseInput, DEFAULT_COLLECT_CAP } from '../api/_lib/inboundCollect';
import { parseEmail, type ParsedEmail } from '../src/lib/email/parseEmail';
import { scoreLevel, SCORE_LEVELS } from '../src/lib/inbound';
import { normEmail, normPhone } from '../src/lib/duplicateLeads';

const daysArg = process.argv.indexOf('--days');
const days = daysArg !== -1 ? Math.max(1, Number(process.argv[daysArg + 1]) || 7) : 7;

async function main() {
  const env = readGraphEnv(process.env);
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();
  console.log(`TEST À BLANC — fenêtre : ${days} jours (depuis ${sinceIso.slice(0, 16).replace('T', ' ')} UTC)`);
  console.log(`Boîte : ${env.mailbox} — dossier Inbox seul — cap ${DEFAULT_COLLECT_CAP} emails\n`);

  const { messages, truncated, errors } = await fetchRecentSourceEmails(env, { sinceIso });
  for (const e of errors) console.error(`⚠ ${e}`);
  if (truncated) console.error(`⚠ CAP ATTEINT : la fenêtre contient plus de ${DEFAULT_COLLECT_CAP} emails — liste tronquée.`);

  const rows = messages.map(m => ({ m, p: parseEmail(toParseInput(m)) }));

  // Doublons INTERNES au lot (même prospect via deux emails) — aperçu du
  // signalement que fera la vraie file.
  const seen = new Map<string, string>();
  const dupOf = (p: ParsedEmail): string | undefined => {
    const keys = [normEmail(p.extracted.email), normPhone(p.extracted.phone)].filter(Boolean);
    for (const k of keys) { if (seen.has(k)) return seen.get(k); }
    const name = `${p.extracted.firstName} ${p.extracted.lastName}`.trim();
    for (const k of keys) seen.set(k, name || '(sans nom)');
    return undefined;
  };
  // parcours chronologique pour que le doublon pointe vers le PREMIER email
  const dups = new Map<ParsedEmail, string>();
  for (const { p } of rows) { const d = dupOf(p); if (d) dups.set(p, d); }

  console.log('=== CE QUE LE ROBOT AURAIT MIS DANS LA FILE (trié par score) ===\n');
  const sorted = [...rows].sort((a, b) => b.p.score - a.p.score);
  for (const { m, p } of sorted) {
    const lvl = SCORE_LEVELS[scoreLevel(p.score)].label;
    const name = `${p.extracted.firstName} ${p.extracted.lastName}`.trim() || '(sans nom)';
    const admin = p.scoreReasons.some(r => r.includes('Administratif'));
    const tags = [
      admin ? 'AUTO-REJETÉ (administratif)' : '',
      p.score < 40 && !admin ? 'replié « probables parasites »' : '',
      dups.has(p) ? `DOUBLON probable de ${dups.get(p)}` : '',
    ].filter(Boolean).join(' · ');
    console.log(`${String(p.score).padStart(3)}  ${lvl.padEnd(18)} ${p.sourceLabel.padEnd(22)} ${name.padEnd(26)} ${(p.extracted.boatInterest || '—').slice(0, 34).padEnd(34)} ${m.receivedAt.slice(0, 10)}${tags ? '  [' + tags + ']' : ''}`);
  }

  const byLevel = { prospect: 0, a_verifier: 0, parasite: 0 };
  const byFamily = new Map<string, number>();
  let admins = 0;
  for (const { p } of rows) {
    byLevel[scoreLevel(p.score)]++;
    byFamily.set(p.sourceLabel, (byFamily.get(p.sourceLabel) ?? 0) + 1);
    if (p.scoreReasons.some(r => r.includes('Administratif'))) admins++;
  }
  console.log('\n=== BILAN ===');
  console.log(`Emails collectés (Inbox, ${days} j, 4 familles) : ${rows.length}`);
  for (const [fam, n] of byFamily) console.log(`  ${fam.padEnd(24)} ${n}`);
  console.log(`Prospects probables (>=70) : ${byLevel.prospect}`);
  console.log(`À vérifier (40-69)         : ${byLevel.a_verifier}`);
  console.log(`Parasites probables (<40)  : ${byLevel.parasite} (dont ${admins} administratifs auto-rejetés)`);
  console.log(`Doublons internes signalés : ${dups.size}`);
  console.log('\nAUCUNE ÉCRITURE effectuée : ni base de données, ni Outlook, ni fichier.');
}

main().catch(e => { console.error('Échec :', e); process.exit(1); });
