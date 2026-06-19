/**
 * Harnais communication (lot objectifs-prospection, etape 2).
 *
 * Execution : npx tsx scripts/harness-communication.ts
 * (hors tsc -b et hors bundle Vite, comme les autres harnais.)
 *
 * Couvre la logique PURE `buildCommunicationAction` (lib/communication) — le seul
 * endroit qui construit une action de communication (email/sms/whatsapp/appel) :
 *  - authorId = commercial ASSIGNE au lead (lead.commercialId) ;
 *  - date = `today` fourni ; type/result/leadId reportes ;
 *  - notes : opts.notes si fourni, sinon '' (jamais undefined).
 */

import { buildCommunicationAction } from '../src/lib/communication';
import type { Lead } from '../src/data/types';

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

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-9', createdAt: '2026-06-01', source: 'Passage', commercialId: 'fred',
    firstName: 'Léa', lastName: 'Morvan', phone: '06 01 02 03 04', email: 'l@m.fr',
    boatType: '', boatCondition: '', boatInterest: '', brand: '',
    budget: null, status: 'nouveau', contactDate: '', quoteAmount: null,
    probability: null, currentBoat: '', comments: '', deliveryDate: '',
    temperature: 'tiede', priority: 'normale', nextActionType: '', nextActionDate: '',
    lastActionDate: '', lossReason: '', signedAt: '', lostAt: '', reportedAt: '',
    ...over,
  };
}

// ---------------------------------------------------------------------------
section('buildCommunicationAction — champs posés');
{
  const lead = makeLead({ id: 'lead-1', commercialId: 'tom' });
  const a = buildCommunicationAction(lead, 'email', '2026-06-19', { result: 'Email envoyé — Contact', notes: 'Bonjour' });
  check('leadId = lead.id', a.leadId === 'lead-1');
  check('type reporté', a.type === 'email');
  check('date = today fourni', a.date === '2026-06-19');
  check('result reporté', a.result === 'Email envoyé — Contact');
  check('notes reporté', a.notes === 'Bonjour');
  check('authorId = lead.commercialId (commercial ASSIGNÉ)', a.authorId === 'tom');
  check('pas de champ id (Omit)', !('id' in a));
}

// ---------------------------------------------------------------------------
section('notes optionnel -> "" (jamais undefined)');
{
  const a = buildCommunicationAction(makeLead(), 'appel', '2026-06-19', { result: 'Appel passé' });
  check('notes absent -> ""', a.notes === '');
  check('type appel', a.type === 'appel');
  check('result = "Appel passé"', a.result === 'Appel passé');
}

// ---------------------------------------------------------------------------
section('Comportement identique aux 3 handlers (mêmes payloads qu\'avant la refacto)');
{
  const lead = makeLead({ id: 'L', commercialId: 'nicolas' });
  const today = '2026-06-19';

  // sendEmail (avec / sans modèle) : notes = subject
  check('email avec modèle', JSON.stringify(buildCommunicationAction(lead, 'email', today, { result: 'Email envoyé — Relance', notes: 'Objet' }))
    === JSON.stringify({ leadId: 'L', type: 'email', date: today, result: 'Email envoyé — Relance', notes: 'Objet', authorId: 'nicolas' }));
  check('email sans modèle (subject "")', buildCommunicationAction(lead, 'email', today, { result: 'Email envoyé — sans modèle', notes: '' }).notes === '');

  // sendSms / sendWhatsapp : notes = body
  check('sms', buildCommunicationAction(lead, 'sms', today, { result: 'SMS envoyé — sans modèle', notes: '' }).type === 'sms');
  check('whatsapp', buildCommunicationAction(lead, 'whatsapp', today, { result: 'WhatsApp envoyé — X', notes: 'corps' }).type === 'whatsapp');
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais communication : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Tous les invariants tiennent. ✅');
}
