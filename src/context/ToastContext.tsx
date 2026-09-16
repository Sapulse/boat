import { useCallback, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { toastReducer, toastDuration } from './toastReducer';
import type { ToastKind, ToastAction } from './toastReducer';
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
  const show = useCallback((kind: ToastKind, message: string, action?: ToastAction) => {
    const id = `toast-${++seq.current}`;
    dispatch({ type: 'PUSH', toast: { id, kind, message, action } });
    window.setTimeout(() => dispatch({ type: 'DISMISS', id }), toastDuration(kind, !!action));
  }, []);

  const api = useMemo(() => ({
    success: (message: string, action?: ToastAction) => show('success', message, action),
    error: (message: string, action?: ToastAction) => show('error', message, action),
    info: (message: string, action?: ToastAction) => show('info', message, action),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}
