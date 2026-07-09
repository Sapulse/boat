/**
 * Harnais auth (Lot 7 allégé — compte unique partagé).
 *
 * Exécution : npx tsx scripts/harness-auth.ts
 *
 * Couvre les primitives PURES de api/_lib/auth.ts (sans HTTP ni env) :
 *  - mot de passe : hash scrypt + vérif temps constant (sel -> hashs distincts,
 *    mauvais mdp / hash malformé rejetés) ;
 *  - session : signature HMAC + vérif (signature falsifiée / expirée / mauvais
 *    secret -> null) ;
 *  - cookies : build (HttpOnly/Secure/SameSite/Max-Age), clear (Max-Age=0), parse.
 */
import {
  hashPassword, verifyPassword, signSession, verifySession,
  buildSessionCookie, clearSessionCookie, parseCookie, SESSION_MAX_AGE,
} from '../api/_lib/auth';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(title: string) { console.log(`\n— ${title}`); }

const NOW = 1_800_000_000; // instant fixe (secondes) pour le déterminisme
const SECRET = 'test-session-secret-0123456789';

// ---------------------------------------------------------------------------
section('Mot de passe — scrypt + vérif temps constant');
// ---------------------------------------------------------------------------
{
  const h = hashPassword('bon-mot-de-passe-fort');
  check('format scrypt$N$r$p$sel$hash', /^scrypt\$16384\$8\$1\$[^$]+\$[^$]+$/.test(h), h.slice(0, 20));
  check('bon mot de passe -> true', verifyPassword('bon-mot-de-passe-fort', h));
  check('mauvais mot de passe -> false', !verifyPassword('mauvais', h));
  check('deux hashs du même mdp diffèrent (sel aléatoire)', hashPassword('x12345678') !== hashPassword('x12345678'));
  check('hash malformé -> false (pas de crash)', !verifyPassword('x', 'pasunhash'));
  check('hash tronqué -> false', !verifyPassword('x', 'scrypt$16384$8$1$abc'));
}

// ---------------------------------------------------------------------------
section('Session — signature HMAC + expiration');
// ---------------------------------------------------------------------------
{
  const tok = signSession(SECRET, NOW);
  check('jeton = payload.signature', tok.split('.').length === 2 && tok.indexOf('.') > 0);
  const p = verifySession(tok, SECRET, NOW);
  check('vérif OK -> payload (sub team, exp = iat+30j)', !!p && p.sub === 'team' && p.exp === NOW + SESSION_MAX_AGE);
  check('valide juste avant expiration', verifySession(tok, SECRET, NOW + SESSION_MAX_AGE - 1) !== null);
  check('EXPIRÉ (à exp) -> null', verifySession(tok, SECRET, NOW + SESSION_MAX_AGE) === null);
  check('EXPIRÉ (après) -> null', verifySession(tok, SECRET, NOW + SESSION_MAX_AGE + 10) === null);
  check('mauvais secret -> null', verifySession(tok, 'autre-secret', NOW) === null);
  const tampered = tok.slice(0, -2) + (tok.endsWith('aa') ? 'bb' : 'aa');
  check('signature falsifiée -> null', verifySession(tampered, SECRET, NOW) === null);
  check('payload falsifié (autre sig) -> null', verifySession('eyJmYWtlIjoxfQ.' + tok.split('.')[1], SECRET, NOW) === null);
  check('jeton bidon -> null', verifySession('nimportequoi', SECRET, NOW) === null);
  check('chaîne vide -> null', verifySession('', SECRET, NOW) === null);
}

// ---------------------------------------------------------------------------
section('Cookies — build / clear / parse');
// ---------------------------------------------------------------------------
{
  const c = buildSessionCookie('abc.def');
  check('cookie session avec attributs de sécurité',
    c.startsWith('session=abc.def;') && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c) && c.includes(`Max-Age=${SESSION_MAX_AGE}`));
  check('clear -> Max-Age=0', /^session=;/.test(clearSessionCookie()) && /Max-Age=0/.test(clearSessionCookie()));
  const parsed = parseCookie('foo=1; session=abc.def; bar=2');
  check('parse extrait la session', parsed.session === 'abc.def' && parsed.foo === '1' && parsed.bar === '2');
  check('parse header absent -> {}', Object.keys(parseCookie(undefined)).length === 0);
  check('round-trip build->parse', parseCookie(buildSessionCookie('t.k').split(';')[0]).session === 't.k');
}

// ---------------------------------------------------------------------------
console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais auth : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exitCode = 1;
else console.log('Tous les invariants tiennent. ✅');
