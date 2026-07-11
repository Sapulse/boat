import { createContext, useContext } from 'react';

// Module sans composant : contexte + hook d'accès. Séparé de ToastContext.tsx
// (qui ne garde que le composant ToastProvider) pour la règle
// react-refresh/only-export-components — même découpage que AppContext/useApp.

export interface ToastApi {
  success(message: string): void;
  error(message: string): void;
  info(message: string): void;
}

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être appelé sous <ToastProvider>');
  return ctx;
}
