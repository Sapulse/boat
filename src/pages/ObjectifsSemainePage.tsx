import { useMemo, useState } from 'react';
import { Check, Pencil, CornerDownRight, EyeOff, Eye, Plus, History, ListChecks } from 'lucide-react';
import { useApp } from '../context/useApp';
import { useToast } from '../context/useToast';
import Repliable from '../components/ui/Repliable';
import { cn, toISODate } from '../lib/utils';
import {
  MAX_ACTIVE_OBJECTIVES, OBJECTIVE_TEXT_MAX, CARRY_OVER_REFUSAL_LABEL, addWeeksISO, weekStartOf, weekRangeLabel,
  objectivesOfWeek, activeCount, carryOverRefusal, carryOverTarget, existingCopy, historyWeeks, weekScore,
  ownerChoices, isValidOwner,
} from '../lib/weeklyObjectives';
import type { WeeklyObjective } from '../data/types';

// ===========================================================================
// Objectifs de la semaine (lot 4). Objectifs COMMUNS à l'équipe, 5 au plus par
// semaine, porteur facultatif. Jamais de suppression : « Retirer » (réactivable).
// Semaine en cours en haut, préparation de la semaine suivante, historique.
// Règles : lib/weeklyObjectives (prouvées au harnais), appliquées aussi par le
// reducer et par le serveur.
// ===========================================================================

type WeekKind = 'courante' | 'suivante' | 'passee';

function formatInstant(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function OwnerSelect({ value, onChange, id, className }: { value: string | null; onChange: (ownerId: string | null) => void; id?: string; className?: string }) {
  const { state } = useApp();
  const choices = ownerChoices(state.commercials, value);
  return (
    <select id={id} aria-label="Porteur" className={cn('select text-sm', className)} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">Sans porteur</option>
      {choices.map(c => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (désactivé)'}</option>)}
    </select>
  );
}

function ObjectiveRow({ o, kind, list, todayISO }: { o: WeeklyObjective; kind: WeekKind; list: WeeklyObjective[]; todayISO: string }) {
  const { state, updateWeeklyObjective, carryOverWeeklyObjective, getCommercialName } = useApp();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(o.text);

  const source = o.copiedFromId ? list.find(x => x.id === o.copiedFromId) : undefined;
  const target = carryOverTarget(o, todayISO);
  const copy = existingCopy(list, o.id, target);
  const refusal = carryOverRefusal(list, o, todayISO);
  const canCarry = !o.done && o.active && kind !== 'suivante';
  const reactivateBlocked = !o.active && activeCount(list, o.weekStart) >= MAX_ACTIVE_OBJECTIVES;
  const carryLabel = target === weekStartOf(todayISO) ? 'Reprendre cette semaine' : 'Reprendre la semaine suivante';

  const save = () => {
    const text = draft.trim();
    if (!text) { toast.error("Écrivez l'objectif."); return; }
    if (text !== o.text) updateWeeklyObjective(o.id, { text });
    setEditing(false);
  };
  const carry = () => {
    if (refusal) { toast.error(CARRY_OVER_REFUSAL_LABEL[refusal]); return; }
    carryOverWeeklyObjective(o.id);
    toast.success(`Objectif repris — semaine ${weekRangeLabel(target)}`);
  };
  const toggleActive = () => {
    if (reactivateBlocked) { toast.error(`${MAX_ACTIVE_OBJECTIVES} objectifs au plus : retirez-en un avant de réactiver celui-ci.`); return; }
    updateWeeklyObjective(o.id, { active: !o.active });
    toast.info(o.active ? 'Objectif retiré (conservé dans l’historique)' : 'Objectif réactivé');
  };
  const changeOwner = (ownerId: string | null) => {
    if (!isValidOwner(ownerId, state.commercials)) return;
    updateWeeklyObjective(o.id, { ownerId });
  };

  return (
    <li data-testid="objectif" data-id={o.id} className={cn('py-3 flex gap-3', !o.active && 'opacity-60')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={o.done}
        aria-label={`${o.done ? 'Marquer non atteint' : 'Marquer atteint'} : ${o.text}`}
        disabled={!o.active}
        onClick={() => updateWeeklyObjective(o.id, { done: !o.done })}
        className="shrink-0 w-11 h-11 -m-1 flex items-center justify-center rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed"
      >
        <span className={cn('w-6 h-6 rounded-md border-2 flex items-center justify-center transition-colors', o.done ? 'bg-success-600 border-success-600 text-white' : 'border-gray-300 bg-white')}>
          {o.done && <Check className="w-4 h-4" />}
        </span>
      </button>

      <div className="min-w-0 flex-1 space-y-2">
        {editing ? (
          <div className="space-y-2">
            <textarea
              aria-label="Texte de l'objectif"
              className="input text-sm w-full"
              rows={2}
              maxLength={OBJECTIVE_TEXT_MAX}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 mr-auto">{draft.trim().length}/{OBJECTIVE_TEXT_MAX}</span>
              <button type="button" onClick={() => { setDraft(o.text); setEditing(false); }} className="btn-ghost btn-sm">Annuler</button>
              <button type="button" onClick={save} className="btn-primary btn-sm">Enregistrer</button>
            </div>
          </div>
        ) : (
          <p className={cn('text-sm text-gray-900 break-words', o.done && 'line-through text-gray-500')}>{o.text}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          {o.active && !editing ? (
            <OwnerSelect value={o.ownerId} onChange={changeOwner} className="w-full sm:w-auto py-1 text-xs" />
          ) : (
            <span>{o.ownerId ? getCommercialName(o.ownerId) : 'Sans porteur'}</span>
          )}
          {!o.active && <span className="font-medium text-gray-600">Retiré</span>}
          {source && <span className="flex items-center gap-1"><CornerDownRight className="w-3 h-3" /> Repris de la semaine {weekRangeLabel(source.weekStart)}</span>}
          {copy && <span className="text-primary-700">Repris la semaine {weekRangeLabel(copy.weekStart)}</span>}
          {o.modifiedAfterWeekAt && (
            <span data-testid="trace" className="text-warning-600 font-medium">Modifié après la fin de semaine, le {formatInstant(o.modifiedAfterWeekAt)}</span>
          )}
        </div>

        {!editing && (
          <div className="flex flex-wrap gap-1.5">
            {o.active && (
              <button type="button" onClick={() => { setDraft(o.text); setEditing(true); }} className="btn-ghost btn-sm text-xs min-h-[36px]">
                <Pencil className="w-3.5 h-3.5" /> Modifier
              </button>
            )}
            {canCarry && !copy && (
              <button type="button" onClick={carry} disabled={refusal === 'semaine-pleine'} title={refusal ? CARRY_OVER_REFUSAL_LABEL[refusal] : undefined} className="btn-ghost btn-sm text-xs min-h-[36px] disabled:opacity-50">
                <CornerDownRight className="w-3.5 h-3.5" /> {carryLabel}
              </button>
            )}
            <button type="button" onClick={toggleActive} className="btn-ghost btn-sm text-xs min-h-[36px] text-gray-500">
              {o.active ? <><EyeOff className="w-3.5 h-3.5" /> Retirer</> : <><Eye className="w-3.5 h-3.5" /> Réactiver</>}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function AddObjectiveForm({ weekStart, list }: { weekStart: string; list: WeeklyObjective[] }) {
  const { addWeeklyObjective } = useApp();
  const toast = useToast();
  const [text, setText] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const full = activeCount(list, weekStart) >= MAX_ACTIVE_OBJECTIVES;
  const inputId = `nouvel-objectif-${weekStart}`;

  if (full) {
    return <p className="text-xs text-gray-500 pt-3">{MAX_ACTIVE_OBJECTIVES} objectifs au plus par semaine — retirez-en un pour en ajouter un autre.</p>;
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) { toast.error("Écrivez l'objectif."); return; }
    addWeeklyObjective(weekStart, t, ownerId);
    setText('');
    setOwnerId(null);
  };
  return (
    <form onSubmit={submit} className="pt-3 flex flex-col sm:flex-row gap-2" data-testid={`ajout-${weekStart}`}>
      <label htmlFor={inputId} className="sr-only">Nouvel objectif</label>
      <input
        id={inputId}
        className="input text-sm flex-1"
        placeholder="Nouvel objectif…"
        maxLength={OBJECTIVE_TEXT_MAX}
        value={text}
        onChange={e => setText(e.target.value)}
      />
      <OwnerSelect value={ownerId} onChange={setOwnerId} className="sm:w-44" />
      <button type="submit" className="btn-primary btn-sm justify-center min-h-[40px]">
        <Plus className="w-4 h-4" /> Ajouter
      </button>
    </form>
  );
}

function WeekCard({ weekStart, kind, list, todayISO }: { weekStart: string; kind: WeekKind; list: WeeklyObjective[]; todayISO: string }) {
  const [showRetired, setShowRetired] = useState(false);
  const all = objectivesOfWeek(list, weekStart, { includeInactive: true });
  const retired = all.filter(o => !o.active);
  const shown = showRetired ? all : all.filter(o => o.active);
  const score = weekScore(list, weekStart);
  const title = kind === 'courante' ? 'Cette semaine' : kind === 'suivante' ? 'Semaine prochaine' : 'Semaine';

  return (
    // Semaine passée : affichée DANS le volet de l'historique, dont l'en-tête porte déjà le titre et le bilan.
    <section className={kind === 'passee' ? '' : 'card p-4'} data-testid={`semaine-${weekStart}`} aria-label={kind === 'passee' ? `Semaine ${weekRangeLabel(weekStart)}` : undefined} aria-labelledby={kind === 'passee' ? undefined : `titre-${weekStart}`}>
      {kind !== 'passee' && <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`titre-${weekStart}`} className="text-base font-semibold text-gray-900">
          {title} <span className="font-normal text-gray-500">— {weekRangeLabel(weekStart)}</span>
        </h2>
        <span className="text-sm text-gray-500 sm:ml-auto">
          {score.total > 0 ? `${score.done}/${score.total} atteint${score.done > 1 ? 's' : ''}` : 'Aucun objectif'}
        </span>
      </div>}
      {kind === 'suivante' && <p className="text-xs text-gray-500 mt-1">Préparez la semaine à venir ; les objectifs non atteints de cette semaine peuvent y être repris.</p>}
      {shown.length > 0 ? (
        <ul className="divide-y divide-gray-100 mt-2">
          {shown.map(o => <ObjectiveRow key={o.id} o={o} kind={kind} list={list} todayISO={todayISO} />)}
        </ul>
      ) : (
        <p className="text-sm text-gray-400 py-4">Aucun objectif pour l&apos;instant.</p>
      )}
      {retired.length > 0 && (
        <button type="button" onClick={() => setShowRetired(v => !v)} className="text-xs text-gray-500 hover:text-gray-700 mt-2">
          {showRetired ? 'Masquer' : 'Afficher'} les retirés ({retired.length})
        </button>
      )}
      {kind !== 'passee' && <AddObjectiveForm weekStart={weekStart} list={list} />}
    </section>
  );
}

export default function ObjectifsSemainePage() {
  const { state } = useApp();
  const list = useMemo(() => state.weeklyObjectives ?? [], [state.weeklyObjectives]);
  const todayISO = toISODate(new Date());
  const current = weekStartOf(todayISO);
  const next = addWeeksISO(current, 1);
  const past = historyWeeks(list, todayISO);
  const [openWeeks, setOpenWeeks] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-primary-600" /> Objectifs de la semaine
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Objectifs communs à l&apos;équipe, {MAX_ACTIVE_OBJECTIVES} au plus par semaine, avec un porteur si besoin. Rien n&apos;est jamais supprimé : un objectif retiré reste dans l&apos;historique.
        </p>
      </div>

      <WeekCard weekStart={current} kind="courante" list={list} todayISO={todayISO} />
      <WeekCard weekStart={next} kind="suivante" list={list} todayISO={todayISO} />

      <section aria-labelledby="titre-historique" className="space-y-3">
        <h2 id="titre-historique" className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <History className="w-4 h-4 text-gray-500" /> Historique
        </h2>
        {past.length === 0 ? (
          <p className="text-sm text-gray-400">Les semaines passées apparaîtront ici.</p>
        ) : (
          <>
            <p className="text-xs text-gray-500">Une modification faite après la fin d&apos;une semaine y reste signalée, avec sa date.</p>
            {past.map(w => {
              const score = weekScore(list, w);
              const traced = list.some(o => o.weekStart === w && o.modifiedAfterWeekAt);
              return (
                <Repliable
                  key={w}
                  open={!!openWeeks[w]}
                  onToggle={() => setOpenWeeks(s => ({ ...s, [w]: !s[w] }))}
                  label={`la semaine ${weekRangeLabel(w)}`}
                  className="card px-4 py-2"
                  title={
                    <span className="flex flex-wrap items-baseline gap-x-3 text-sm">
                      <span className="font-medium text-gray-900">Semaine {weekRangeLabel(w)}</span>
                      <span className="text-gray-500">{score.done}/{score.total} atteint{score.done > 1 ? 's' : ''}</span>
                      {traced && <span className="text-xs text-warning-600">modifiée après coup</span>}
                    </span>
                  }
                >
                  <div className="pb-2">
                    <WeekCard weekStart={w} kind="passee" list={list} todayISO={todayISO} />
                  </div>
                </Repliable>
              );
            })}
          </>
        )}
      </section>
    </div>
  );
}
