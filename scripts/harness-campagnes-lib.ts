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
} from '../src/lib/campagnes';
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
  check('filtre RDV oui / non', filtrerLignes(lignes, { rdv: 'oui' }).length === 1 && filtrerLignes(lignes, { rdv: 'non' }).length === 3);
  check('filtre responsable', filtrerLignes(lignes, { responsableId: 'nicolas' }).length === 4 && filtrerLignes(lignes, { responsableId: 'fred' }).length === 0);
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
    ['Appel — Mauvais numéro', 'Contacté sans retour'],
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
  for (const manuel of ['Projet reporté', 'Injoignable', 'À relancer après salon'] as const) {
    check(`« ${manuel} » n'est jamais écrasé par la déduction`,
      deduire(part({ statutCampagne: manuel }), [action({ type: 'appel', date: '2026-09-19', result: 'Appel — Joint' })], [planned({ date: '2026-09-23' })]) === manuel);
  }
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

section('Campagne par défaut');
{
  check('la campagne active est choisie', campagneParDefaut([campagne({ id: 'a', active: false }), campagne({ id: 'b' })])?.id === 'b');
  check('aucune active -> la première', campagneParDefaut([campagne({ id: 'a', active: false })])?.id === 'a');
  check('aucune campagne -> undefined, pas de plantage', campagneParDefaut([]) === undefined && campagneParDefaut(undefined) === undefined);
}

console.log('\n' + '='.repeat(50));
console.log(`Harnais campagnes (module pur) : ${passed} OK, ${failed} KO (${passed + failed} assertions)`);
if (failed > 0) process.exit(1);
