/**
 * Harnais de l'indicateur de synchro (correctif audit #3, brique 3).
 *
 * Exécution : npx tsx scripts/harness-sync-ui.ts
 *
 * Couvre la LOGIQUE DE RENDU (pure) describeSync : le mapping état -> libellé /
 * ton / « prominent » (alerte non-ratable). Le reste (contrôles sync.*, worker)
 * est déjà prouvé (harness-api-client, 39 assertions) ; le rendu React n'est pas
 * unit-testable sans jsdom (hors périmètre).
 */
import { describeSync } from '../src/lib/syncLabels';
import type { SyncInfo } from '../src/lib/repository';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(title: string) { console.log(`\n— ${title}`); }
const d = (info: SyncInfo) => describeSync(info);

function main() {
  section('idle : « À jour », discret (vert, non-prominent)');
  {
    const r = d({ status: 'idle', pending: 0 });
    check('label « À jour »', r.label === 'À jour');
    check('ton ok (vert)', r.tone === 'ok');
    check('NON prominent (discret)', r.prominent === false);
  }

  section('sending : « Enregistrement… », calme (non-prominent)');
  {
    check('sans compteur si 0', d({ status: 'sending', pending: 0 }).label === 'Enregistrement…');
    const r = d({ status: 'sending', pending: 3 });
    check('avec compteur (3)', r.label === 'Enregistrement… (3)');
    check('ton busy, non prominent', r.tone === 'busy' && r.prominent === false);
  }

  section('waiting : « N non enregistrée(s) », orange, visible-calme (non-prominent)');
  {
    const one = d({ status: 'waiting', pending: 1 });
    check('singulier (1)', one.label === '1 modification non enregistrée');
    const many = d({ status: 'waiting', pending: 4 });
    check('pluriel (4)', many.label === '4 modifications non enregistrées');
    check('ton warn (orange), NON prominent (calme)', many.tone === 'warn' && many.prominent === false);
  }

  section('offline : ALERTE non-ratable (prominent)');
  {
    const r = d({ status: 'offline', pending: 2 });
    check('label « Hors ligne — 2 en attente »', r.label === 'Hors ligne — 2 en attente');
    check('ton warn (orange)', r.tone === 'warn');
    check('PROMINENT (alerte non-ratable)', r.prominent === true);
  }

  section('failed : ALERTE ROUGE non-ratable (prominent)');
  {
    const r = d({ status: 'failed', pending: 1, failed: { seq: 1, label: 'Lead Jean Test — création', error: 'boom' } });
    check('label « Modification refusée »', r.label === 'Modification refusée');
    check('ton error (rouge)', r.tone === 'error');
    check('PROMINENT (alerte non-ratable)', r.prominent === true);
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Harnais sync UI : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
  console.log(failed === 0 ? 'Tous les invariants tiennent. ✅' : 'ÉCHECS détectés. ❌');
  if (failed > 0) process.exit(1);
}

main();
