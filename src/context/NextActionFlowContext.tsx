import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useApp } from './useApp';
import { useToast } from './useToast';
import { NextActionFlowContext, type NextActionFlowApi } from './useNextActionFlow';
import type { Lead, LeadAction, PlannedAction } from '../data/types';
import { callResultLabel, nextActionDecision, plannedActionLabel, type NextActionEntry, type NextActionPrompt } from '../lib/plannedActions';
import { buildCommunicationAction } from '../lib/communication';
import { formatDate, toISODate } from '../lib/utils';
import { buildDoneAction, doneFlowFor, doneResultLabel } from '../lib/agenda';
import NextActionDialog from '../components/nextAction/NextActionDialog';
import SendConfirmDialog from '../components/nextAction/SendConfirmDialog';
import CallNoteDialog from '../components/nextAction/CallNoteDialog';
import DoneReportDialog from '../components/nextAction/DoneReportDialog';

/**
 * Enchaînement du lot 2 (arrêt 2), au niveau de l'application pour qu'il
 * survive aux changements de page (création de lead -> fiche, par exemple) :
 * confirmation d'envoi / note d'appel -> action enregistrée -> fenêtre
 * Prochaine action. Une file : une seule fenêtre à la fois.
 *
 * Garde-fou « quitté de force » : l'action est TOUJOURS enregistrée AVANT
 * l'ouverture de la fenêtre. Recharger la page ou fermer l'onglet ne perd donc
 * rien ; le lead apparaît simplement « sans prochaine action » (filtre À planifier).
 */
type Item =
  | { id: number; kind: 'next'; leadId: string; prompt: NextActionPrompt }
  | { id: number; kind: 'message'; leadId: string; channel: 'email' | 'sms' | 'whatsapp'; detail: string; action: Omit<LeadAction, 'id'> }
  | { id: number; kind: 'call'; leadId: string }
  /** « Fait » depuis l'agenda (arrêt 3) : fenêtre selon le type, puis action faite + fenêtre A. */
  | { id: number; kind: 'done'; leadId: string; plannedId: string; authorId: string };
type ItemInput = Item extends infer T ? (T extends Item ? Omit<T, 'id'> : never) : never;

export function NextActionFlowProvider({ children }: { children: ReactNode }) {
  const { state, addAction, completePlannedAction } = useApp();
  const toast = useToast();
  // Référence vivante sur le state pour les rappels différés (clic sur un toast).
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const [queue, setQueue] = useState<Item[]>([]);
  const seq = useRef(0);
  const push = useCallback((item: ItemInput) => {
    setQueue(q => [...q, { ...item, id: ++seq.current } as Item]);
  }, []);
  const remove = useCallback((id: number) => setQueue(q => q.filter(i => i.id !== id)), []);

  const decide = useCallback((leadId: string, entry: NextActionEntry) => {
    const { prompt } = nextActionDecision(entry);
    if (prompt) push({ kind: 'next', leadId, prompt });
  }, [push]);

  const api: NextActionFlowApi = useMemo(() => ({
    decide,
    confirmMessage: ({ lead, channel, detail, action }) => push({ kind: 'message', leadId: lead.id, channel, detail, action }),
    askCallNote: (lead: Lead) => push({ kind: 'call', leadId: lead.id }),
    markDone: (lead: Lead, planned: PlannedAction, authorId: string) => push({ kind: 'done', leadId: lead.id, plannedId: planned.id, authorId }),
    toastPlanifier: (leadId, message) => toast.success(message, {
      label: 'Planifier',
      onClick: () => {
        // Statut relu AU CLIC (le lead a pu bouger entre-temps). En mode API, le
        // lead accepté n'arrive dans l'état local qu'au rafraîchissement suivant
        // (≤ 5 s) : la demande est mise en file quand même — la fenêtre s'ouvre dès
        // que le lead est là (un lead accepté est toujours « nouveau »).
        const current = stateRef.current.leads.find(l => l.id === leadId);
        decide(leadId, { kind: 'toast_planifier', status: current?.status ?? 'nouveau' });
      },
    }),
  }), [decide, push, toast]);

  // Un lead supprimé entre-temps (autre poste) est simplement ignoré, comme un
  // « Fait » dont l'action n'est plus à faire (faite / annulée ailleurs) : rien en double.
  const current = queue.find(i => state.leads.some(l => l.id === i.leadId)
    && (i.kind !== 'done' || state.plannedActions.some(p => p.id === i.plannedId && p.status === 'a_faire')));
  const lead = current ? state.leads.find(l => l.id === current.leadId) : undefined;
  const shift = () => { if (current) remove(current.id); };
  const planned = current?.kind === 'done' ? state.plannedActions.find(p => p.id === current.plannedId) : undefined;

  let dialog: ReactNode = null;
  if (current && lead) {
    if (current.kind === 'next') {
      dialog = <NextActionDialog key={current.id} lead={lead} prompt={current.prompt} onDone={shift} />;
    } else if (current.kind === 'message') {
      dialog = (
        <SendConfirmDialog
          key={current.id}
          lead={lead}
          channel={current.channel}
          detail={current.detail}
          onAnswer={(sent) => {
            shift();
            if (!sent) { toast.info('Rien n\'a été enregistré'); return; }
            addAction(current.action);
            toast.success('Envoi ajouté à l\'historique');
            decide(lead.id, { kind: 'message_confirme', currentStatus: lead.status });
          }}
        />
      );
    } else if (current.kind === 'done' && planned) {
      const today = toISODate(new Date());
      const label = plannedActionLabel(planned);
      const finish = (result: string, notes: string, entry: NextActionEntry, message: string) => {
        shift();
        completePlannedAction(planned.id, buildDoneAction(planned, lead, { result, notes, today, authorId: current.authorId }));
        toast.success(message);
        decide(lead.id, entry);
      };
      const cancel = () => { shift(); toast.info('Rien n\'a été enregistré, l\'action reste à faire'); };
      const flowKind = doneFlowFor(planned.type);
      if (flowKind === 'appel') {
        dialog = (
          <CallNoteDialog
            key={current.id}
            lead={lead}
            onCancel={cancel}
            onSave={(note, result) => finish(callResultLabel(result), note, { kind: 'appel_enregistre', currentStatus: lead.status }, 'Appel fait — ajouté à l\'historique')}
          />
        );
      } else if (flowKind === 'message') {
        dialog = (
          <SendConfirmDialog
            key={current.id}
            lead={lead}
            channel={planned.type as 'email' | 'sms' | 'whatsapp'}
            detail={`Action prévue le ${formatDate(planned.date)}`}
            onAnswer={(sent) => (sent
              ? finish(`${label} envoyé`, '', { kind: 'message_confirme', currentStatus: lead.status }, 'Envoi ajouté à l\'historique')
              : cancel())}
          />
        );
      } else {
        dialog = (
          <DoneReportDialog
            key={current.id}
            lead={lead}
            label={label}
            onCancel={cancel}
            onSave={(note) => finish(doneResultLabel(planned), note, { kind: 'action_enregistree', currentStatus: lead.status }, 'Action faite — ajoutée à l\'historique')}
          />
        );
      }
    } else if (current.kind === 'call') {
      dialog = (
        <CallNoteDialog
          key={current.id}
          lead={lead}
          onCancel={() => { shift(); toast.info('Appel non enregistré'); }}
          onSave={(note, result) => {
            shift();
            addAction(buildCommunicationAction(lead, 'appel', toISODate(new Date()), { result: callResultLabel(result), notes: note }));
            toast.success('Appel ajouté à l\'historique');
            decide(lead.id, { kind: 'appel_enregistre', currentStatus: lead.status });
          }}
        />
      );
    }
  }

  return (
    <NextActionFlowContext.Provider value={api}>
      {children}
      {dialog}
    </NextActionFlowContext.Provider>
  );
}
