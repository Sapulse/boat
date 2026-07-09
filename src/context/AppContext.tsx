import { useReducer, useEffect, useMemo, useState, type ReactNode } from 'react';
import { reducer } from './appReducer';
import { AppContext } from './useApp';
import { createLocalStorageRepository, createApiRepository, getInitialCrmState, getEmptyState, type SyncInfo } from '../lib/repository';
import { USE_API } from '../lib/flags';
import LoginScreen from '../components/auth/LoginScreen';
import type { ImportPayload, ImportReport } from '../lib/importLeads';
import type { BackupEnvelope, RestoreReport } from '../lib/backup';

// Ce fichier ne contient QUE le composant AppProvider (react-refresh).
// Le reducer + l'initialisation vivent dans appReducer.ts ; le contexte + useApp
// dans useApp.ts. Le flag USE_API vit dans lib/flags.ts (constante de build,
// partagée avec le Header pour le tree-shaking du badge de synchro).
//
// FLAG OFF (défaut) = localStorage À L'IDENTIQUE : aucune hydratation async,
// aucun écran de chargement, aucun badge de synchro, persist = saveState ->
// zéro changement pour les commerciaux. Tout le code API ci-dessous (sous
// USE_API, constante de build) est éliminé du bundle en flag off.
// FLAG ON = l'app parle à l'API (hydratation serveur + outbox + indicateur).

export function AppProvider({ children }: { children: ReactNode }) {
  // État de synchro (mode API) : alimenté par onSync du repository. Null en flag off.
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  // Échec d'hydratation (mode API) : écran bloquant + Réessayer. `hydrateNonce`
  // relance l'hydratation.
  const [hydrateError, setHydrateError] = useState(false);
  const [hydrateNonce, setHydrateNonce] = useState(0);
  // Loading gate : prêt d'emblée en flag off ; en flag on, on attend l'hydratation.
  const [ready, setReady] = useState(!USE_API);
  // Auth (Lot 7 allégé, flag on) : null = vérification de session en cours ;
  // true = session OK ; false = login requis. Flag off -> toujours true (tree-shaké).
  const [authed, setAuthed] = useState<boolean | null>(USE_API ? null : true);

  // Init paresseuse : localStorage (sync) en flag off ; état VIDE en flag on
  // (l'état réel arrive via l'hydratation serveur, sous le loading gate).
  const [state, dispatch] = useReducer(reducer, undefined, USE_API ? getEmptyState : getInitialCrmState);

  // `dispatch` a une identité STABLE (useReducer) -> repository créé une seule fois.
  const repository = useMemo(
    () => USE_API
      ? createApiRepository({
          dispatch,
          onSync: setSyncInfo,
          baseUrl: import.meta.env.VITE_API_BASE_URL,
          // 401 (session expirée) -> on redemande le login et on bloque l'app.
          onUnauthorized: () => { setAuthed(false); setReady(false); },
        })
      : createLocalStorageRepository(dispatch),
    [dispatch],
  );

  // Vérif de session au montage (flag on) : décide login vs hydratation. Absent
  // en flag off (checkSession undefined) -> authed déjà true.
  useEffect(() => {
    if (!USE_API || !repository.checkSession) return;
    let cancelled = false;
    repository.checkSession().then(ok => { if (!cancelled) setAuthed(ok); });
    return () => { cancelled = true; };
  }, [repository]);

  // Hydratation asynchrone (mode API) — SEULEMENT une fois authentifié. En cas
  // d'échec : ÉCRAN BLOQUANT (pas de démarrage sur un état vide trompeur) —
  // l'outbox a déjà tenté de drainer les écritures avant de lire.
  useEffect(() => {
    if (!repository.hydrate || authed !== true) return; // flag off / non authentifié : rien
    let cancelled = false;
    repository.hydrate()
      .then((serverState) => {
        if (cancelled) return;
        dispatch({ type: 'SET_STATE', payload: serverState });
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHydrateError(true); // ne PAS débloquer sur du vide
      });
    return () => { cancelled = true; };
  }, [repository, hydrateNonce, authed]);

  // Relance l'hydratation (écran d'échec) : reset dans le HANDLER, pas l'effet.
  const retryHydrate = () => { setHydrateError(false); setReady(false); setHydrateNonce(n => n + 1); };

  // Connexion (écran de login) : au succès, la session est posée (cookie) -> on
  // autorise, ce qui déclenche l'hydratation.
  const handleLogin = async (username: string, password: string) => {
    if (!repository.login) return;
    await repository.login(username, password);
    setHydrateError(false);
    setReady(false);
    setAuthed(true);
  };

  // Persistance : effet réactif sur le state ENTIER (timing inchangé).
  // Flag off -> saveState (localStorage). Flag on -> enqueue outbox.
  useEffect(() => {
    repository.persist(state);
  }, [repository, state]);

  // Avertissement fermeture/rechargement d'onglet s'il reste des écritures non
  // synchronisées (mode API). Message natif du navigateur (texte non
  // personnalisable). Tree-shaké en flag off (USE_API = false constant).
  useEffect(() => {
    if (!USE_API) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (repository.sync?.hasPending()) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [repository]);

  // Sélecteurs de vue (purs sur `state`) : restent dans le provider.
  const getLeadActions = (leadId: string) =>
    state.actions.filter(a => a.leadId === leadId).sort((a, b) => b.date.localeCompare(a.date));
  // Repli « — » quand aucun commercial ne correspond (id vide ou obsolète) : on
  // n'affiche JAMAIS une UUID brute. NB : distinct du VRAI commercial « Non
  // attribué » (créé à l'import) qui, lui, a un id + nom réels et est trouvé ici.
  const getCommercialName = (id: string) =>
    state.commercials.find(c => c.id === id)?.name ?? '—';

  // Import en masse (mode API) : écrit via l'endpoint bulk (hors outbox) PUIS
  // ré-hydrate l'état depuis la base (l'aperçu se vide, la base s'affiche à jour).
  async function runBulkImport(payload: ImportPayload): Promise<ImportReport> {
    if (!repository.bulkImport) throw new Error('Import indisponible en mode local.');
    const report = await repository.bulkImport(payload);
    if (repository.hydrate) dispatch({ type: 'SET_STATE', payload: await repository.hydrate() });
    return report;
  }

  // Restauration (mode API) : REMPLACE tout en base PUIS ré-hydrate l'écran.
  async function runRestore(payload: BackupEnvelope): Promise<RestoreReport> {
    if (!repository.restore) throw new Error('Restauration indisponible en mode local.');
    const report = await repository.restore(payload);
    if (repository.hydrate) dispatch({ type: 'SET_STATE', payload: await repository.hydrate() });
    return report;
  }

  // Gate d'AUTH (Lot 7 allégé, flag on) — AVANT toute hydratation. Tree-shaké en
  // flag off (USE_API constant false) : les commerciaux localStorage n'ont aucun login.
  if (USE_API && authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">
        Vérification de l'accès…
      </div>
    );
  }
  if (USE_API && authed === false) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  // Écran BLOQUANT si l'hydratation a échoué (mode API) : l'app ne démarre jamais
  // sur un état vide trompeur. Tree-shaké en flag off.
  if (USE_API && hydrateError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-6">
        <p className="text-gray-800 font-medium">Impossible de charger les données depuis le serveur.</p>
        <p className="text-sm text-gray-500 max-w-md">Vérifiez votre connexion. Vos éventuelles modifications non enregistrées sont conservées et repartiront à la reconnexion.</p>
        <button onClick={retryHydrate} className="btn-primary btn-sm">Réessayer</button>
      </div>
    );
  }

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
        // Contrôle de synchro exposé au Header (mode API). Undefined -> DCE en flag off.
        sync: USE_API && repository.sync
          ? { info: syncInfo ?? { status: 'idle', pending: 0 }, retryFailed: repository.sync.retryFailed, abandonFailed: repository.sync.abandonFailed }
          : undefined,
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
        importBulk: USE_API && repository.bulkImport ? runBulkImport : undefined,
        restoreBackup: USE_API && repository.restore ? runRestore : undefined,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
