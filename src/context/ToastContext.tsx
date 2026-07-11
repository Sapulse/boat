import { useCallback, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { toastReducer, toastDuration } from './toastReducer';
import type { ToastKind } from './toastReducer';
import { ToastContext } from './useToast';
import ToastContainer from '../components/ui/ToastContainer';

/**
 * Confort de navigation (B3) : feedback éphémère après les écritures (lead créé,
 * action ajoutée…). Toute la logique de pile (plafond, dédoublonnage, durées)
 * vit dans le reducer PUR (toastReducer, couvert par harness-toast) ; ici on ne
 * fait que le câblage React : timers d'auto-fermeture + rendu du container.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  // Ids par compteur (pas de Date.now : deux toasts dans la même ms doivent
  // rester distincts). Un DISMISS orphelin (toast déjà remplacé) est un no-op.
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => dispatch({ type: 'DISMISS', id }), []);
  const show = useCallback((kind: ToastKind, message: string) => {
    const id = `toast-${++seq.current}`;
    dispatch({ type: 'PUSH', toast: { id, kind, message } });
    window.setTimeout(() => dispatch({ type: 'DISMISS', id }), toastDuration(kind));
  }, []);

  const api = useMemo(() => ({
    success: (message: string) => show('success', message),
    error: (message: string) => show('error', message),
    info: (message: string) => show('info', message),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
