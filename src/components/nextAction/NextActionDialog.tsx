import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/useApp';
import { useToast } from '../../context/useToast';
import { ACTION_TYPES, NO_NEXT_ACTION_REASONS, getStatusLabel } from '../../data/constants';
import type { ActionType, Lead, PlannedActionPerson } from '../../data/types';
import {
  eligibleCommercials, defaultPeople, pendingActionOf, validateNextActionChoice, resolveNoNextActionReason,
  plannedActionLabel, isPlanningClosed, type NextActionChoice, type NextActionPrompt,
} from '../../lib/plannedActions';
import { formatDate, getLeadFullName, isLeadActive } from '../../lib/utils';
import DialogShell from './DialogShell';
import PeoplePicker from './PeoplePicker';

/**
 * Fenêtre « Prochaine action » (lot 2, décision A).
 *  - mode obligatoire : planifier OU « Aucune prochaine action » + motif ;
 *  - mode reprise (Reporté) : planifier une date de reprise, « Aucune » absente ;
 *  - mode passable (Signé / Perdu) : planifier, « Aucune » ou « Passer ».
 * Pré-remplie avec l'action à faire en cours (reprogrammer = la même action).
 * Non fermable sauf planification volontaire (éditeur de la fiche, toast Planifier).
 */
export default function NextActionDialog({ lead, prompt, onDone }: {
  lead: Lead;
  prompt: NextActionPrompt;
  onDone: () => void;
}) {
  const { state, planNextAction, setNoNextAction } = useApp();
  const toast = useToast();
  const pending = useMemo(() => pendingActionOf(lead.id, state.plannedActions), [lead.id, state.plannedActions]);
  const eligible = useMemo(() => eligibleCommercials(state.commercials), [state.commercials]);

  const [view, setView] = useState<'planifier' | 'aucune'>('planifier');
  const [type, setType] = useState<ActionType | ''>(pending?.type ?? '');
  const [customLabel, setCustomLabel] = useState(pending?.customLabel ?? '');
  const [date, setDate] = useState(pending?.date ?? '');
  const [time, setTime] = useState(pending?.time ?? '');
  const [endTime, setEndTime] = useState(pending?.endTime ?? '');
  const [note, setNote] = useState(pending?.note ?? '');
  const [people, setPeople] = useState<PlannedActionPerson[]>(
    () => (pending?.people.length ? pending.people : defaultPeople(lead, state.commercials)),
  );
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [tried, setTried] = useState(false);
  // Les erreurs sont en bas du corps défilant : sur un écran court (ou un téléphone)
  // elles seraient invisibles — on les amène à l'écran à chaque tentative ratée.
  const errorsRef = useRef<HTMLUListElement>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (attempt > 0) errorsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [attempt]);

  const planChoice: NextActionChoice = {
    kind: 'planifier', type: (type || '') as ActionType, customLabel, date,
    time: time || undefined, endTime: endTime || undefined, note: note.trim(), people,
  };
  const noneChoice: NextActionChoice = { kind: 'aucune', reason, customReason };
  const errors = validateNextActionChoice(view === 'planifier' ? planChoice : noneChoice, prompt.mode, state.commercials);
  const leadUnassigned = !eligible.some(c => c.id === lead.commercialId);

  const save = () => {
    setTried(true);
    if (errors.length > 0) { setAttempt(a => a + 1); return; }
    if (view === 'planifier') {
      const authorId = people.find(p => p.role === 'responsable')?.commercialId ?? lead.commercialId;
      planNextAction(lead.id, { type: type as ActionType, customLabel, date, time: time || undefined, endTime: endTime || undefined, note: note.trim(), people }, authorId);
      toast.success(`Prochaine action programmée — ${plannedActionLabel({ type: type as ActionType, customLabel })} le ${formatDate(date)}${time ? ` à ${time}` : ''}`);
    } else {
      setNoNextAction(lead.id, resolveNoNextActionReason(reason, customReason), lead.commercialId);
      toast.info('Aucune prochaine action — motif enregistré');
    }
    onDone();
  };

  const subtitle = view === 'aucune'
    ? <>Indiquez pourquoi il n'y a pas de prochaine action.</>
    : prompt.mode === 'reprise'
    ? <>Lead <strong>reporté</strong> : choisissez la date de reprise.</>
    : prompt.mode === 'passable'
      ? <>Lead <strong>{getStatusLabel(lead.status)}</strong> : programmez une suite, ou passez.</>
      : <>{pending ? 'Une action est déjà prévue : confirmez-la ou modifiez-la.' : 'Programmez la prochaine action, ou indiquez qu\'il n\'y en a pas.'}</>;

  const footer = (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
      {prompt.closable && (
        <button type="button" onClick={onDone} className="btn-ghost btn-sm w-full sm:w-auto">Annuler</button>
      )}
      {prompt.mode === 'passable' && (
        <button type="button" onClick={onDone} className="btn-secondary btn-sm w-full sm:w-auto">Passer</button>
      )}
      {view === 'aucune' && (
        <button type="button" onClick={() => { setView('planifier'); setTried(false); }} className="btn-secondary btn-sm w-full sm:w-auto">
          Revenir à la planification
        </button>
      )}
      <button type="button" onClick={save} className="btn-primary btn-sm w-full sm:w-auto">
        {view === 'planifier' ? 'Enregistrer la prochaine action' : 'Confirmer : aucune prochaine action'}
      </button>
    </div>
  );

  return (
    <DialogShell
      title={`Prochaine action — ${getLeadFullName(lead)}`}
      subtitle={subtitle}
      closable={prompt.closable}
      onClose={onDone}
      footer={footer}
    >
      {view === 'planifier' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="na-type">Type *</label>
              <select id="na-type" className="select" value={type} onChange={e => setType(e.target.value as ActionType | '')}>
                <option value="">Choisir…</option>
                {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            {type === 'autre' && (
              <div>
                <label className="label" htmlFor="na-custom">Précisez *</label>
                <input id="na-custom" className="input" value={customLabel} maxLength={80} onChange={e => setCustomLabel(e.target.value)} placeholder="Ex. essai en mer" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1">
              <label className="label" htmlFor="na-date">{prompt.mode === 'reprise' ? 'Date de reprise *' : 'Date *'}</label>
              <input id="na-date" className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="na-time">Heure</label>
              <input id="na-time" className="input" type="time" value={time} disabled={!date} onChange={e => setTime(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="na-end">Fin</label>
              <input id="na-end" className="input" type="time" value={endTime} disabled={!time} onChange={e => setEndTime(e.target.value)} />
            </div>
          </div>

          <PeoplePicker
            eligible={eligible}
            people={people}
            onChange={setPeople}
            warning={leadUnassigned ? 'Lead non attribué : choisissez au moins un responsable.' : undefined}
          />

          <div>
            <label className="label" htmlFor="na-note">Note</label>
            <textarea id="na-note" className="input min-h-[60px]" maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="Ex. rappeler pour le devis moteur" />
          </div>

          {prompt.mode !== 'reprise' && (
            <button type="button" onClick={() => { setView('aucune'); setTried(false); }} className="text-sm text-gray-600 underline hover:text-gray-900">
              Aucune prochaine action…
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="na-reason">Motif *</label>
            <select id="na-reason" className="select" value={reason} onChange={e => setReason(e.target.value)}>
              <option value="">Choisir…</option>
              {NO_NEXT_ACTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          {reason === 'Autre' && (
            <div>
              <label className="label" htmlFor="na-reason-custom">Précisez *</label>
              <input id="na-reason-custom" className="input" maxLength={120} value={customReason} onChange={e => setCustomReason(e.target.value)} />
            </div>
          )}
          {pending && (
            <p className="text-sm text-gray-600">L'action prévue ({plannedActionLabel(pending)} le {formatDate(pending.date)}) ne sera plus à faire.</p>
          )}
          {isLeadActive(lead.status) && !isPlanningClosed(lead.status) && (
            <p className="text-xs text-gray-500 rounded-lg bg-gray-50 px-3 py-2">
              Le projet n'aboutira pas ? Vous pouvez aussi passer le lead en « Perdu » depuis sa fiche.
            </p>
          )}
        </div>
      )}

      {tried && errors.length > 0 && (
        <ul ref={errorsRef} className="mt-4 space-y-1 rounded-lg bg-danger-50 border border-danger-200 px-3 py-2 text-sm text-danger-700" role="alert">
          {errors.map(e => <li key={e}>{e}</li>)}
        </ul>
      )}
    </DialogShell>
  );
}
