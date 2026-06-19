import type { Lead, LeadAction, ActionType } from '../data/types';

/**
 * Logique PURE de journalisation d'une communication (lot objectifs-prospection).
 * Sans React, sans I/O -> testable au harnais (scripts/harness-communication.ts).
 *
 * SEUL endroit qui construit une action de communication (email / sms / whatsapp /
 * appel). Une action est creee au DECLENCHEMENT de l'envoi (= tentative, pas une
 * confirmation de reception) ; elle est librement supprimable. authorId = le
 * commercial ASSIGNE au lead -> alimente l'indicateur « Relances » des Objectifs.
 */
export function buildCommunicationAction(
  lead: Lead,
  type: ActionType,
  today: string,
  opts: { result: string; notes?: string },
): Omit<LeadAction, 'id'> {
  return {
    leadId: lead.id,
    type,
    date: today,
    result: opts.result,
    notes: opts.notes ?? '',
    authorId: lead.commercialId,
  };
}
