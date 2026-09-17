import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsCompact } from '../lib/useIsCompact';
import { leadUrl, opensInNewTab, type OpenGesture } from '../lib/openLead';

/**
 * Ouvre une fiche lead selon la règle du lot 3 (lib/openLead) : nouvel onglet
 * sur ordinateur, même onglet sur mobile ; Ctrl / Cmd / molette = nouvel onglet.
 * Pour les éléments cliquables qui ne sont PAS des liens (lignes de tableau,
 * cartes, kanban). Un vrai lien passe par <LeadLink>.
 */
export function useOpenLead() {
  const navigate = useNavigate();
  const isCompact = useIsCompact();
  return useCallback((leadId: string, gesture?: OpenGesture) => {
    if (opensInNewTab(isCompact, gesture)) {
      window.open(leadUrl(leadId, window.location), '_blank', 'noopener');
    } else {
      navigate(`/leads/${leadId}`);
    }
  }, [isCompact, navigate]);
}

/**
 * Props à étaler sur un élément cliquable non-lien : clic gauche (avec Ctrl /
 * Cmd), clic molette (auxclick) et clavier (Entrée / Espace). `preventDefault`
 * sur la molette : pas de défilement automatique en plus de l'onglet ouvert.
 */
export function useLeadClickProps() {
  const open = useOpenLead();
  return useCallback((leadId: string) => ({
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); open(leadId, e); },
    onAuxClick: (e: React.MouseEvent) => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); open(leadId, e); } },
    onMouseDown: (e: React.MouseEvent) => { if (e.button === 1) e.preventDefault(); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(leadId, { ctrlKey: e.ctrlKey, metaKey: e.metaKey }); }
    },
  }), [open]);
}
