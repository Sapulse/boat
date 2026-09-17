/**
 * Harnais lot 5 — réseaux sociaux : logique pure (src/lib/social.ts) et reducer.
 *
 * Exécution : npx tsx scripts/harness-social.ts
 *
 * Décisions du 17/09 :
 *  - Facebook / Instagram / LinkedIn par défaut, identifiants fixes ;
 *  - abonnés obligatoires, publications / portée / commentaire facultatifs ;
 *  - carte vide = rien à enregistrer ; un mois enregistré ne se vide pas ;
 *  - upsert par (réseau, année, mois), jamais de suppression ;
 *  - variation : par rapport au DERNIER mois saisi avant ;
 *  - réseau archivé : hors saisie, visible dans l'historique s'il a des stats.
 */
import {
  DEFAULT_SOCIAL_NETWORKS, defaultSocialNetworks, activeNetworks, orderedNetworks, validateNetworkName, newNetwork,
  networksListErrors, parseCount, parseDraft, draftFromStat, buildSave, mergeStats, statErrors, followersVariation,
  formatDelta, historyMonths, historyNetworks, followersSeries, statKey, EMPTY_DRAFT,
} from '../src/lib/social';
import { reducer } from '../src/context/appReducer';
import { getEmptyState } from '../src/lib/repository';
import { DEFAULT_NETWORK_IDS } from './apply-social-turso';
import type { AppState, SocialNetwork, SocialStat } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const FB = 'reseau-facebook';
const IG = 'reseau-instagram';
const LI = 'reseau-linkedin';
const stat = (networkId: string, year: number, month: number, followers: number, over: Partial<SocialStat> = {}): SocialStat =>
  ({ id: `${networkId}-${year}-${month}`, networkId, year, month, followers, posts: null, reach: null, comment: '', ...over });
let seq = 0;
const newId = () => `nouveau-${++seq}`;

section('Réseaux par défaut');
check('3 réseaux : Facebook, Instagram, LinkedIn, dans cet ordre', orderedNetworks(defaultSocialNetworks()).map(n => n.name).join() === 'Facebook,Instagram,LinkedIn');
check('identifiants fixes = ceux du script Turso', DEFAULT_SOCIAL_NETWORKS.map(n => n.id).join() === DEFAULT_NETWORK_IDS.join());
const d1 = defaultSocialNetworks();
d1[0].name = 'Modifié';
check('copie : modifier la liste rendue ne touche pas la référence', DEFAULT_SOCIAL_NETWORKS[0].name === 'Facebook');

section('Noms de réseaux');
const nets: SocialNetwork[] = [...defaultSocialNetworks(), { id: 'tiktok', name: 'TikTok', position: 4, archived: true }];
check('nom vide refusé', validateNetworkName('   ', nets).includes('nom-vide'));
check('61 caractères refusés', validateNetworkName('x'.repeat(61), nets).includes('nom-trop-long'));
check('doublon (casse, accents, espaces) refusé', validateNetworkName('  FACEBOOK ', nets).includes('nom-en-double') && validateNetworkName('Linkédin', nets).includes('nom-en-double'));
check('doublon d\'un réseau ARCHIVÉ refusé aussi', validateNetworkName('tiktok', nets).includes('nom-en-double'));
check('renommer sans changer de nom (même id) : accepté', validateNetworkName('Facebook', nets, FB).length === 0);
check('nouveau nom libre : accepté', validateNetworkName('YouTube', nets).length === 0);
const yt = newNetwork(nets, 'yt', '  YouTube ');
check('nouveau réseau : nom nettoyé, placé en dernier, actif', yt.name === 'YouTube' && yt.position === 5 && !yt.archived);
check('saisie : réseaux non archivés seulement', activeNetworks(nets).map(n => n.id).join() === [FB, IG, LI].join());
check('liste cohérente : ids et noms uniques', networksListErrors(nets).length === 0 && networksListErrors([...nets, { ...yt, name: 'facebook' }]).length === 1);

section('Nombres et cartes de saisie');
check('parseCount : vide -> null ; « 12 500 » -> 12500', parseCount('') === null && parseCount(' 12 500 ') === 12500);
check('parseCount : décimal, négatif, texte -> invalide', [parseCount('1.5'), parseCount('-3'), parseCount('abc'), parseCount('1,5')].every(v => Number.isNaN(v)));
check('parseCount : au-delà d\'un milliard -> invalide', Number.isNaN(parseCount('1000000001')));
check('carte vide, mois non saisi -> rien à enregistrer', parseDraft({ ...EMPTY_DRAFT }, false).kind === 'vide');
const noFollowers = parseDraft({ followers: '', posts: '12', reach: '', comment: '' }, false);
check('publications sans abonnés -> « abonnés obligatoires »', noFollowers.kind === 'erreur' && noFollowers.errors.includes('abonnes-requis'));
const commentOnly = parseDraft({ followers: '', posts: '', reach: '', comment: 'Campagne' }, false);
check('commentaire seul -> « abonnés obligatoires »', commentOnly.kind === 'erreur' && commentOnly.errors.includes('abonnes-requis'));
const full = parseDraft({ followers: '1 250', posts: '8', reach: '', comment: '  Salon  ' }, false);
check('abonnés + publications + commentaire -> valeurs, portée null, commentaire nettoyé', full.kind === 'valeurs' && full.followers === 1250 && full.posts === 8 && full.reach === null && full.comment === 'Salon');
const cleared = parseDraft({ ...EMPTY_DRAFT }, true);
check('mois DÉJÀ enregistré vidé -> refus (pas de suppression)', cleared.kind === 'erreur' && cleared.errors.includes('mois-deja-saisi'));
const followersCleared = parseDraft({ followers: '', posts: '3', reach: '', comment: '' }, true);
check('mois déjà enregistré, abonnés effacés -> refus', followersCleared.kind === 'erreur' && followersCleared.errors.includes('mois-deja-saisi'));
check('commentaire de 1001 caractères -> refus', (() => { const r = parseDraft({ followers: '1', posts: '', reach: '', comment: 'x'.repeat(1001) }, false); return r.kind === 'erreur' && r.errors.includes('commentaire-trop-long'); })());
check('carte pré-remplie depuis une stat', JSON.stringify(draftFromStat(stat(FB, 2026, 9, 1200, { posts: 4, comment: 'ok' }))) === JSON.stringify({ followers: '1200', posts: '4', reach: '', comment: 'ok' }));

section('Enregistrement d\'un mois (buildSave)');
const base: SocialStat[] = [stat(FB, 2026, 8, 1000), stat(IG, 2026, 8, 500)];
const k = (n: string, y: number, m: number) => `${n}|${y}|${m}`;
const save1 = buildSave(base, {
  [k(FB, 2026, 9)]: { followers: '1100', posts: '5', reach: '', comment: '' },
  [k(IG, 2026, 9)]: { ...EMPTY_DRAFT },
  [k(LI, 2026, 9)]: { followers: '300', posts: '', reach: '2000', comment: 'Offre salon' },
}, newId);
check('2 lignes nouvelles, carte vide ignorée, aucune erreur', save1.rows.length === 2 && Object.keys(save1.errors).length === 0 && save1.rows.every(r => r.year === 2026 && r.month === 9));
const same = buildSave(base, { [k(FB, 2026, 8)]: draftFromStat(base[0]) }, newId);
check('carte inchangée d\'un mois existant -> rien à envoyer', same.rows.length === 0);
const fix = buildSave(base, { [k(FB, 2026, 8)]: { followers: '1010', posts: '', reach: '', comment: '' } }, newId);
check('correction d\'un mois : même id, nouvelle valeur', fix.rows.length === 1 && fix.rows[0].id === base[0].id && fix.rows[0].followers === 1010);
const bad = buildSave(base, { [k(FB, 2026, 9)]: { followers: 'mille', posts: '', reach: '', comment: '' }, [k(IG, 2026, 8)]: { ...EMPTY_DRAFT } }, newId);
check('erreurs par réseau : nombre invalide + mois vidé', bad.errors[k(FB, 2026, 9)]?.includes('nombre-invalide') && bad.errors[k(IG, 2026, 8)]?.includes('mois-deja-saisi'));

section('Upsert par (réseau, année, mois) — jamais de doublon, jamais de retrait');
const otherPost = stat(FB, 2026, 9, 1111, { id: 'id-autre-poste' });
const merged = mergeStats([...base, otherPost], save1.rows);
check('clé déjà présente (autre poste) : garde SON id, prend les valeurs', merged.filter(s => statKey(s) === k(FB, 2026, 9)).length === 1 && merged.find(s => statKey(s) === k(FB, 2026, 9))?.id === 'id-autre-poste' && merged.find(s => statKey(s) === k(FB, 2026, 9))?.followers === 1100);
check('aucune ligne retirée', merged.length === 4 && mergeStats(merged, []).length === 4);

section('Règles d\'une ligne (serveur, reducer, restauration)');
check('ligne valide', statErrors(stat(FB, 2026, 9, 0), nets).length === 0);
check('réseau inconnu, mois 13, abonnés négatifs, décimal', statErrors(stat('fantome', 2026, 13, -1, { posts: 1.5 }), nets).length === 4);

section('Variation des abonnés : dernier mois saisi avant');
const hist: SocialStat[] = [stat(FB, 2026, 5, 900), stat(FB, 2026, 6, 950), stat(FB, 2026, 9, 1020), stat(IG, 2026, 9, 400), stat(LI, 2025, 12, 100), stat(LI, 2026, 1, 90)];
const v6 = followersVariation(hist, FB, 2026, 6);
check('juin après mai : +50, mois précédent', v6.delta === 50 && v6.previousMonth && v6.since?.month === 5);
const v9 = followersVariation(hist, FB, 2026, 9);
check('septembre après un trou : +70 depuis juin (pas le mois précédent)', v9.delta === 70 && !v9.previousMonth && v9.since?.month === 6);
check('premier mois saisi : pas de variation', followersVariation(hist, FB, 2026, 5).delta === null && followersVariation(hist, IG, 2026, 9).delta === null);
const vJan = followersVariation(hist, LI, 2026, 1);
check('janvier après décembre de l\'année d\'avant : −10, mois précédent', vJan.delta === -10 && vJan.previousMonth);
check('mois non saisi : pas de variation', followersVariation(hist, FB, 2026, 7).delta === null);
check('formatDelta : +1 234 / −10 / 0', formatDelta(1234) === '+1 234' || formatDelta(1234) === '+1 234' || formatDelta(1234) === '+1 234');
check('formatDelta : signe moins typographique et zéro', formatDelta(-10) === '−10' && formatDelta(0) === '0');

section('Historique et courbe');
check('mois saisis, plus récent d\'abord', historyMonths(hist).map(m => `${m.year}-${m.month}`).join() === '2026-9,2026-6,2026-5,2026-1,2025-12');
const archivedNets = nets.map(n => (n.id === LI ? { ...n, archived: true } : n));
check('historique : réseau archivé AVEC stats visible, archivé sans stats masqué', historyNetworks(archivedNets, hist).map(n => n.id).join() === [FB, IG, LI].join());
const series = followersSeries(hist, [nets[0], nets[1]]);
check('courbe : un point par mois, ordre chronologique', series.length === 5 && series[0].cle === '2025-12' && series[4].cle === '2026-09');
check('courbe : null quand le réseau n\'a pas été saisi ce mois-là', series[4][FB] === 1020 && series[0][FB] === null && series[4][IG] === 400);

section('Reducer');
let st: AppState = { ...getEmptyState(), socialNetworks: defaultSocialNetworks(), socialStats: [] };
st = reducer(st, { type: 'ADD_SOCIAL_NETWORK', payload: { id: 'yt', name: 'YouTube' } });
check('ajout d\'un réseau', st.socialNetworks?.length === 4 && st.socialNetworks[3].name === 'YouTube');
const refusedDup = reducer(st, { type: 'ADD_SOCIAL_NETWORK', payload: { id: 'yt2', name: 'youtube' } });
check('ajout d\'un doublon : état inchangé', refusedDup === st);
st = reducer(st, { type: 'RENAME_SOCIAL_NETWORK', payload: { id: 'yt', name: 'YouTube Shorts' } });
check('renommage', st.socialNetworks?.find(n => n.id === 'yt')?.name === 'YouTube Shorts');
check('renommage vers un nom pris : inchangé', reducer(st, { type: 'RENAME_SOCIAL_NETWORK', payload: { id: 'yt', name: 'Instagram' } }) === st);
st = reducer(st, { type: 'SAVE_SOCIAL_STATS', payload: [stat('yt', 2026, 9, 50)] });
st = reducer(st, { type: 'SET_SOCIAL_NETWORK_ARCHIVED', payload: { id: 'yt', archived: true } });
check('archivage : hors saisie, stats conservées, visible dans l\'historique', !activeNetworks(st.socialNetworks ?? []).some(n => n.id === 'yt') && st.socialStats?.length === 1 && historyNetworks(st.socialNetworks ?? [], st.socialStats ?? []).some(n => n.id === 'yt'));
check('désarchivage', activeNetworks(reducer(st, { type: 'SET_SOCIAL_NETWORK_ARCHIVED', payload: { id: 'yt', archived: false } }).socialNetworks ?? []).some(n => n.id === 'yt'));
const before = st;
st = reducer(st, { type: 'SAVE_SOCIAL_STATS', payload: [stat(FB, 2026, 9, 1000), stat(IG, 2026, 9, 400)] });
st = reducer(st, { type: 'SAVE_SOCIAL_STATS', payload: [{ ...stat(FB, 2026, 9, 1010), id: 'autre-id' }] });
check('stats : upsert par clé (même id conservé), 3 lignes', st.socialStats?.length === 3 && st.socialStats.find(s => s.networkId === FB)?.followers === 1010 && st.socialStats.find(s => s.networkId === FB)?.id === `${FB}-2026-9`);
check('stats invalides (réseau inconnu) : TOUT le lot refusé', reducer(st, { type: 'SAVE_SOCIAL_STATS', payload: [stat(LI, 2026, 9, 1), stat('fantome', 2026, 9, 1)] }) === st);
check('lot vide : inchangé', reducer(before, { type: 'SAVE_SOCIAL_STATS', payload: [] }) === before);
const hydrated = reducer(getEmptyState(), { type: 'SET_STATE', payload: { ...getEmptyState(), socialNetworks: undefined, socialStats: undefined } });
check('SET_STATE sans champs du lot 5 : listes vides (pas de réseau inventé côté écran)', hydrated.socialNetworks?.length === 0 && hydrated.socialStats?.length === 0);

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais réseaux sociaux : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
