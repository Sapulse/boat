/**
 * Harnais du reducer & de l'initialisation du state (lot fix/integrite-reducer).
 *
 * Execution : npx tsx scripts/harness-reducer.ts
 * (hors tsc -b et hors bundle Vite : ce fichier n'est importe par aucun fichier
 * de l'app et scripts/ n'est dans aucun tsconfig.)
 *
 * Couvre :
 *  - N1 : restauration du state des que stored !== null (un state a 0 lead ne
 *    re-seed PAS et n'ecrase pas commerciaux/templates/stats) ; seed uniquement
 *    sur vrai premier lancement.
 *  - N2 : ADD_ACTION antidatee ne fait pas reculer lastActionDate.
 *  - N3 : ADD_LEAD pose les jalons selon le statut, date de reference createdAt.
 *  - Non-regression : isolation des effets de bord UPDATE_ACTION / DELETE_ACTION /
 *    SET_NEXT_ACTION (invariants du lot precedent).
 */

// Mock localStorage AVANT tout appel a getInitialState (loadState n'y accede
// qu'a l'appel, pas a l'import).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};

import { reducer, getInitialState } from '../src/context/appReducer';
import { DEFAULT_COMMERCIALS, DEFAULT_TEMPLATES } from '../src/data/constants';
import { toWaNumber, buildWhatsApp } from '../src/lib/whatsapp';
import { getCreatableLeads } from '../src/lib/agenda';
import type { AppState, Lead, LeadAction, LeadStatus, MessageTemplate } from '../src/data/types';

const STORAGE_KEY = 'crm-nautisme-data';

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

// ---------------------------------------------------------------------------
// Fabriques
// ---------------------------------------------------------------------------

function makeLead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    createdAt: '2026-06-01',
    source: 'Tel',
    commercialId: 'fred',
    firstName: 'Jean',
    lastName: 'Test',
    phone: '06 00 00 00 00',
    email: 'jean.test@email.fr',
    boatType: 'Moteur',
    boatCondition: 'Neuf',
    boatInterest: 'Antares 9',
    brand: 'Beneteau',
    budget: 50000,
    status: 'contacte',
    contactDate: '2026-06-02',
    quoteAmount: null,
    probability: null,
    currentBoat: '',
    comments: '',
    deliveryDate: '',
    temperature: 'tiede',
    priority: 'normale',
    nextActionType: '',
    nextActionDate: '',
    lastActionDate: '2026-06-05',
    lossReason: '',
    signedAt: '',
    lostAt: '',
    reportedAt: '',
    ...over,
  };
}

function makeAction(over: Partial<LeadAction> = {}): LeadAction {
  return {
    id: 'act-1',
    leadId: 'lead-1',
    type: 'appel',
    date: '2026-06-05',
    result: 'OK',
    notes: '',
    authorId: 'fred',
    ...over,
  };
}

function makeState(over: Partial<AppState> = {}): AppState {
  return {
    leads: [makeLead()],
    actions: [makeAction()],
    commercials: DEFAULT_COMMERCIALS,
    monthlyStats: [],
    acquisitionVolumes: [],
    templates: DEFAULT_TEMPLATES,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// N1 — getInitialState : restauration vs seed
// ---------------------------------------------------------------------------

section('N1 — state stocke avec leads:[] mais commerciaux/templates remplis -> restaure, PAS de re-seed');
{
  const customCommercials = [{ id: 'lana', name: 'Lana', active: true }];
  // Template LEGACY (champ emailTemplates, SANS champ type) : la migration doit
  // tout preserver et poser type 'email'.
  const customTemplates = [{ id: 'contact', title: 'Perso', subject: 'S', body: 'B' }];
  const storedState = {
    leads: [],
    actions: [],
    commercials: customCommercials,
    monthlyStats: [{ id: 'm1', year: 2026, month: 1, source: 'Google Ads', budget: 100, leads: 4, cpl: 25 }],
    acquisitionVolumes: [{ id: 'v1', source: 'Youboat', month: 1, year: 2026, leadCount: 7 }],
    emailTemplates: customTemplates,
  };
  store.clear();
  store.set(STORAGE_KEY, JSON.stringify(storedState));
  const s = getInitialState();
  check('0 lead bidon regenere (leads reste [])', s.leads.length === 0, `leads.length=${s.leads.length}`);
  check('commerciaux personnalises preserves', JSON.stringify(s.commercials) === JSON.stringify(customCommercials));
  check('template personnalise preserve (id/titre/sujet/corps intacts)',
    s.templates.length === 1 && s.templates[0].id === 'contact' && s.templates[0].title === 'Perso'
    && s.templates[0].subject === 'S' && s.templates[0].body === 'B',
    JSON.stringify(s.templates));
  check("migration : type 'email' pose par defaut", s.templates[0].type === 'email', `=${s.templates[0].type}`);
  check('stats mensuelles preservees', s.monthlyStats.length === 1 && s.monthlyStats[0].id === 'm1');
  check('volumes acquisition preserves', s.acquisitionVolumes.length === 1 && s.acquisitionVolumes[0].id === 'v1');
}

section('Migration templates — state FUTUR (champ templates) lu tel quel, type sms preserve');
{
  const futureTemplates: MessageTemplate[] = [
    { id: 'x1', type: 'email', title: 'Mail perso', subject: 'Su', body: 'Bo' },
    { id: 'x2', type: 'sms', title: 'SMS relance', subject: '', body: 'Coucou {{prenom}}' },
  ];
  store.clear();
  store.set(STORAGE_KEY, JSON.stringify(makeState({ templates: futureTemplates })));
  const s = getInitialState();
  check('2 templates lus depuis le champ `templates`', s.templates.length === 2);
  check('type sms preserve (pas ecrase en email)', s.templates[1].type === 'sms', `=${s.templates[1].type}`);
  check('contenu sms intact', s.templates[1].body === 'Coucou {{prenom}}' && s.templates[1].subject === '');
}

section('Migration templates — type WhatsApp preserve + type inconnu/legacy -> email');
{
  // Le 3e modele a un type INCONNU (legacy ou corrompu) : doit retomber sur
  // 'email' sans perte ; le modele WhatsApp doit etre preserve tel quel (sinon
  // un modele WA stocke retomberait en email au rechargement — regression).
  const stored = [
    { id: 'w1', type: 'whatsapp', title: 'WA relance', subject: '', body: 'Salut {{prenom}}' },
    { id: 's1', type: 'sms', title: 'SMS', subject: '', body: 'SMS body' },
    { id: 'e1', type: 'email', title: 'Mail', subject: 'Su', body: 'Bo' },
    { id: 'leg', type: 'mms', title: 'Legacy', subject: '', body: 'inconnu' },
  ];
  store.clear();
  store.set(STORAGE_KEY, JSON.stringify(makeState({ templates: stored as unknown as MessageTemplate[] })));
  const s = getInitialState();
  check('4 templates lus', s.templates.length === 4);
  check('type whatsapp preserve (pas ecrase en email)', s.templates[0].type === 'whatsapp', `=${s.templates[0].type}`);
  check('contenu whatsapp intact', s.templates[0].body === 'Salut {{prenom}}' && s.templates[0].subject === '');
  check('type sms preserve', s.templates[1].type === 'sms', `=${s.templates[1].type}`);
  check('type email preserve', s.templates[2].type === 'email', `=${s.templates[2].type}`);
  check('type inconnu (mms) -> email (defaut sur, pas de perte)', s.templates[3].type === 'email', `=${s.templates[3].type}`);
  check('contenu du modele legacy intact (seul le type change)', s.templates[3].title === 'Legacy' && s.templates[3].body === 'inconnu');
}

section('base-vierge — stored absent (vrai premier lancement) -> base VIERGE, equipe/modeles gardes');
{
  store.clear();
  const s = getInitialState();
  check('leads vides ([])', s.leads.length === 0, `leads.length=${s.leads.length}`);
  check('actions vides ([])', s.actions.length === 0, `actions.length=${s.actions.length}`);
  check('monthlyStats vides ([])', s.monthlyStats.length === 0, `monthlyStats.length=${s.monthlyStats.length}`);
  check('acquisitionVolumes vides ([])', s.acquisitionVolumes.length === 0, `acquisitionVolumes.length=${s.acquisitionVolumes.length}`);
  check('commerciaux par defaut (equipe gardee)', s.commercials === DEFAULT_COMMERCIALS);
  check('templates par defaut (modeles gardes)', s.templates === DEFAULT_TEMPLATES);
}

section('base-vierge — JSON invalide -> base VIERGE (loadState renvoie null, meme branche)');
{
  store.clear();
  store.set(STORAGE_KEY, '{pas du json');
  const s = getInitialState();
  check('leads vides ([])', s.leads.length === 0, `leads.length=${s.leads.length}`);
  check('commerciaux par defaut (equipe gardee)', s.commercials === DEFAULT_COMMERCIALS);
  check('templates par defaut (modeles gardes)', s.templates === DEFAULT_TEMPLATES);
}

section('N1 — state partiel (hydratation champ par champ, pas de crash ni re-seed)');
{
  store.clear();
  store.set(STORAGE_KEY, JSON.stringify({ leads: [makeLead()] }));
  const s = getInitialState();
  check('lead stocke restaure', s.leads.length === 1 && s.leads[0].id === 'lead-1');
  check('actions manquantes -> []', Array.isArray(s.actions) && s.actions.length === 0);
  check('commercials manquants -> defauts', s.commercials === DEFAULT_COMMERCIALS);
  check('monthlyStats manquantes -> []', Array.isArray(s.monthlyStats) && s.monthlyStats.length === 0);
  check('acquisitionVolumes manquants -> []', Array.isArray(s.acquisitionVolumes) && s.acquisitionVolumes.length === 0);
  check('templates manquants -> defauts', s.templates === DEFAULT_TEMPLATES);
}

section('Migration templates — liste vide -> defauts (fallback historique conserve)');
{
  store.clear();
  store.set(STORAGE_KEY, JSON.stringify(makeState({ templates: [] })));
  const s = getInitialState();
  check('tableau vide (champ templates) remplace par les defauts', s.templates === DEFAULT_TEMPLATES);
  store.clear();
  store.set(STORAGE_KEY, JSON.stringify({ ...makeState(), templates: undefined, emailTemplates: [] }));
  const s2 = getInitialState();
  check('tableau vide (champ legacy emailTemplates) remplace par les defauts', s2.templates === DEFAULT_TEMPLATES);
}

// ---------------------------------------------------------------------------
// N2 — ADD_ACTION : lastActionDate ne recule jamais
// ---------------------------------------------------------------------------

section('N2 — action antidatee : lastActionDate ne recule pas');
{
  const state = makeState({ leads: [makeLead({ lastActionDate: '2026-06-05' })], actions: [] });
  const s = reducer(state, { type: 'ADD_ACTION', payload: makeAction({ id: 'act-old', date: '2026-05-01' }) });
  check('lastActionDate inchangee (2026-06-05)', s.leads[0].lastActionDate === '2026-06-05', `=${s.leads[0].lastActionDate}`);
  check("l'action est bien journalisee", s.actions.length === 1 && s.actions[0].id === 'act-old');
}

section('N2 — action plus recente : lastActionDate avance (cas nominal)');
{
  const state = makeState({ leads: [makeLead({ lastActionDate: '2026-06-05' })], actions: [] });
  const s = reducer(state, { type: 'ADD_ACTION', payload: makeAction({ id: 'act-new', date: '2026-06-10' }) });
  check('lastActionDate avancee a 2026-06-10', s.leads[0].lastActionDate === '2026-06-10', `=${s.leads[0].lastActionDate}`);
}

section("N2 — lead sans lastActionDate ('') : n'importe quelle date la pose");
{
  const state = makeState({ leads: [makeLead({ lastActionDate: '' })], actions: [] });
  const s = reducer(state, { type: 'ADD_ACTION', payload: makeAction({ date: '2026-05-01' }) });
  check('lastActionDate posee', s.leads[0].lastActionDate === '2026-05-01', `=${s.leads[0].lastActionDate}`);
}

section('N2 — action antidatee AVEC changement de statut : jalon a la date semantique, activite non reculee');
{
  const state = makeState({ leads: [makeLead({ lastActionDate: '2026-06-05', status: 'en_conclusion' })], actions: [] });
  const s = reducer(state, {
    type: 'ADD_ACTION',
    payload: makeAction({ date: '2026-06-03', newStatus: 'signe' as LeadStatus }),
  });
  check('statut passe a signe', s.leads[0].status === 'signe');
  check("signedAt = date de l'action (2026-06-03)", s.leads[0].signedAt === '2026-06-03', `=${s.leads[0].signedAt}`);
  check('lastActionDate non reculee (2026-06-05)', s.leads[0].lastActionDate === '2026-06-05', `=${s.leads[0].lastActionDate}`);
}

// ---------------------------------------------------------------------------
// N3 — ADD_LEAD : jalons poses selon le statut, reference = createdAt
// ---------------------------------------------------------------------------

section("N3 — creation en statut 'signe' : signedAt et contactDate = createdAt");
{
  const state = makeState({ leads: [], actions: [] });
  const s = reducer(state, {
    type: 'ADD_LEAD',
    payload: makeLead({ id: 'new-1', status: 'signe', createdAt: '2026-06-10', contactDate: '', signedAt: '', lostAt: '', reportedAt: '' }),
  });
  const l = s.leads[0];
  check('signedAt = createdAt', l.signedAt === '2026-06-10', `=${l.signedAt}`);
  check('contactDate = createdAt (signe implique un contact)', l.contactDate === '2026-06-10', `=${l.contactDate}`);
  check('lostAt / reportedAt vides', l.lostAt === '' && l.reportedAt === '');
}

section("N3 — creation en statut 'contacte' : contactDate posee, pas de jalon terminal");
{
  const state = makeState({ leads: [], actions: [] });
  const s = reducer(state, {
    type: 'ADD_LEAD',
    payload: makeLead({ id: 'new-2', status: 'contacte', createdAt: '2026-06-10', contactDate: '', signedAt: '' }),
  });
  const l = s.leads[0];
  check('contactDate = createdAt', l.contactDate === '2026-06-10', `=${l.contactDate}`);
  check('signedAt / lostAt / reportedAt vides', l.signedAt === '' && l.lostAt === '' && l.reportedAt === '');
}

section("N3 — creation en statut 'nouveau' : aucun jalon pose");
{
  const state = makeState({ leads: [], actions: [] });
  const s = reducer(state, {
    type: 'ADD_LEAD',
    payload: makeLead({ id: 'new-3', status: 'nouveau', createdAt: '2026-06-10', contactDate: '', signedAt: '' }),
  });
  const l = s.leads[0];
  check('contactDate vide', l.contactDate === '');
  check('aucun jalon terminal', l.signedAt === '' && l.lostAt === '' && l.reportedAt === '');
}

section('N3 — contactDate saisie au formulaire : preservee (le helper ne pose que si vide)');
{
  const state = makeState({ leads: [], actions: [] });
  const s = reducer(state, {
    type: 'ADD_LEAD',
    payload: makeLead({ id: 'new-4', status: 'qualifie', createdAt: '2026-06-10', contactDate: '2026-05-15' }),
  });
  check('contactDate saisie conservee (2026-05-15)', s.leads[0].contactDate === '2026-05-15', `=${s.leads[0].contactDate}`);
}

section("N3 — creation en statut 'perdu' : lostAt pose, PAS de contactDate presumee");
{
  const state = makeState({ leads: [], actions: [] });
  const s = reducer(state, {
    type: 'ADD_LEAD',
    payload: makeLead({ id: 'new-5', status: 'perdu', createdAt: '2026-06-10', contactDate: '', signedAt: '' }),
  });
  const l = s.leads[0];
  check('lostAt = createdAt', l.lostAt === '2026-06-10', `=${l.lostAt}`);
  check('contactDate non presumee (perdu sans contact possible)', l.contactDate === '');
}

// ---------------------------------------------------------------------------
// Non-regression — isolation UPDATE_ACTION / DELETE_ACTION / SET_NEXT_ACTION
// ---------------------------------------------------------------------------

section('Isolation UPDATE_ACTION — confinee au tableau actions');
{
  const lead = makeLead({ status: 'signe', signedAt: '2026-06-03', lastActionDate: '2026-06-05' });
  const a1 = makeAction({ id: 'a1', date: '2026-06-03', newStatus: 'signe' });
  const a2 = makeAction({ id: 'a2', date: '2026-06-01' });
  const state = makeState({ leads: [lead], actions: [a1, a2] });
  const s = reducer(state, { type: 'UPDATE_ACTION', payload: { id: 'a1', data: { result: 'Modifie', date: '2026-06-04' } } });
  check('state.leads MEME REFERENCE (aucun effet de bord)', s.leads === state.leads);
  check('action ciblee modifiee', s.actions[0].result === 'Modifie' && s.actions[0].date === '2026-06-04');
  check('autre action meme reference', s.actions[1] === a2);
  check('statut/jalons du lead intacts', s.leads[0].status === 'signe' && s.leads[0].signedAt === '2026-06-03');
  check('lastActionDate du lead intacte', s.leads[0].lastActionDate === '2026-06-05');
}

section('Isolation DELETE_ACTION — pas de rollback du lead');
{
  const lead = makeLead({ status: 'signe', signedAt: '2026-06-03', lastActionDate: '2026-06-05' });
  const a1 = makeAction({ id: 'a1', date: '2026-06-05', newStatus: 'signe' });
  const state = makeState({ leads: [lead], actions: [a1] });
  const s = reducer(state, { type: 'DELETE_ACTION', payload: 'a1' });
  check('state.leads MEME REFERENCE (aucun effet de bord)', s.leads === state.leads);
  check('action retiree', s.actions.length === 0);
  check('statut du lead non rollback', s.leads[0].status === 'signe' && s.leads[0].signedAt === '2026-06-03');
}

section('Isolation SET_NEXT_ACTION — ne touche que nextActionType/nextActionDate');
{
  const lead = makeLead({ nextActionType: '', nextActionDate: '' });
  const other = makeLead({ id: 'lead-2' });
  const state = makeState({ leads: [lead, other] });
  const s = reducer(state, { type: 'SET_NEXT_ACTION', payload: { id: 'lead-1', nextActionType: 'rdv', nextActionDate: '2026-06-20' } });
  const l = s.leads[0];
  check('nextActionType/Date poses', l.nextActionType === 'rdv' && l.nextActionDate === '2026-06-20');
  check('statut / jalons / lastActionDate intacts',
    l.status === lead.status && l.signedAt === lead.signedAt && l.contactDate === lead.contactDate && l.lastActionDate === lead.lastActionDate);
  check('state.actions MEME REFERENCE', s.actions === state.actions);
  check('autre lead meme reference', s.leads[1] === other);

  const cleared = reducer(s, { type: 'SET_NEXT_ACTION', payload: { id: 'lead-1', nextActionType: '', nextActionDate: '' } });
  check('effacement ("" / "") fonctionne', cleared.leads[0].nextActionType === '' && cleared.leads[0].nextActionDate === '');
}

// ---------------------------------------------------------------------------
// Templates — ADD / UPDATE / DELETE confines a state.templates + garde min-1
// ---------------------------------------------------------------------------

section('Templates — ADD_TEMPLATE confine a state.templates');
{
  const state = makeState();
  const sms: MessageTemplate = { id: 'new-sms', type: 'sms', title: 'Relance SMS', subject: '', body: 'Bonjour {{prenom}}' };
  const s = reducer(state, { type: 'ADD_TEMPLATE', payload: sms });
  check('template ajoute en fin de liste', s.templates.length === state.templates.length + 1 && s.templates.at(-1)?.id === 'new-sms');
  check('state.leads MEME REFERENCE', s.leads === state.leads);
  check('state.actions MEME REFERENCE', s.actions === state.actions);
}

section('Templates — UPDATE_TEMPLATE (renommage / edition) confine');
{
  const state = makeState();
  const targetId = state.templates[0].id;
  const other = state.templates[1];
  const s = reducer(state, { type: 'UPDATE_TEMPLATE', payload: { id: targetId, data: { title: 'Renomme', body: 'Nouveau corps' } } });
  check('cible renommee et editee', s.templates[0].title === 'Renomme' && s.templates[0].body === 'Nouveau corps');
  check('type et id de la cible inchanges', s.templates[0].id === targetId && s.templates[0].type === 'email');
  check('autre template meme reference', s.templates[1] === other);
  check('state.leads / state.actions MEMES REFERENCES', s.leads === state.leads && s.actions === state.actions);
}

section('Templates — DELETE_TEMPLATE confine + garde min-1');
{
  const state = makeState(); // 3 templates par defaut
  const targetId = state.templates[1].id;
  const s = reducer(state, { type: 'DELETE_TEMPLATE', payload: targetId });
  check('template supprime', s.templates.length === 2 && !s.templates.some(t => t.id === targetId));
  check('state.leads / state.actions MEMES REFERENCES', s.leads === state.leads && s.actions === state.actions);

  const lastOne = makeState({ templates: [{ id: 'seul', type: 'email', title: 'Dernier', subject: '', body: '' }] });
  const refused = reducer(lastOne, { type: 'DELETE_TEMPLATE', payload: 'seul' });
  check('suppression du DERNIER template refusee (state inchange, meme reference)', refused === lastOne);
  check('la liste ne peut jamais etre vide', refused.templates.length === 1);
}

// ---------------------------------------------------------------------------
// Agenda (lot feat/agenda, etape 4 interactif) — ecriture via SET_NEXT_ACTION
// ---------------------------------------------------------------------------

section('Agenda — getCreatableLeads : leads actifs SANS action (ecrasement impossible par construction)');
{
  const leads = [
    makeLead({ id: 'free', status: 'contacte', nextActionType: '', nextActionDate: '' }),
    makeLead({ id: 'busy', status: 'contacte', nextActionType: 'rdv', nextActionDate: '2026-06-20' }),
    makeLead({ id: 'won', status: 'signe', nextActionType: '', nextActionDate: '' }),
  ];
  const creatable = getCreatableLeads(leads);
  check('lead actif sans action -> creable', creatable.some(l => l.id === 'free'));
  check('lead deja planifie -> EXCLU (pas d ecrasement possible)', !creatable.some(l => l.id === 'busy'));
  check('lead terminal (signe) -> exclu', !creatable.some(l => l.id === 'won'));
  check('exactement 1 lead creable', creatable.length === 1, `=${creatable.length}`);
}

section('Agenda — CREER : SET_NEXT_ACTION pose type + date sur un lead sans action');
{
  const state = makeState({ leads: [makeLead({ id: 'l1', nextActionType: '', nextActionDate: '' })], actions: [] });
  const s = reducer(state, { type: 'SET_NEXT_ACTION', payload: { id: 'l1', nextActionType: 'appel', nextActionDate: '2026-06-22' } });
  check('nextActionType pose', s.leads[0].nextActionType === 'appel', `=${s.leads[0].nextActionType}`);
  check('nextActionDate posee', s.leads[0].nextActionDate === '2026-06-22', `=${s.leads[0].nextActionDate}`);
}

section('Agenda — REPLANIFIER : date changee, type PRESERVE, aucun effet de bord');
{
  const lead = makeLead({ id: 'l1', status: 'signe', signedAt: '2026-06-03', lastActionDate: '2026-06-05', nextActionType: 'rdv', nextActionDate: '2026-06-20' });
  const a1 = makeAction({ id: 'a1' });
  const state = makeState({ leads: [lead], actions: [a1] });
  const s = reducer(state, { type: 'SET_NEXT_ACTION', payload: { id: 'l1', nextActionType: 'rdv', nextActionDate: '2026-06-27' } });
  check('date replanifiee', s.leads[0].nextActionDate === '2026-06-27', `=${s.leads[0].nextActionDate}`);
  check('type PRESERVE (rdv, non efface)', s.leads[0].nextActionType === 'rdv', `=${s.leads[0].nextActionType}`);
  check('statut / jalon signedAt intacts', s.leads[0].status === 'signe' && s.leads[0].signedAt === '2026-06-03');
  check('lastActionDate intacte', s.leads[0].lastActionDate === '2026-06-05');
  check('historique (actions) MEME REFERENCE (aucun effet de bord)', s.actions === state.actions);
}

// ---------------------------------------------------------------------------
// WhatsApp — toWaNumber : format international wa.me (constat ephemere)
// ---------------------------------------------------------------------------

section('WhatsApp — toWaNumber : conversion au format international wa.me');
{
  // Constat ephemere : on AFFICHE les conversions au point d'arret (comme pour
  // buildSms) en plus de les asserter.
  const cases: [string, string][] = [
    ['06 12 34 56 78', '33612345678'],   // national FR : 0 -> 33
    ['+33 6 12 34 56 78', '33612345678'], // indicatif via '+'
    ['0033 6 12 34 56 78', '33612345678'],// indicatif via '00'
    ['33612345678', '33612345678'],       // deja international : inchange
  ];
  for (const [input, expected] of cases) {
    const got = toWaNumber(input);
    console.log(`    « ${input} » -> ${got}`);
    check(`toWaNumber("${input}") = ${expected}`, got === expected, `=${got}`);
  }
  const url = buildWhatsApp('06 12 34 56 78', 'Bonjour & à bientôt');
  console.log(`    URL exemple : ${url}`);
  check('buildWhatsApp : prefixe wa.me + numero international',
    url.startsWith('https://wa.me/33612345678?text='), url);
  check('buildWhatsApp : corps encode (espaces, &, accents)',
    url.endsWith('?text=Bonjour%20%26%20%C3%A0%20bient%C3%B4t'), url);
}

// ---------------------------------------------------------------------------
// Bilan
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(50)}`);
console.log(`Harnais : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log('Tous les invariants tiennent. ✅');
}
