import { useReducer, useEffect, useMemo, type ReactNode } from 'react';
import { reducer } from './appReducer';
import { AppContext } from './useApp';
import { createLocalStorageRepository, getInitialCrmState } from '../lib/repository';

// Ce fichier ne contient QUE le composant AppProvider (react-refresh).
// Le reducer + l'initialisation vivent dans appReducer.ts (module pur, teste
// par scripts/harness-reducer.ts) ; le contexte + useApp dans useApp.ts.
//
// Depuis le Lot 3 (chantier migration), l'accès aux données passe par la couche
// `CrmRepository` (src/lib/repository.ts) : AppProvider n'appelle plus le
// stockage ni ne dispatche directement, il délègue au repository. Comportement
// STRICTEMENT identique (impl localStorage adossée au reducer + saveState).

export function AppProvider({ children }: { children: ReactNode }) {
  // Init paresseuse via le bootstrap d'hydratation (sans dispatch). Le repository
  // est ensuite construit avec `dispatch` (identité STABLE garantie par
  // useReducer -> créé une seule fois).
  const [state, dispatch] = useReducer(reducer, undefined, getInitialCrmState);
  const repository = useMemo(() => createLocalStorageRepository(dispatch), [dispatch]);

  // Persistance : effet réactif sur le state ENTIER (timing inchangé), déléguée
  // au repository (plus d'appel direct à saveState).
  useEffect(() => {
    repository.persist(state);
  }, [repository, state]);

  // Sélecteurs de vue (purs sur `state`) : restent dans le provider, ce ne sont
  // pas des opérations de stockage.
  const getLeadActions = (leadId: string) =>
    state.actions.filter(a => a.leadId === leadId).sort((a, b) => b.date.localeCompare(a.date));
  const getCommercialName = (id: string) =>
    state.commercials.find(c => c.id === id)?.name ?? id;

  return (
    <AppContext.Provider
      value={{
        state,
        addLead: repository.addLead,
        updateLead: repository.updateLead,
        deleteLead: repository.deleteLead,
        updateLeadStatus: repository.updateLeadStatus,
        addAction: repository.addAction,
        updateAction: repository.updateAction,
        deleteAction: repository.deleteAction,
        setNextAction: repository.setNextAction,
        addCommercial: repository.addCommercial,
        updateCommercial: repository.updateCommercial,
        toggleCommercial: repository.toggleCommercial,
        getLeadActions,
        getCommercialName,
        saveMonthlyStats: repository.saveMonthlyStats,
        saveGoals: repository.saveGoals,
        saveDefaultGoal: repository.saveDefaultGoal,
        addTemplate: repository.addTemplate,
        updateTemplate: repository.updateTemplate,
        deleteTemplate: repository.deleteTemplate,
        addCalendarEvent: repository.addCalendarEvent,
        updateCalendarEvent: repository.updateCalendarEvent,
        deleteCalendarEvent: repository.deleteCalendarEvent,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
