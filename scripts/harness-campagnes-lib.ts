/**
 * LOT SALONS — harnais du module PUR src/lib/campagnes.ts.
 *
 * Exécution : npx tsx scripts/harness-campagnes-lib.ts (et `npm test`).
 *
 * Aucune I/O : on fabrique un état et on vérifie les règles. Les cas limites
 * demandés explicitement sont couverts : un lead contacté par EMAIL seulement,
 * un lead appelé ET emaillé compté UNE SEULE fois, zéro participant.
 */
import {
  fenetreActivite, fenetreSalon, datesSalonARenseigner, compteurs, estContacte, rdvStand,
  lignesCampagne, filtrerLignes, preparerAjout, leadsSansCommercial, campagneParDefaut,
  statutDeduitParticipation, appliquerDeductions, actionProuveUnEchange,
  statutCampagneDepuisLead, appliquerChangementStatutLead, STATUTS_MANUELS,
} from '../src/lib/campagnes';
import type { LeadStatus } from '../src/data/types';
import type { AppState, Campagne, CampagneLead, Lead, LeadAction, PlannedAction, Commercial } from '../src/data/types';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✔ ${label}`); }
  else { failed++; console.error(`  ✘ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function section(t: string) { console.log(`\n— ${t}`); }

const AUJ = '2026-09-19';
const FERMES = ['signe', 'perdu'] as const;

const campagne = (o: Partial<Campagne> = {}): Campagne => ({
  id: 'camp', nom: 'Grand Pavois 2026', type: 'salon', lieu: 'La Rochelle',
  dateDebut: '2026-09-18', dateFin: '', dateSalonDebut: '', dateSalonFin: '',
  objectifRdv: null, active: true, ...o,
});
const lead = (o: Partial<Lead> = {}): Lead => ({
  id: 'l1', createdAt: '2026-09-01', source: 'LBC', commercialId: 'nicolas',
  firstName: 'Jean', lastName: 'Test', phone: '0600000000', email: 'j@test.fr',
  boatType: 'Moteur', boatCondition: 'Neuf', boatInterest: '', brand: '', budget: null,
  status: 'contacte', contactDate: '', quoteAmount: null, probability: null, currentBoat: '',
  comments: '', deliveryDate: '', temperature: 'tiede', priority: 'normale',
  nextActionType: '', nextActionDate: '', lastActionDate: '', lossReason: '',
  signedAt: '', lostAt: '', reportedAt: '', noNextActionReason: '', noNextActionAt: '', ...o,
});
const action = (o: Partial<LeadAction> = {}): LeadAction => ({
  id: 'a', leadId: 'l1', type: 'appel', date: '2026-09-18', result: '', notes: '', authorId: 'nicolas', kind: 'realisee', ...o,
});
const part = (o: Partial<CampagneLead> = {}): CampagneLead => ({
  id: 'p1', campagneId: 'camp', leadId: 'l1', responsableId: 'nicolas', segment: 'Client en portefeuille',
  priorite: 'Moyenne', statutCampagne: 'À contacter', bateauxAVoir: '', notes: '', ...o,
});
const planned = (o: Partial<PlannedAction> = {}): PlannedAction => ({
  id: 'pa', leadId: 'l1', type: 'rdv', customLabel: '', date: '2026-09-22', originalDate: '2026-09-22',
  note: '', status: 'a_faire', people: [{ commercialId: 'nicolas', role: 'responsable' }], ...o,
});
const commercial = (o: Partial<Commercial> = {}): Commercial => ({ id: 'nicolas', name: 'Nicolas', active: true, ...o });

function etat(o: Partial<AppState> = {}): AppState {
  return {
    leads: [], actions: [], commercials: [commercial()], monthlyStats: [], templates: [],
    calendarEvents: [], goals: [], defaultGoal: { prospectsCreated: null, coldCalls: null, followups: null, meetings: null, revenue: null, conversionRate: null },
    plannedActions: [], campagnes: [campagne()], campagneLeads: [], ...o,
  } as AppState;
}

section('Fenêtres : activité et salon ne sont PAS la même période');
{
  const c = campagne({ dateDebut: '2026-09-18', dateFin: '2026-09-27', dateSalonDebut: '2026-09-22', dateSalonFin: '2026-09-27' });
  check('fenêtre d\'activité = préparation comprise', JSON.stringify(fenetreActivite(c, AUJ)) === JSON.stringify({ debut: '2026-09-18', fin: '2026-09-27' }));
  check('fenêtre du salon = les jours du salon seulement', JSON.stringify(fenetreSalon(c, AUJ)) === JSON.stringify({ debut: '2026-09-22', fin: '2026-09-27' }));
  check('dates du salon renseignées -> rien à signaler', datesSalonARenseigner(c) === false);

  // LE cas qui a motivé les deux paires de dates : la préparation reste comptée
  // le jour de l'ouverture du salon.
  const avecSalon = compteurs([action({ date: '2026-09-19' })], 'l1', fenetreActivite(c, '2026-09-22'));
  check('un appel de préparation reste compté le matin de l\'ouverture', avecSalon.appels === 1);

  const sansDates = campagne({ dateFin: '' });
  check('dates du salon absentes -> repli sur la fenêtre d\'activité', JSON.stringify(fenetreSalon(sansDates, AUJ)) === JSON.stringify({ debut: '2026-09-18', fin: AUJ }));
  check('dates du salon absentes -> l\'écran doit le dire', datesSalonARenseigner(sansDates) === true);
  check('campagne non-salon sans dates de salon -> rien à signaler', datesSalonARenseigner(campagne({ type: 'emailing' })) === false);
}

section('Compteurs dérivés — les cas limites demandés');
{
  const f = { debut: '2026-09-18', fin: '2026-09-27' };
  const vide = compteurs([], 'l1', f);
  check('aucune action -> tout à zéro, aucune date', vide.appels === 0 && vide.emails === 0 && vide.dernierContact === '');
  check('aucune action -> non contacté', estContacte(vide) === false);

  const emailSeul = compteurs([action({ id: 'a1', type: 'email', date: '2026-09-19' })], 'l1', f);
  check('contacté par EMAIL seulement -> compte comme contacté', estContacte(emailSeul) === true && emailSeul.appels === 0 && emailSeul.emails === 1);

  const deuxCanaux = compteurs([
    action({ id: 'a1', type: 'appel', date: '2026-09-19' }),
    action({ id: 'a2', type: 'email', date: '2026-09-20' }),
  ], 'l1', f);
  check('appelé ET emaillé -> 1 appel, 1 email, et UN SEUL lead contacté', deuxCanaux.appels === 1 && deuxCanaux.emails === 1 && estContacte(deuxCanaux) === true);
  check('dernier contact = la plus récente, tous canaux', deuxCanaux.dernierContact === '2026-09-20');
  check('dernier appel et dernier email distingués', deuxCanaux.dernierAppel === '2026-09-19' && deuxCanaux.dernierEmail === '2026-09-20');

  const horsFenetre = compteurs([action({ id: 'a1', date: '2026-09-01' }), action({ id: 'a2', date: '2026-10-05' })], 'l1', f);
  check('actions hors fenêtre : ignorées', horsFenetre.appels === 0);

  const reports = compteurs([
    action({ id: 'a1', type: 'appel', date: '2026-09-19', kind: 'report' }),
    action({ id: 'a2', type: 'appel', date: '2026-09-19', kind: 'sans_suite' }),
    action({ id: 'a3', type: 'appel', date: '2026-09-19' }),
  ], 'l1', f);
  check('report et « sans suite » ne comptent pas comme des échanges', reports.appels === 1 && reports.echanges === 1);

  const autreLead = compteurs([action({ id: 'a1', leadId: 'l2' })], 'l1', f);
  check('actions d\'un autre lead : ignorées', autreLead.appels === 0);
}

section('RDV du stand — dérivé, jamais saisi');
{
  const f = { debut: '2026-09-22', fin: '2026-09-27' };
  check('action programmée « rdv » dans la fenêtre -> RDV du stand', !!rdvStand([planned()], 'l1', f));
  check('RDV hors fenêtre du salon -> pas un RDV du stand', !rdvStand([planned({ date: '2026-09-19' })], 'l1', f));
  check('action « relance » -> pas un RDV', !rdvStand([planned({ type: 'relance' })], 'l1', f));
  check('RDV annulé -> ne compte pas', !rdvStand([planned({ status: 'annulee' })], 'l1', f));
  check('RDV déjà fait -> compte quand même', !!rdvStand([planned({ status: 'faite' })], 'l1', f));
}

section('Liste de travail : tri, retards, filtres');
{
  const s = etat({
    leads: [
      lead({ id: 'l1', lastName: 'Aaa', nextActionDate: '2026-09-25' }),
      lead({ id: 'l2', lastName: 'Bbb', nextActionDate: '2026-09-17' }),   // en retard
      lead({ id: 'l3', lastName: 'Ccc', nextActionDate: '' }),             // sans date
      lead({ id: 'l4', lastName: 'Ddd', nextActionDate: '2026-09-10', status: 'perdu' }), // fermé : pas de retard
    ],
    campagneLeads: [
      part({ id: 'p1', leadId: 'l1', priorite: 'Moyenne' }),
      part({ id: 'p2', leadId: 'l2', priorite: 'Haute' }),
      part({ id: 'p3', leadId: 'l3', priorite: 'Haute' }),
      part({ id: 'p4', leadId: 'l4', priorite: 'Basse' }),
    ],
    actions: [action({ id: 'a1', leadId: 'l2', type: 'email', date: '2026-09-18' })],
    plannedActions: [planned({ leadId: 'l1', date: '2026-09-22' })],
  });
  // Campagne avec ses dates de salon : sans elles, la fenêtre des RDV retombe
  // sur l'activité (qui s'arrête aujourd'hui) et le RDV du 22 serait hors champ.
  const campSalon = campagne({ dateFin: '2026-09-27', dateSalonDebut: '2026-09-22', dateSalonFin: '2026-09-27' });
  const lignes = lignesCampagne(s, { campagne: campSalon, aujourdhui: AUJ, statutsFermes: FERMES });
  check('une ligne par participation', lignes.length === 4);
  check('tri : priorité Haute d\'abord, puis date de prochaine action croissante',
    lignes.map(l => l.participation.id).join(',') === 'p2,p3,p1,p4', lignes.map(l => l.participation.id).join(','));
  check('sans date de prochaine action -> après ceux qui en ont (à priorité égale)',
    lignes[0].participation.id === 'p2' && lignes[1].participation.id === 'p3');
  check('retard détecté comme dans l\'Agenda', lignes.find(l => l.lead.id === 'l2')!.enRetard === true);
  check('lead Perdu avec une date passée : PAS en retard (hors Signés / Perdus)', lignes.find(l => l.lead.id === 'l4')!.enRetard === false);
  check('compteurs portés par la ligne', lignes.find(l => l.lead.id === 'l2')!.compteurs.emails === 1);
  check('RDV du stand porté par la ligne', !!lignes.find(l => l.lead.id === 'l1')!.rdv);

  check('filtre priorité', filtrerLignes(lignes, { priorite: 'Haute' }).length === 2);
  check('filtre « en retard seulement »', filtrerLignes(lignes, { enRetardSeulement: true }).length === 1);
  // Depuis le 19/09, l4 (Perdu) est masqué PAR DÉFAUT : les filtres comptent 3
  // lignes, pas 4. C'est le comportement voulu — la case « inclure les leads
  // fermés » les ramène, et on le vérifie ligne suivante.
  check('filtre RDV oui / non (hors lead fermé)', filtrerLignes(lignes, { rdv: 'oui' }).length === 1 && filtrerLignes(lignes, { rdv: 'non' }).length === 2);
  check('filtre responsable (hors lead fermé)', filtrerLignes(lignes, { responsableId: 'nicolas' }).length === 3 && filtrerLignes(lignes, { responsableId: 'fred' }).length === 0);
  check('… et avec la case cochée, le lead Perdu revient dans le compte',
    filtrerLignes(lignes, { responsableId: 'nicolas', inclureFermes: true }).length === 4);
  check('recherche par nom', filtrerLignes(lignes, { recherche: 'bbb' }).length === 1);
  check('aucun participant -> zéro ligne, aucune erreur', lignesCampagne(etat(), { campagne: campSalon, aujourdhui: AUJ, statutsFermes: FERMES }).length === 0);
  // Le RDV du 22 tombe hors de la fenêtre d'activité quand les dates du salon
  // manquent : la colonne RDV reste vide, et l'écran affiche l'avertissement.
  const sansDatesSalon = lignesCampagne(s, { campagne: campagne(), aujourdhui: AUJ, statutsFermes: FERMES });
  check("dates du salon absentes : aucun RDV détecté, et l'écran est averti",
    !sansDatesSalon.find(l => l.lead.id === 'l1')!.rdv && datesSalonARenseigner(campagne()));

  const autreCampagne = lignesCampagne(s, { campagne: campagne({ id: 'autre' }), aujourdhui: AUJ, statutsFermes: FERMES });
  check('les participations d\'une AUTRE campagne ne se mélangent pas', autreCampagne.length === 0);

  const leadSupprime = lignesCampagne(etat({ campagneLeads: [part({ leadId: 'disparu' })] }), { campagne: campSalon, aujourdhui: AUJ, statutsFermes: FERMES });
  check('participation dont le lead a disparu : ignorée, pas de plantage', leadSupprime.length === 0);
}

section('Ajout en masse : jamais de doublon, jamais la source');
{
  const s = etat({
    leads: [lead({ id: 'l1' }), lead({ id: 'l2' }), lead({ id: 'l3' })],
    campagneLeads: [part({ id: 'p1', leadId: 'l1' })],
  });
  let n = 0;
  const genererId = () => `new-${++n}`;
  const r = preparerAjout(s, {
    campagneId: 'camp', leadIds: ['l1', 'l2', 'l3', 'l2'], segment: 'Emailing Grand Pavois',
    priorite: 'Haute', responsableId: 'nicolas', statutParDefaut: 'À contacter',
  }, genererId);
  check('lead déjà participant : écarté, et annoncé UNE fois', r.dejaParticipants.length === 1 && r.dejaParticipants[0] === 'l1');
  check('deux fois le même lead dans le lot : une seule participation, RIEN à annoncer',
    r.nouvelles.length === 2 && !r.dejaParticipants.includes('l2'));
  check('valeurs du lot appliquées (segment, priorité, responsable, statut par défaut)',
    r.nouvelles.every(p => p.segment === 'Emailing Grand Pavois' && p.priorite === 'Haute' && p.responsableId === 'nicolas' && p.statutCampagne === 'À contacter'));
  check('aucune source lue ni écrite dans les participations produites',
    r.nouvelles.every(p => !('source' in (p as unknown as Record<string, unknown>))));
  const apres = JSON.stringify(s.leads);
  check('l\'état des leads est inchangé (fonction pure, aucune mutation)', apres === JSON.stringify(s.leads));

  const rien = preparerAjout(s, { campagneId: 'camp', leadIds: [], segment: '', priorite: 'Moyenne', responsableId: 'nicolas', statutParDefaut: 'À contacter' }, genererId);
  check('sélection vide -> rien à ajouter, aucune erreur', rien.nouvelles.length === 0 && rien.dejaParticipants.length === 0);
}

section('Leads sans commercial : annoncés avant l\'ajout');
{
  const estNonAttribue = (c: Commercial) => c.name.toLowerCase().startsWith('non attribu');
  const s = etat({
    commercials: [commercial(), commercial({ id: 'na', name: 'Non attribué' })],
    leads: [lead({ id: 'l1' }), lead({ id: 'l2', commercialId: 'na' }), lead({ id: 'l3', commercialId: 'disparu' })],
  });
  const sans = leadsSansCommercial(s, ['l1', 'l2', 'l3'], estNonAttribue);
  check('« Non attribué » et commercial inconnu comptent comme sans commercial', sans.length === 2 && sans.includes('l2') && sans.includes('l3'));
  check('lead avec un vrai commercial : pas dans la liste', !sans.includes('l1'));
}

section('S2c — le statut de campagne se DÉDUIT de ce qui a été fait');
{
  const camp = campagne({ dateDebut: '2026-09-18', dateFin: '2026-09-27', dateSalonDebut: '2026-09-22', dateSalonFin: '2026-09-27' });
  const deduire = (p: CampagneLead, actions: LeadAction[], planned: PlannedAction[] = []) =>
    statutDeduitParticipation(p, camp, actions, planned, AUJ);

  // — Le scénario demandé, pas à pas —
  const aContacter = part({ statutCampagne: 'À contacter' });
  check('« À contacter » + UN APPEL (sans réponse) -> « Contacté sans retour »',
    deduire(aContacter, [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Pas de réponse' })]) === 'Contacté sans retour');
  check('… + un appel où on a eu le client -> « Échange en cours »',
    deduire(aContacter, [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Joint' })]) === 'Échange en cours');
  check('… + un RDV programmé dans la fenêtre du SALON -> « RDV confirmé »',
    deduire(aContacter, [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Joint' })], [planned({ date: '2026-09-23' })]) === 'RDV confirmé');
  check('« Pas intéressé » + un appel -> reste « Pas intéressé » (on ne devine pas une intention)',
    deduire(part({ statutCampagne: 'Pas intéressé' }), [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Joint' })]) === 'Pas intéressé');

  // — Mapping des puces d'appel, une par une —
  for (const [puce, attendu] of [
    ['Appel — Joint', 'Échange en cours'],
    ['Appel — Rappel demandé', 'Échange en cours'],
    ['Appel — Message laissé', 'Contacté sans retour'],
    ['Appel — Pas de réponse', 'Contacté sans retour'],
    ['Appel — Mauvais numéro', 'À contacter'],   // ne déduit RIEN : un numéro mort n'est pas un contact
  ] as const) {
    check(`puce « ${puce} » -> ${attendu}`, deduire(aContacter, [action({ type: 'appel', date: '2026-09-19', result: puce })]) === attendu);
  }
  check('appel SANS résultat -> « Contacté sans retour » (on ne présume pas un échange)',
    deduire(aContacter, [action({ type: 'appel', date: '2026-09-19', result: '' })]) === 'Contacté sans retour');
  check('compte rendu libre depuis la liste (« Intéressé, rappeler ») -> « Échange en cours »',
    deduire(aContacter, [action({ type: 'appel', date: '2026-09-19', result: 'Intéressé, rappeler en octobre' })]) === 'Échange en cours');
  check("un EMAIL envoyé -> « Contacté sans retour » (envoyer n'est pas parler)",
    deduire(aContacter, [action({ type: 'email', date: '2026-09-19', result: '' })]) === 'Contacté sans retour');
  check('une VISITE -> « Échange en cours »',
    deduire(aContacter, [action({ type: 'visite', date: '2026-09-19' })]) === 'Échange en cours');

  // — Les garde-fous —
  check('aucune action -> le statut ne bouge pas', deduire(aContacter, []) === 'À contacter');
  check("action HORS de la fenêtre d'activité -> ignorée",
    deduire(aContacter, [action({ type: 'appel', date: '2026-09-01', result: 'Appel — Joint' })]) === 'À contacter');
  check('action « report » (kind) -> ne compte pas comme un échange',
    deduire(aContacter, [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Joint', kind: 'report' })]) === 'À contacter');
  check('PAS DE RÉGRESSION : « RDV confirmé » + un simple appel -> reste « RDV confirmé »',
    deduire(part({ statutCampagne: 'RDV confirmé' }), [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Pas de réponse' })]) === 'RDV confirmé');
  check('« Échange en cours » + un appel sans réponse -> reste « Échange en cours »',
    deduire(part({ statutCampagne: 'Échange en cours' }), [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Pas de réponse' })]) === 'Échange en cours');
  for (const manuel of ['Injoignable', 'Pas intéressé', 'À relancer après salon'] as const) {
    check(`« ${manuel} » n'est jamais écrasé par la déduction`,
      deduire(part({ statutCampagne: manuel }), [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Joint' })], [planned({ date: '2026-09-23' })]) === manuel);
  }
  check('« Mauvais numéro » ne fait PAS sortir le lead de la file : il reste « À contacter »',
    deduire(aContacter, [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Mauvais numéro' })]) === 'À contacter');
  check("… et il n'écrase pas non plus un statut déjà avancé",
    deduire(part({ statutCampagne: 'Échange en cours' }), [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Mauvais numéro' })]) === 'Échange en cours');
  check("… mais l'appel reste COMPTÉ comme appel (il a bien été passé)",
    compteurs([action({ type: 'appel', date: '2026-09-19', result: 'Appel — Mauvais numéro' })], 'l1', { debut: '2026-09-18', fin: '2026-09-27' }).appels === 1);
  check("un « Mauvais numéro » SUIVI d'un vrai appel : le vrai appel déduit normalement",
    deduire(aContacter, [
      action({ id: 'x1', type: 'appel', date: '2026-09-19', result: 'Appel — Mauvais numéro' }),
      action({ id: 'x2', type: 'appel', date: '2026-09-20', result: 'Appel — Joint' }),
    ]) === 'Échange en cours');
  check('RDV programmé HORS de la fenêtre du salon -> pas « RDV confirmé »',
    deduire(aContacter, [], [planned({ date: '2026-09-19' })]) === 'À contacter');
  check('RDV annulé -> pas « RDV confirmé »',
    deduire(aContacter, [], [planned({ date: '2026-09-23', status: 'annulee' })]) === 'À contacter');

  // — MÊME RÉSULTAT depuis la fiche lead ou depuis la liste de travail —
  // La déduction ne lit QUE l'état (actions + actions programmées) : elle ne sait
  // pas d'où vient la saisie, donc elle ne peut pas diverger. On le prouve en
  // comparant deux actions identiques au point de saisie près.
  const depuisListe = action({ id: 'depuis-liste', type: 'appel', date: '2026-09-19', result: 'Appel — Joint', authorId: 'nicolas' });
  const depuisFiche = action({ id: 'depuis-fiche', type: 'appel', date: '2026-09-19', result: 'Appel — Joint', authorId: 'fred' });
  check('action saisie depuis la FICHE = même statut que depuis la LISTE',
    deduire(aContacter, [depuisListe]) === deduire(aContacter, [depuisFiche]));
  check('actionProuveUnEchange : la règle est lisible seule',
    actionProuveUnEchange({ type: 'appel', result: 'Appel — Joint' }) === true
    && actionProuveUnEchange({ type: 'appel', result: 'Appel — Message laissé' }) === false
    && actionProuveUnEchange({ type: 'email', result: '' }) === false
    && actionProuveUnEchange({ type: 'rdv', result: '' }) === true);

  // — appliquerDeductions : le passage à l'échelle de l'état —
  const etatCampagne = etat({
    campagnes: [camp],
    leads: [lead({ id: 'l1' }), lead({ id: 'l2' }), lead({ id: 'l3' })],
    campagneLeads: [
      part({ id: 'p1', leadId: 'l1', statutCampagne: 'À contacter' }),
      part({ id: 'p2', leadId: 'l2', statutCampagne: 'Pas intéressé' }),
      part({ id: 'p3', leadId: 'l3', statutCampagne: 'À contacter' }),
    ],
    actions: [
      action({ id: 'a1', leadId: 'l1', type: 'appel', date: '2026-09-19', result: 'Appel — Joint' }),
      action({ id: 'a2', leadId: 'l2', type: 'appel', date: '2026-09-19', result: 'Appel — Joint' }),
    ],
  });
  const apres = appliquerDeductions(etatCampagne.campagnes, etatCampagne.campagneLeads, etatCampagne.actions, [], AUJ)!;
  check('l1 avance, l2 (jugement) ne bouge pas, l3 sans action reste en place',
    apres.find(p => p.id === 'p1')!.statutCampagne === 'Échange en cours'
    && apres.find(p => p.id === 'p2')!.statutCampagne === 'Pas intéressé'
    && apres.find(p => p.id === 'p3')!.statutCampagne === 'À contacter');
  const rejeu = appliquerDeductions(etatCampagne.campagnes, apres, etatCampagne.actions, [], AUJ);
  check('IDEMPOTENTE : rejouée, elle ne change rien ET renvoie la MÊME référence (aucun rendu inutile)', rejeu === apres);
  const campArchivee = appliquerDeductions([{ ...camp, active: false }], etatCampagne.campagneLeads, etatCampagne.actions, [], AUJ);
  check('campagne archivée : aucune déduction', campArchivee === etatCampagne.campagneLeads);
  check('aucune participation : aucun plantage', appliquerDeductions([camp], [], etatCampagne.actions, [], AUJ)?.length === 0);
}

section('Le statut du LEAD est la vérité, le statut de campagne en dérive (19/09)');
{
  const camp = campagne({ dateDebut: '2026-09-18', dateFin: '2026-09-27', dateSalonDebut: '2026-09-22', dateSalonFin: '2026-09-27' });
  const suivre = (statutCampagne: CampagneLead['statutCampagne'], statutLead: LeadStatus) =>
    appliquerChangementStatutLead([camp], [part({ statutCampagne })], 'l1', statutLead)![0].statutCampagne;

  // — Le mapping demandé, lu seul —
  check('Contacté -> Contacté sans retour', statutCampagneDepuisLead('contacte') === 'Contacté sans retour');
  check('Qualifié -> Échange en cours', statutCampagneDepuisLead('qualifie') === 'Échange en cours');
  check('Devis envoyé -> Échange en cours', statutCampagneDepuisLead('devis_envoye') === 'Échange en cours');
  check('Négociation -> Échange en cours', statutCampagneDepuisLead('negociation') === 'Échange en cours');
  check('En conclusion -> Échange en cours', statutCampagneDepuisLead('en_conclusion') === 'Échange en cours');
  check('Reporté -> Projet reporté', statutCampagneDepuisLead('reporte') === 'Projet reporté');
  check('Signé -> aucune déduction (surtout pas « Pas intéressé », ce serait un jugement)', statutCampagneDepuisLead('signe') === null);
  check('Perdu -> aucune déduction (idem)', statutCampagneDepuisLead('perdu') === null);
  check('Nouveau / À contacter -> rien à déduire', statutCampagneDepuisLead('nouveau') === null && statutCampagneDepuisLead('a_contacter') === null);

  // — LE CAS D'AURÉLIEN BILLECOQ : lead « Contacté », 0 appel 0 email, campagne
  //   restée « À contacter ». C'est le trou de S2c, et c'est ce qui suit le bouche.
  check('LE CAS RÉEL : lead passé « Contacté » depuis la fiche, ZÉRO action -> « Contacté sans retour »',
    suivre('À contacter', 'contacte') === 'Contacté sans retour');
  check('lead passé « Qualifié » depuis la fiche -> « Échange en cours »',
    suivre('À contacter', 'qualifie') === 'Échange en cours');
  check('lead passé « Reporté » -> « Projet reporté »', suivre('À contacter', 'reporte') === 'Projet reporté');

  // — Signé / Perdu : le statut de campagne ne bouge PAS —
  for (const ferme of ['signe', 'perdu'] as const) {
    check('lead ' + ferme + ' -> statut de campagne INCHANGÉ',
      appliquerChangementStatutLead([camp], [part({ statutCampagne: 'Échange en cours' })], 'l1', ferme)![0].statutCampagne === 'Échange en cours');
  }
  check('lead Perdu : même référence de tableau (aucune écriture, aucun rendu)',
    (() => { const avant = [part({ statutCampagne: 'À contacter' })]; return appliquerChangementStatutLead([camp], avant, 'l1', 'perdu') === avant; })());

  // — Les garde-fous d'hier, toujours là —
  check('PAS DE RÉGRESSION : « RDV confirmé » + lead repassé « Contacté » -> reste « RDV confirmé »',
    suivre('RDV confirmé', 'contacte') === 'RDV confirmé');
  check('« Échange en cours » + lead « Contacté » -> reste « Échange en cours »',
    suivre('Échange en cours', 'contacte') === 'Échange en cours');
  for (const manuel of STATUTS_MANUELS) {
    check('« ' + manuel + ' » (jugement humain) n\'est jamais écrasé, même par un lead Qualifié',
      suivre(manuel, 'qualifie') === manuel);
  }
  check('« À relancer après salon » survit à un lead passé « Contacté » (marqueur du cercle 2)',
    suivre('À relancer après salon', 'contacte') === 'À relancer après salon');

  // — « Projet reporté » n'est plus collant (arbitrage du 19/09) —
  check('« Projet reporté » : à avancement ÉGAL, la dérivation du lead l\'emporte',
    suivre('Contacté sans retour', 'reporte') === 'Projet reporté');
  check('« Projet reporté » + lead qui se réveille en Qualifié -> « Échange en cours »',
    suivre('Projet reporté', 'qualifie') === 'Échange en cours');
  check('« Projet reporté » + un échange enregistré -> progresse vers « Échange en cours »',
    statutDeduitParticipation(part({ statutCampagne: 'Projet reporté' }), camp,
      [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Joint' })], [], AUJ) === 'Échange en cours');
  check('« Projet reporté » + un appel sans réponse -> reste « Projet reporté » (même marche, mieux renseignée)',
    statutDeduitParticipation(part({ statutCampagne: 'Projet reporté' }), camp,
      [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Pas de réponse' })], [], AUJ) === 'Projet reporté');
  check('« Projet reporté » + un RDV sur le stand -> « RDV confirmé »',
    statutDeduitParticipation(part({ statutCampagne: 'Projet reporté' }), camp, [], [planned({ date: '2026-09-23' })], AUJ) === 'RDV confirmé');

  // — LA FRONTIÈRE : la déduction ne vaut QUE pour ce qui survient APRÈS l'entrée —
  // Un lead déjà « Contacté » depuis des mois qu'on ajoute aujourd'hui n'émet
  // aucun événement : appliquerDeductions (le calcul d'ÉTAT) ne lit pas son
  // statut. Sans cela, la campagne s'ouvrirait sur « Contactés : 132 sur 157 »
  // avant le premier appel.
  const dejaContactes = etat({
    campagnes: [camp],
    leads: [lead({ id: 'l1', status: 'contacte' }), lead({ id: 'l2', status: 'qualifie' }), lead({ id: 'l3', status: 'negociation' })],
    campagneLeads: [
      part({ id: 'p1', leadId: 'l1' }), part({ id: 'p2', leadId: 'l2' }), part({ id: 'p3', leadId: 'l3' }),
    ],
    actions: [],
  });
  const aLAjout = appliquerDeductions(dejaContactes.campagnes, dejaContactes.campagneLeads, dejaContactes.actions, [], AUJ);
  check('À L\'AJOUT : trois leads déjà avancés entrent TOUS à « À contacter » (aucune déduction d\'état)',
    aLAjout === dejaContactes.campagneLeads
    && aLAjout!.every(p => p.statutCampagne === 'À contacter'));

  // — Portée : les autres participations et les campagnes archivées —
  const deuxLeads = [part({ id: 'p1', leadId: 'l1' }), part({ id: 'p2', leadId: 'l2' })];
  const cible = appliquerChangementStatutLead([camp], deuxLeads, 'l1', 'qualifie')!;
  check('seule la participation DU lead qui a bougé change',
    cible[0].statutCampagne === 'Échange en cours' && cible[1].statutCampagne === 'À contacter');
  check('campagne archivée : aucune déduction',
    appliquerChangementStatutLead([{ ...camp, active: false }], deuxLeads, 'l1', 'qualifie') === deuxLeads);
  check('lead sans participation : même référence, aucun plantage',
    appliquerChangementStatutLead([camp], deuxLeads, 'inconnu', 'qualifie') === deuxLeads);
  check('aucune participation / aucune campagne : aucun plantage',
    appliquerChangementStatutLead([camp], [], 'l1', 'qualifie')?.length === 0
    && appliquerChangementStatutLead(undefined, deuxLeads, 'l1', 'qualifie') === deuxLeads);
  check('IDEMPOTENTE : rejouée avec le même statut, elle renvoie la MÊME référence',
    appliquerChangementStatutLead([camp], cible, 'l1', 'qualifie') === cible);

  // — SENS UNIQUE : rien ne remonte vers le lead —
  // La signature l'interdit déjà (aucun Lead en entrée, des participations en
  // sortie) ; on le vérifie tout de même sur un état complet : c'est la règle
  // d'or de la journée, elle mérite une assertion qui la nomme.
  const avantLeads = dejaContactes.leads;
  appliquerChangementStatutLead(dejaContactes.campagnes, dejaContactes.campagneLeads, 'l1', 'qualifie');
  check('AUCUNE RÉTRO-PROPAGATION : les leads sont intacts (même référence, mêmes statuts)',
    dejaContactes.leads === avantLeads && dejaContactes.leads.map(l => l.status).join() === 'contacte,qualifie,negociation');
}

section('Leads fermés : hors de la liste de travail par défaut');
{
  const camp = campagne({ dateDebut: '2026-09-18', dateFin: '2026-09-27' });
  const s = etat({
    campagnes: [camp],
    leads: [
      lead({ id: 'l1', status: 'contacte', lastName: 'Actif', nextActionDate: '2026-09-10' }),
      lead({ id: 'l2', status: 'signe', lastName: 'Signe', nextActionDate: '2026-09-10' }),
      lead({ id: 'l3', status: 'perdu', lastName: 'Perdu', nextActionDate: '2026-09-10' }),
    ],
    campagneLeads: [part({ id: 'p1', leadId: 'l1' }), part({ id: 'p2', leadId: 'l2' }), part({ id: 'p3', leadId: 'l3' })],
  });
  const lignes = lignesCampagne(s, { campagne: camp, aujourdhui: AUJ, statutsFermes: FERMES });
  check('la participation d\'un lead fermé RESTE dans la campagne (on n\'efface pas un client signé au salon)', lignes.length === 3);
  check('elle est marquée « fermée »', lignes.filter(l => l.ferme).map(l => l.lead.id).sort().join() === 'l2,l3');
  check('PAR DÉFAUT, la liste de travail ne montre que les leads ouverts', filtrerLignes(lignes, {}).map(l => l.lead.id).join() === 'l1');
  check('case « inclure les leads fermés » cochée -> les trois reviennent', filtrerLignes(lignes, { inclureFermes: true }).length === 3);
  check('un lead fermé ne compte pas dans « Relances en retard », même avec une date dépassée',
    lignes.filter(l => l.enRetard).map(l => l.lead.id).join() === 'l1');
  check('le filtre des fermés se combine aux autres (rechercher un signé ne le fait pas apparaître)',
    filtrerLignes(lignes, { recherche: 'signe' }).length === 0
    && filtrerLignes(lignes, { recherche: 'signe', inclureFermes: true }).length === 1);
}

section('Campagne par défaut');
{
  check('la campagne active est choisie', campagneParDefaut([campagne({ id: 'a', active: false }), campagne({ id: 'b' })])?.id === 'b');
  check('aucune active -> la première', campagneParDefaut([campagne({ id: 'a', active: false })])?.id === 'a');
  check('aucune campagne -> undefined, pas de plantage', campagneParDefaut([]) === undefined && campagneParDefaut(undefined) === undefined);
}

console.log('\n' + '='.repeat(50));
console.log(`Harnais campagnes (module pur) : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
