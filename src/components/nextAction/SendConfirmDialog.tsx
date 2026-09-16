import type { Lead } from '../../data/types';
import { getLeadFullName } from '../../lib/utils';
import DialogShell from './DialogShell';

const CHANNEL_LABEL = { email: "l'email", sms: 'le SMS', whatsapp: 'le message WhatsApp' } as const;

/**
 * « Avez-vous bien envoyé le message ? » (lot 2, décision F). L'app ouvre
 * l'email / le SMS / WhatsApp, mais ne peut pas savoir si l'envoi a eu lieu :
 * Oui -> l'action est enregistrée puis la fenêtre Prochaine action s'ouvre ;
 * Non -> RIEN n'est enregistré. Fermer (Échap, clic à côté) = Non.
 */
export default function SendConfirmDialog({ lead, channel, detail, onAnswer }: {
  lead: Lead;
  channel: 'email' | 'sms' | 'whatsapp';
  detail: string;
  onAnswer: (sent: boolean) => void;
}) {
  return (
    <DialogShell
      size="sm"
      mobileSheet
      title="Avez-vous bien envoyé le message ?"
      subtitle={<>{CHANNEL_LABEL[channel][0].toUpperCase() + CHANNEL_LABEL[channel].slice(1)} à <strong>{getLeadFullName(lead)}</strong></>}
      closable
      onClose={() => onAnswer(false)}
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => onAnswer(false)} className="btn-secondary btn-sm w-full sm:w-auto">Non, pas envoyé</button>
          <button type="button" onClick={() => onAnswer(true)} className="btn-primary btn-sm w-full sm:w-auto">Oui, envoyé</button>
        </div>
      )}
    >
      <p className="text-sm text-gray-700">{detail}</p>
      <p className="text-xs text-gray-500 mt-3">
        « Oui » l'ajoute à l'historique du lead. « Non » n'enregistre rien.
      </p>
    </DialogShell>
  );
}
