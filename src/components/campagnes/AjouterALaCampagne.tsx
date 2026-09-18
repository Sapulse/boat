import { useMemo, useState } from 'react';
import { Users, AlertTriangle } from 'lucide-react';
import Modal from '../ui/Modal';
import { useApp } from '../../context/useApp';
import { useToast } from '../../context/useToast';
import { preparerAjout, leadsSansCommercial, campagneParDefaut } from '../../lib/campagnes';
import { isUnassignedCommercial, eligibleCommercials } from '../../lib/plannedActions';
import { CAMPAGNE_PRIORITES, CAMPAGNE_STATUT_DEFAUT, type CampagnePriorite } from '../../data/types';
import { SEGMENTS_CAMPAGNE } from '../../data/constants';
import { useSubmitLock } from '../../hooks/useSubmitLock';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Leads sélectionnés dans la liste (résultat filtré courant). */
  leadIds: string[];
  /** Appelé après un ajout réussi : la liste vide sa sélection. */
  onAjoute?: (ajoutes: number) => void;
}

/**
 * LOT SALONS (S2a) — ajout EN MASSE de leads à une campagne.
 *
 * C'est la fonction la plus critique de l'étape : la démonstration à l'équipe
 * EST le peuplement de la campagne. Trois garanties tenues ici :
 *
 *  1. le champ `source` d'un lead n'est NI lu NI écrit — embarquer un lead dans
 *     une campagne ne change pas d'où il vient ;
 *  2. un lead déjà participant est ignoré en silence (jamais de doublon), et on
 *     le DIT dans le bilan plutôt que de laisser croire qu'il a été ajouté ;
 *  3. les leads sans commercial sont comptés et annoncés AVANT l'ajout : un
 *     responsable de campagne devient alors obligatoire, sinon personne ne les
 *     rappellerait.
 */
export default function AjouterALaCampagne({ open, onClose, leadIds, onAjoute }: Props) {
  const { state, addCampagneLeads } = useApp();
  const toast = useToast();
  const { locked, guard } = useSubmitLock();

  const campagnes = useMemo(() => (state.campagnes ?? []).filter(c => c.active), [state.campagnes]);
  const [campagneId, setCampagneId] = useState(() => campagneParDefaut(state.campagnes)?.id ?? '');
  const [segment, setSegment] = useState<string>(SEGMENTS_CAMPAGNE[0]);
  const [priorite, setPriorite] = useState<CampagnePriorite>('Moyenne');
  const [responsableId, setResponsableId] = useState('');

  const responsablesPossibles = useMemo(() => eligibleCommercials(state.commercials), [state.commercials]);
  const sansCommercial = useMemo(
    () => leadsSansCommercial(state, leadIds, isUnassignedCommercial),
    [state, leadIds],
  );
  // Aperçu AVANT écriture : combien seront réellement ajoutés, combien sont déjà là.
  const apercu = useMemo(
    () => preparerAjout(state, {
      campagneId, leadIds, segment, priorite,
      responsableId: responsableId || 'apercu', statutParDefaut: CAMPAGNE_STATUT_DEFAUT,
    }, () => 'apercu'),
    [state, campagneId, leadIds, segment, priorite, responsableId],
  );

  // Responsable OBLIGATOIRE dès qu'un lead du lot n'a pas de commercial : sans
  // cela, ces leads entreraient dans la campagne sans que personne ne les suive.
  const responsableRequis = sansCommercial.length > 0;
  const pretAEnvoyer = !!campagneId && apercu.nouvelles.length > 0 && (!responsableRequis || !!responsableId);

  const valider = () => guard(() => {
    const campagne = (state.campagnes ?? []).find(c => c.id === campagneId);
    if (!campagne) { toast.error('Campagne introuvable.'); return; }
    // Responsable par défaut : le commercial du lead s'il en a un, sinon celui
    // choisi pour le lot (obligatoire dans ce cas).
    const parLead = new Map(state.leads.map(l => [l.id, l.commercialId]));
    const choisi = responsableId;
    const { nouvelles, dejaParticipants } = preparerAjout(state, {
      campagneId, leadIds, segment, priorite,
      responsableId: choisi || '', statutParDefaut: CAMPAGNE_STATUT_DEFAUT,
    }, () => crypto.randomUUID());
    const avecResponsable = nouvelles.map(p => {
      if (choisi) return { ...p, responsableId: choisi };
      const duLead = parLead.get(p.leadId) ?? '';
      const reel = responsablesPossibles.some(c => c.id === duLead);
      return { ...p, responsableId: reel ? duLead : choisi };
    });
    if (avecResponsable.some(p => !p.responsableId)) {
      toast.error('Choisissez un responsable de campagne : certains leads n\'ont pas de commercial.');
      return;
    }
    addCampagneLeads(avecResponsable);
    const bilan = dejaParticipants.length
      ? `${avecResponsable.length} lead${avecResponsable.length > 1 ? 's' : ''} ajouté${avecResponsable.length > 1 ? 's' : ''} à « ${campagne.nom} » — ${dejaParticipants.length} déjà dans la campagne, ignoré${dejaParticipants.length > 1 ? 's' : ''}`
      : `${avecResponsable.length} lead${avecResponsable.length > 1 ? 's' : ''} ajouté${avecResponsable.length > 1 ? 's' : ''} à « ${campagne.nom} »`;
    toast.success(bilan);
    onAjoute?.(avecResponsable.length);
    onClose();
  });

  return (
    <Modal open={open} onClose={onClose} title="Ajouter à la campagne" size="md">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 flex items-center gap-2">
          <Users className="w-4 h-4 text-primary-600" />
          <span data-testid="campagne-selection-total"><strong>{leadIds.length}</strong> lead{leadIds.length > 1 ? 's' : ''} sélectionné{leadIds.length > 1 ? 's' : ''}</span>
        </p>

        {campagnes.length === 0 ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
            Aucune campagne active. Créez-en une depuis l'onglet Campagnes.
          </p>
        ) : (
          <>
            <div>
              <label htmlFor="campagne-cible" className="label">Campagne</label>
              <select id="campagne-cible" className="select" value={campagneId} onChange={e => setCampagneId(e.target.value)}>
                {campagnes.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="campagne-segment" className="label">Segment (origine)</label>
                <input
                  id="campagne-segment" list="segments-campagne" className="input"
                  value={segment} onChange={e => setSegment(e.target.value)}
                  placeholder="Ex. Client en portefeuille"
                />
                <datalist id="segments-campagne">
                  {SEGMENTS_CAMPAGNE.map(s => <option key={s} value={s} />)}
                </datalist>
                <p className="text-xs text-gray-500 mt-1">Comment ce lead entre dans la campagne. Ne change pas sa source.</p>
              </div>
              <div>
                <label htmlFor="campagne-priorite" className="label">Priorité</label>
                <select id="campagne-priorite" className="select" value={priorite} onChange={e => setPriorite(e.target.value as CampagnePriorite)}>
                  {CAMPAGNE_PRIORITES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="campagne-responsable" className="label">
                Responsable {responsableRequis ? <span className="text-red-600">(obligatoire)</span> : <span className="text-gray-500 font-normal">(sinon : le commercial du lead)</span>}
              </label>
              <select id="campagne-responsable" className="select" value={responsableId} onChange={e => setResponsableId(e.target.value)}>
                <option value="">{responsableRequis ? '— à choisir —' : 'Commercial du lead'}</option>
                {responsablesPossibles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {responsableRequis && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3 flex items-start gap-2" data-testid="campagne-sans-commercial">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  <strong>{sansCommercial.length}</strong> lead{sansCommercial.length > 1 ? 's' : ''} de la sélection {sansCommercial.length > 1 ? 'n\'ont' : 'n\'a'} pas de commercial.
                  Choisissez un responsable de campagne : sans lui, {sansCommercial.length > 1 ? 'ils ne seraient rappelés par personne' : 'il ne serait rappelé par personne'}.
                </span>
              </p>
            )}

            <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded p-3" data-testid="campagne-apercu">
              À ajouter : <strong>{apercu.nouvelles.length}</strong>
              {apercu.dejaParticipants.length > 0 && <> · déjà dans la campagne, ignoré{apercu.dejaParticipants.length > 1 ? 's' : ''} : <strong>{apercu.dejaParticipants.length}</strong></>}
            </p>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
          <button type="button" className="btn-primary" disabled={!pretAEnvoyer || locked} onClick={valider} data-testid="campagne-valider">
            Ajouter {apercu.nouvelles.length > 0 ? `(${apercu.nouvelles.length})` : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}
