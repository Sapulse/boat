import type { ReactNode } from 'react';
import { useIsCompact } from '../../lib/useIsCompact';
import { leadHash } from '../../lib/openLead';

/**
 * Lien vers une fiche lead (lot 3) : un VRAI <a>, pour que Ctrl+clic, clic
 * molette et « ouvrir dans un nouvel onglet » fonctionnent nativement.
 * Ordinateur : target _blank (nouvel onglet). Mobile : même onglet (le hash suffit
 * au HashRouter). `stopPropagation` : jamais de double ouverture par la ligne parente.
 */
export default function LeadLink({ leadId, children, className, title }: {
  leadId: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const isCompact = useIsCompact();
  return (
    <a
      href={leadHash(leadId)}
      target={isCompact ? undefined : '_blank'}
      rel={isCompact ? undefined : 'noopener'}
      onClick={e => e.stopPropagation()}
      className={className}
      title={title}
    >
      {children}
    </a>
  );
}
