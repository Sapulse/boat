import { useReducer, useEffect, useMemo, useState, type ReactNode } from 'react';
import { reducer } from './appReducer';
import { AppContext } from './useApp';
import { createLocalStorageRepository, createApiRepository, getInitialCrmState, getEmptyState } from '../lib/repository';

// Ce fichier ne contient QUE le composant AppProvider (react-refresh).
// Le reducer + l'initialisation vivent dans appReducer.ts (module pur, teste
// par scripts/harness-reducer.ts) ; le contexte + useApp dans useApp.ts.
//
// Depuis le Lot 3, l'accès aux données passe par la couche `CrmRepository`.
// Lot 5 : une 2e implémentation "API" est sélectionnable par le feature flag
// VITE_USE_API. FLAG OFF (défaut) = localStorage À L'IDENTIQUE (aucun écran de
// chargement, aucune hydratation async, persist = saveState) -> zéro changement
// pour les commerciaux. FLAG ON = l'app parle à l'API (hydratation serveur +
// synchro optimiste par diff).

// Le flag est lu UNE fois (constante de build Vite). Absent/≠ 'true' -> false.
const USE_API = import.meta.env.VITE_USE_API === 'true';

export function AppProvider({ children }: { children: ReactNode }) {
  // Erreur de synchro (mode API) affichée en bandeau ; toujours null en flag off.
  const [syncError, setSyncError] = useState<string | null>(null);

  // Init paresseuse : localStorage (sync) en flag off ; état VIDE en flag on
  // (l'état réel arrive via l'hydratation serveur, sous le loading gate).
  const [state, dispatch] = useReducer(reducer, undefined, USE_API ? getEmptyState : getInitialCrmState);

  // `dispatch` a une identité STABLE (useReducer) -> repository créé une seule fois.
  const repository = useMemo(
    () => USE_API
      ? createApiRepository({
          dispatch,
          onError: setSyncError,
          baseUrl: import.meta.env.VITE_API_BASE_URL,
          token: import.meta.env.VITE_API_TOKEN,
        })
      : createLocalStorageRepository(dispatch),
    [dispatch],
  );

  // Loading gate : prêt d'emblée en flag off ; en flag on, on attend l'hydratation.
  const [ready, setReady] = useState(!USE_API);

  // Hydratation asynchrone (mode API uniquement : repository.hydrate présent).
  useEffect(() => {
    if (!repository.hydrate) return; // flag off : rien à faire
    let cancelled = false;
    repository.hydrate()
      .then((serverState) => {
        if (cancelled) return;
        dispatch({ type: 'SET_STATE', payload: serverState });
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSyncError('Impossible de charger les données depuis le serveur.');
        setReady(true); // on débloque l'UI (état vide) plutôt que rester bloqué
      });
    return () => { cancelled = true; };
  }, [repository]);

  // Persistance : effet réactif sur le state ENTIER (timing inchangé).
  // Flag off -> saveState (localStorage). Flag on -> diff-sync vers l'API.
  useEffect(() => {
    repository.persist(state);
  }, [repository, state]);

  // Sélecteurs de vue (purs sur `state`) : restent dans le provider.
  const getLeadActions = (leadId: string) =>
    state.actions.filter(a => a.leadId === leadId).sort((a, b) => b.date.localeCompare(a.date));
  const getCommercialName = (id: string) =>
    state.commercials.find(c => c.id === id)?.name ?? id;

  // En flag on, tant que l'hydratation n'est pas finie : écran de chargement.
  // En flag off, `ready` est true d'emblée -> ce bloc n'est jamais atteint.
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">
        Chargement des données…
      </div>
    );
  }

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
      {/* Bandeau d'erreur de synchro (mode API) : discret, non bloquant. */}
      {syncError && (
        <div className="fixed top-0 inset-x-0 z-50 bg-danger-600 text-white text-xs px-4 py-2 flex items-center justify-between">
          <span>Synchronisation : {syncError}</span>
          <button onClick={() => setSyncError(null)} className="underline ml-4 shrink-0">Masquer</button>
        </div>
      )}
      {children}
    </AppContext.Provider>
  );
}
