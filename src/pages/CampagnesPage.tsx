import { useMemo, useState } from 'react';
import { Megaphone, Phone, Mail, AlertTriangle, CalendarCheck, Search, PhoneCall } from 'lucide-react';
import { useApp } from '../context/useApp';
import { useNextActionFlow } from '../context/useNextActionFlow';
import { useToast } from '../context/useToast';
import Modal from '../components/ui/Modal';
import ActionForm from '../components/leads/ActionForm';
import { formatCurrency } from '../lib/utils';
import LeadLink from '../components/leads/LeadLink';
import { StatusBadge, TemperatureBadge } from '../components/ui/StatusBadge';
import {
  lignesCampagne, filtrerLignes, campagneParDefaut, datesSalonARenseigner, estContacte,
  type FiltresCampagne, type LigneCampagne,
} from '../lib/campagnes';
import { PLANNING_CLOSED_STATUSES, eligibleCommercials } from '../lib/plannedActions';
import { CAMPAGNE_PRIORITES, CAMPAGNE_STATUTS } from '../data/types';
import { SEGMENTS_CAMPAGNE } from '../data/constants';
import { formatDateShort, toISODate, cn, getLeadFullName } from '../lib/utils';

/**
 * LOT SALONS (S2b) — écran d'une campagne : LA LISTE DE TRAVAIL.
 *
 * C'est l'outil des quatre jours qui précèdent le salon, et l'écran de la
 * démonstration. Principes tenus ici :
 *
 *  - TOUT CE QUI SE COMPTE EST DÉRIVÉ : nombre d'appels, d'emails, dernier
 *    contact, RDV sur le stand. Rien n'est saisi à la main, donc rien ne ment.
 *  - LA PROCHAINE ACTION EST CELLE DU LEAD (résumé v4), pas une date stockée
 *    dans la campagne : une seule vérité, et le retard se lit comme dans
 *    l'Agenda (rouge, hors Signés / Perdus).
 *  - LE NOM OUVRE LA FICHE DANS UN NOUVEL ONGLET (convention v4) : on ne perd
 *    jamais sa liste d'appels en consultant un dossier.
 */
export default function CampagnesPage() {
  const { state, getCommercialName, addAction, updateLead, updateCampagneLead } = useApp();
  // Lot 2 : après TOUTE action, la fenêtre « Prochaine action » s'ouvre. Elle vit
  // au-dessus des routes, donc elle fonctionne depuis cet écran comme depuis la fiche.
  const flow = useNextActionFlow();
  const toast = useToast();
  const aujourdhui = toISODate(new Date());

  // S2d — ENREGISTRER UN ÉCHANGE SANS QUITTER LA LISTE.
  //
  // Constat qui a fait passer cette étape devant l'édition en ligne : sur 11 mois
  // et 443 leads, l'historique ne porte que 30 appels pour 99 emails. Or TOUS les
  // compteurs de cet écran sont dérivés de ces enregistrements. Moins il y a de
  // friction entre « je raccroche » et « c'est noté », plus les chiffres valent
  // quelque chose. D'où : un bouton par ligne, la MÊME saisie que la fiche
  // (ActionForm, aucun second formulaire), et l'écran ne bouge pas sous les yeux.
  //
  // L'action est rattachée au LEAD, comme partout. Son appartenance à la campagne
  // est DÉRIVÉE : elle tombe dans la fenêtre d'activité, donc elle compte. Rien
  // n'est stocké en double.
  const [echangeLeadId, setEchangeLeadId] = useState<string | null>(null);

  const campagnes = state.campagnes ?? [];
  const [campagneId, setCampagneId] = useState(() => campagneParDefaut(campagnes)?.id ?? '');
  const campagne = campagnes.find(c => c.id === campagneId) ?? campagneParDefaut(campagnes);

  // Lead dont on saisit l'échange, et responsable de SA participation : calculés
  // APRÈS `campagne` — sinon on lirait `campagneId` avant son initialisation
  // (plantage de rendu attrapé au test réel du 18/09, invisible au typecheck
  // parce que la lecture se fait dans une callback).
  const leadEnCours = echangeLeadId ? state.leads.find(l => l.id === echangeLeadId) : undefined;
  const responsableDuLead = echangeLeadId && campagne
    ? (state.campagneLeads ?? []).find(p => p.leadId === echangeLeadId && p.campagneId === campagne.id)?.responsableId
    : undefined;

  const [filtres, setFiltres] = useState<FiltresCampagne>({});
  // Changer un filtre repart de la première page (sinon on garde un « 200
  // affichés » sans rapport avec le nouveau résultat).
  const majFiltre = (patch: Partial<FiltresCampagne>) => {
    setFiltres(f => ({ ...f, ...patch }));
    setCombienAffiches(PAR_PAGE);
  };

  const lignes = useMemo(
    () => (campagne ? lignesCampagne(state, { campagne, aujourdhui, statutsFermes: PLANNING_CLOSED_STATUSES }) : []),
    [state, campagne, aujourdhui],
  );
  const filtrees = useMemo(() => filtrerLignes(lignes, filtres), [lignes, filtres]);

  // PAGINATION PROGRESSIVE, comme la liste des leads. Mesuré le 18/09 : rendre
  // 443 lignes d'un coup fige l'écran plusieurs secondes — inacceptable pour un
  // commercial au téléphone, et intenable en démonstration. On rend 50 lignes,
  // le reste à la demande. Les REPÈRES du haut, eux, comptent TOUJOURS sur la
  // totalité : on ne veut pas d'un chiffre qui dépend de ce qui est affiché.
  const PAR_PAGE = 50;
  const [combienAffiches, setCombienAffiches] = useState(PAR_PAGE);
  const visibles = filtrees.length > combienAffiches ? filtrees.slice(0, combienAffiches) : filtrees;

  // Repères de tête de page — dérivés eux aussi, sur la fenêtre d'activité.
  const contactes = lignes.filter(l => estContacte(l.compteurs)).length;
  const enRetard = lignes.filter(l => l.enRetard).length;
  const avecRdv = lignes.filter(l => l.rdv).length;

  const responsables = useMemo(() => eligibleCommercials(state.commercials), [state.commercials]);
  const segmentsPresents = useMemo(
    () => [...new Set(lignes.map(l => l.participation.segment).filter(Boolean))].sort(),
    [lignes],
  );

  if (!campagne) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Campagnes</h1>
        <div className="card p-8 text-center text-gray-500">
          <Megaphone className="w-8 h-8 mx-auto mb-3 text-gray-300" />
          <p>Aucune campagne pour le moment.</p>
          <p className="text-sm mt-1">La campagne du salon est créée par la migration ; rechargez la page si elle vient d'être posée.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Megaphone className="w-6 h-6 text-primary-600" /> Campagnes
        </h1>
        <select
          className="select w-auto text-sm"
          value={campagne.id}
          onChange={e => setCampagneId(e.target.value)}
          aria-label="Campagne affichée"
        >
          {campagnes.map(c => (
            <option key={c.id} value={c.id}>{c.nom}{c.active ? '' : ' (archivée)'}</option>
          ))}
        </select>
      </div>

      {/* En-tête de campagne : ce qu'elle est, et ce qui lui manque. */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-lg font-semibold text-gray-900">{campagne.nom}</span>
          <span className="text-sm text-gray-500">
            {campagne.lieu && <>{campagne.lieu} · </>}
            préparation depuis le {formatDateShort(campagne.dateDebut)}
            {campagne.dateSalonDebut && campagne.dateSalonFin && (
              <> · salon du {formatDateShort(campagne.dateSalonDebut)} au {formatDateShort(campagne.dateSalonFin)}</>
            )}
          </span>
        </div>

        {datesSalonARenseigner(campagne) && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 flex items-start gap-2" data-testid="campagne-dates-manquantes">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Dates du salon à renseigner.</strong> En attendant, la colonne « RDV stand » compte les rendez-vous
              de toute la période d'activité — un chiffre approché, jamais présenté comme exact.
            </span>
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Repere libelle="Participants" valeur={lignes.length} />
          <Repere libelle="Contactés" valeur={contactes} detail={`sur ${lignes.length}`} />
          <Repere libelle="RDV stand" valeur={avecRdv} />
          <Repere libelle="Relances en retard" valeur={enRetard} alerte={enRetard > 0} />
        </div>
      </div>

      {/* Filtres : le commercial au téléphone doit retrouver SA liste en un geste. */}
      <div className="card p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <div className="relative col-span-2 sm:col-span-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            className="input pl-8 text-sm" placeholder="Rechercher…"
            value={filtres.recherche ?? ''} onChange={e => majFiltre({ recherche: e.target.value })}
            aria-label="Rechercher un participant"
          />
        </div>
        <select className="select text-sm" value={filtres.responsableId ?? ''} onChange={e => majFiltre({ responsableId: e.target.value })} aria-label="Responsable">
          <option value="">Responsable</option>
          {responsables.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="select text-sm" value={filtres.statutCampagne ?? ''} onChange={e => majFiltre({ statutCampagne: e.target.value })} aria-label="Statut de campagne">
          <option value="">Statut</option>
          {CAMPAGNE_STATUTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select text-sm" value={filtres.segment ?? ''} onChange={e => majFiltre({ segment: e.target.value })} aria-label="Segment">
          <option value="">Segment</option>
          {(segmentsPresents.length ? segmentsPresents : [...SEGMENTS_CAMPAGNE]).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="select text-sm" value={filtres.priorite ?? ''} onChange={e => majFiltre({ priorite: e.target.value })} aria-label="Priorité">
          <option value="">Priorité</option>
          {CAMPAGNE_PRIORITES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <select className="select text-sm" value={filtres.rdv ?? ''} onChange={e => majFiltre({ rdv: e.target.value })} aria-label="RDV sur le stand">
            <option value="">RDV</option>
            <option value="oui">RDV oui</option>
            <option value="non">RDV non</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-gray-700 whitespace-nowrap">
            <input
              type="checkbox" className="w-4 h-4"
              checked={!!filtres.enRetardSeulement}
              onChange={e => majFiltre({ enRetardSeulement: e.target.checked })}
            />
            En retard
          </label>
        </div>
      </div>

      <div className="text-sm text-gray-500" data-testid="campagne-compte">
        {filtrees.length} participant{filtrees.length > 1 ? 's' : ''}
        {filtrees.length !== lignes.length && <> sur {lignes.length}</>}
        {filtrees.length > visibles.length && <> — {visibles.length} affichés</>}
      </div>

      {/* MOBILE : une carte par participant. Téléphone, statut et repères sont
          atteignables sans défilement latéral (375 px). */}
      <div className="card overflow-hidden sm:hidden">
        <div className="divide-y divide-gray-100">
          {visibles.map(l => (
            <CarteParticipant
              key={l.participation.id}
              ligne={l}
              nomCommercial={getCommercialName}
              onEchange={setEchangeLeadId}
              onStatut={(id, statut) => updateCampagneLead(id, { statutCampagne: statut as LigneCampagne['participation']['statutCampagne'] })}
            />
          ))}
          {visibles.length === 0 && <p className="px-4 py-10 text-center text-gray-400">Aucun participant</p>}
        </div>
      </div>

      {/* DESKTOP : le tableau de travail. */}
      <div className="card overflow-hidden hidden sm:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-3 py-3 text-left font-medium text-gray-600">Nom</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Téléphone / email</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Responsable</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Segment</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Prio.</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Statut campagne</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Temp.</th>
                <th className="px-3 py-3 text-center font-medium text-gray-600" title="Appels et emails sur la période de campagne">Éch.</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Dernier contact</th>
                <th className="px-3 py-3 text-left font-medium text-gray-600">Prochaine action</th>
                <th className="px-3 py-3 text-center font-medium text-gray-600">RDV stand</th>
                <th className="px-3 py-3 text-center font-medium text-gray-600 w-28">Échange</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(l => (
                <tr key={l.participation.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2.5">
                    {/* Convention v4 : la fiche s'ouvre dans un nouvel onglet. */}
                    <LeadLink leadId={l.lead.id} className="font-medium text-gray-900 hover:text-primary-600">
                      {getLeadFullName(l.lead)}
                    </LeadLink>
                    <div className="text-xs text-gray-500">{l.lead.boatInterest || '—'}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {l.lead.phone
                      ? <a href={`tel:${l.lead.phone}`} className="text-primary-600 hover:underline block">{l.lead.phone}</a>
                      : <span className="text-gray-400 block">—</span>}
                    {l.lead.email
                      ? <a href={`mailto:${l.lead.email}`} className="text-gray-600 hover:underline block truncate max-w-[180px]">{l.lead.email}</a>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {/* Édition EN LIGNE : enregistrement immédiat, même file
                        optimiste que le reste de l'app — l'écran ne bouge pas,
                        la ligne reste à sa place. */}
                    <select
                      className="select select-inline text-xs"
                      value={l.participation.responsableId}
                      onChange={e => updateCampagneLead(l.participation.id, { responsableId: e.target.value })}
                      aria-label={`Responsable de ${getLeadFullName(l.lead)}`}
                      data-testid={`resp-${l.lead.id}`}
                    >
                      {responsables.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      {!responsables.some(c => c.id === l.participation.responsableId) && (
                        <option value={l.participation.responsableId}>{getCommercialName(l.participation.responsableId)}</option>
                      )}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">{l.participation.segment || '—'}</td>
                  <td className="px-3 py-2.5">
                    <select
                      className="select select-inline text-xs"
                      value={l.participation.priorite}
                      onChange={e => updateCampagneLead(l.participation.id, { priorite: e.target.value as LigneCampagne['participation']['priorite'] })}
                      aria-label={`Priorité de ${getLeadFullName(l.lead)}`}
                      data-testid={`prio-${l.lead.id}`}
                    >
                      {CAMPAGNE_PRIORITES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2.5">
                    {/* Le statut est POSÉ PAR LA DÉDUCTION (un échange enregistré
                        le fait avancer tout seul) ; ce menu sert à CORRIGER, et
                        à poser les statuts de jugement que l'on ne devine pas. */}
                    <select
                      className="select select-inline text-xs"
                      value={l.participation.statutCampagne}
                      onChange={e => updateCampagneLead(l.participation.id, { statutCampagne: e.target.value as LigneCampagne['participation']['statutCampagne'] })}
                      aria-label={`Statut de campagne de ${getLeadFullName(l.lead)}`}
                      data-testid={`statut-${l.lead.id}`}
                    >
                      {CAMPAGNE_STATUTS.map(st => <option key={st} value={st}>{st}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2.5"><TemperatureBadge temperature={l.lead.temperature} /></td>
                  <td className="px-3 py-2.5 text-center text-xs whitespace-nowrap" title="Appels · emails, sur la période de campagne">
                    <span className="inline-flex items-center gap-1 text-gray-700"><Phone className="w-3 h-3" />{l.compteurs.appels}</span>
                    <span className="inline-flex items-center gap-1 text-gray-700 ml-2"><Mail className="w-3 h-3" />{l.compteurs.emails}</span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-600">
                    {l.compteurs.dernierContact ? formatDateShort(l.compteurs.dernierContact) : <span className="text-gray-400">jamais</span>}
                  </td>
                  <td className={cn('px-3 py-2.5 text-xs', l.enRetard && 'text-danger-600 font-medium')}>
                    {l.prochaineAction
                      ? <>{formatDateShort(l.prochaineAction)}{l.enRetard && ' ⚠'}</>
                      : <span className="text-gray-400">à planifier</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {l.rdv
                      ? <span className="inline-flex items-center gap-1 text-xs text-green-700"><CalendarCheck className="w-3.5 h-3.5" />{formatDateShort(l.rdv.date)}{l.rdv.time ? ` ${l.rdv.time}` : ''}</span>
                      : <span className="text-xs text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      type="button"
                      className="btn-secondary btn-sm whitespace-nowrap"
                      onClick={() => setEchangeLeadId(l.lead.id)}
                      title="Enregistrer un appel, un email ou une visite — sans quitter la liste"
                      data-testid={`echange-${l.lead.id}`}
                    >
                      <PhoneCall className="w-3.5 h-3.5" /> Échange
                    </button>
                  </td>
                </tr>
              ))}
              {visibles.length === 0 && (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-400">Aucun participant</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {filtrees.length > visibles.length && (
        <div className="flex justify-center">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setCombienAffiches(n => n + PAR_PAGE)}>
            Afficher {Math.min(PAR_PAGE, filtrees.length - visibles.length)} participants de plus
            <span className="text-gray-500"> ({visibles.length} / {filtrees.length})</span>
          </button>
        </div>
      )}

      {/* Saisie d'un échange : le composant de la fiche, tel quel, en modale. */}
      <Modal
        open={!!leadEnCours}
        onClose={() => setEchangeLeadId(null)}
        title={leadEnCours ? `Échange — ${getLeadFullName(leadEnCours)}` : 'Échange'}
        size="lg"
      >
        {leadEnCours && (
          <ActionForm
            leadId={leadEnCours.id}
            defaultAuthorId={responsableDuLead}
            onSave={(action, extras) => {
              addAction(action);
              // Exactement l'enchaînement de la fiche lead : l'action, puis la
              // fenêtre « Prochaine action » (obligatoire selon le statut).
              flow.decide(leadEnCours.id, { kind: 'action_enregistree', newStatus: action.newStatus, currentStatus: leadEnCours.status });
              if (extras?.quoteAmount !== undefined) updateLead(leadEnCours.id, { quoteAmount: extras.quoteAmount });
              if (extras?.lossReason) updateLead(leadEnCours.id, { lossReason: extras.lossReason });
              setEchangeLeadId(null);
              if (extras?.quoteAmount !== undefined) toast.success(`Vente enregistrée — ${formatCurrency(extras.quoteAmount)}`);
              else if (extras?.lossReason) toast.info(`Lead marqué perdu — ${extras.lossReason}`);
              else toast.success('Échange enregistré');
            }}
            onCancel={() => setEchangeLeadId(null)}
          />
        )}
      </Modal>

      <p className="text-xs text-gray-500">
        Appels et emails sont <strong>comptés depuis l'historique</strong> sur la période de la campagne : aucun compteur
        n'est saisi à la main. La prochaine action et son retard sont ceux de la fiche du lead — une seule vérité.
        Le <strong>statut de campagne avance tout seul</strong> quand un échange est enregistré (ici ou depuis la fiche) :
        contacté, échange en cours, RDV confirmé. Les menus servent à <strong>corriger</strong>, et à poser ce qui relève
        du jugement — « Pas intéressé », « Injoignable », « Projet reporté », « À relancer après salon » — que rien ne devine.
      </p>
    </div>
  );
}

function Repere({ libelle, valeur, detail, alerte }: { libelle: string; valeur: number; detail?: string; alerte?: boolean }) {
  return (
    <div className={cn('rounded-lg border p-3', alerte ? 'border-danger-200 bg-danger-50' : 'border-gray-200 bg-gray-50')}>
      <div className="text-xs text-gray-600">{libelle}</div>
      <div className={cn('text-xl font-semibold', alerte ? 'text-danger-700' : 'text-gray-900')}>{valeur}</div>
      {detail && <div className="text-xs text-gray-500">{detail}</div>}
    </div>
  );
}

function BadgePriorite({ priorite }: { priorite: string }) {
  const style = priorite === 'Haute' ? 'bg-red-100 text-red-800'
    : priorite === 'Basse' ? 'bg-gray-100 text-gray-700'
      : 'bg-amber-100 text-amber-800';
  return <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', style)}>{priorite}</span>;
}

/** Carte mobile : le téléphone et le statut d'abord, sans défilement latéral. */
function CarteParticipant({ ligne: l, nomCommercial, onEchange, onStatut }: {
  ligne: LigneCampagne;
  nomCommercial: (id: string) => string;
  onEchange: (leadId: string) => void;
  onStatut: (participationId: string, statut: string) => void;
}) {
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <LeadLink leadId={l.lead.id} className="font-medium text-gray-900 block truncate">{getLeadFullName(l.lead)}</LeadLink>
          <div className="text-xs text-gray-500 truncate">{l.participation.segment || '—'} · {nomCommercial(l.participation.responsableId)}</div>
        </div>
        <BadgePriorite priorite={l.participation.priorite} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          className="select select-inline text-xs py-1"
          value={l.participation.statutCampagne}
          onChange={e => onStatut(l.participation.id, e.target.value)}
          aria-label={`Statut de campagne de ${getLeadFullName(l.lead)}`}
        >
          {CAMPAGNE_STATUTS.map(st => <option key={st} value={st}>{st}</option>)}
        </select>
        <StatusBadge status={l.lead.status} />
        <TemperatureBadge temperature={l.lead.temperature} />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-2 text-gray-700">
          <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{l.compteurs.appels}</span>
          <span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" />{l.compteurs.emails}</span>
          <span className="text-gray-500">{l.compteurs.dernierContact ? formatDateShort(l.compteurs.dernierContact) : 'jamais contacté'}</span>
        </span>
        <span className={cn(l.enRetard ? 'text-danger-600 font-medium' : 'text-gray-600')}>
          {l.prochaineAction ? <>{formatDateShort(l.prochaineAction)}{l.enRetard && ' ⚠'}</> : 'à planifier'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {l.lead.phone && (
          <a href={`tel:${l.lead.phone}`} className="btn-secondary btn-sm flex-1 justify-center">
            <Phone className="w-4 h-4" /> Appeler
          </a>
        )}
        {/* Le bouton d'échange est à portée de pouce, juste après « Appeler » :
            on raccroche, on note, sans changer d'écran. */}
        <button
          type="button"
          className="btn-primary btn-sm flex-1 justify-center"
          onClick={() => onEchange(l.lead.id)}
          data-testid={`echange-mobile-${l.lead.id}`}
        >
          <PhoneCall className="w-4 h-4" /> Échange
        </button>
        {l.rdv && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 whitespace-nowrap">
            <CalendarCheck className="w-3.5 h-3.5" /> {formatDateShort(l.rdv.date)}{l.rdv.time ? ` ${l.rdv.time}` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
