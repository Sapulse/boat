/**
 * Harnais lot 3 — ouverture des fiches (src/lib/openLead.ts), logique PURE.
 * Exécution : npx tsx scripts/harness-open-lead.ts
 */
import { leadHash, leadUrl, opensInNewTab, backTarget } from '../src/lib/openLead';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}

console.log('\n— Ordinateur / mobile');
check('ordinateur, clic simple -> nouvel onglet', opensInNewTab(false));
check('mobile, clic simple -> même onglet', !opensInNewTab(true));
check('mobile, Ctrl+clic -> nouvel onglet', opensInNewTab(true, { ctrlKey: true }));
check('mobile, Cmd+clic (Mac) -> nouvel onglet', opensInNewTab(true, { metaKey: true }));
check('mobile, clic molette -> nouvel onglet', opensInNewTab(true, { button: 1 }));
check('mobile, clic gauche sans touche -> même onglet', !opensInNewTab(true, { button: 0, ctrlKey: false }));

console.log('\n— Adresse (HashRouter, base /boat/ ou /)');
check('hash relatif', leadHash('abc-123') === '#/leads/abc-123');
check('id encodé (jamais d\'injection dans l\'URL)', leadHash('a/b?c') === '#/leads/a%2Fb%3Fc');
check('base /boat/ : hash d\'origine remplacé', leadUrl('L1', { origin: 'http://localhost:5173', pathname: '/boat/', search: '' }) === 'http://localhost:5173/boat/#/leads/L1');
check('base / (Vercel) ', leadUrl('L1', { origin: 'https://boat-eta.vercel.app', pathname: '/', search: '' }) === 'https://boat-eta.vercel.app/#/leads/L1');
check('paramètres de page conservés', leadUrl('L1', { origin: 'https://x.fr', pathname: '/boat/', search: '?v=2' }) === 'https://x.fr/boat/?v=2#/leads/L1');

console.log('\n— Bouton Retour de la fiche');
check('onglet neuf (history.length = 1) -> liste des leads', backTarget(1) === 'leads');
check('navigation dans l\'onglet -> page précédente', backTarget(3) === 'history');

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais ouverture des fiches : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
