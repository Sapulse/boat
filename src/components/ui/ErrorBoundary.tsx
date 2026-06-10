import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Filet de securite racine : attrape toute erreur de rendu (y compris un crash
 * du provider au montage, ex. state localStorage corrompu a la main) et affiche
 * un ecran de secours au lieu d'une page blanche.
 *
 * Volontairement SANS bouton "reinitialiser les donnees" : un crash de rendu
 * n'efface pas le localStorage, recharger suffit dans les cas transitoires, et
 * on ne met pas d'action destructive sous la main d'un utilisateur panique.
 *
 * Class component : seul mecanisme React pour intercepter les erreurs de rendu.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Erreur de rendu interceptee par ErrorBoundary :', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="card max-w-md w-full p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-full bg-danger-50 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-danger-600" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900">Une erreur est survenue</h1>
          <p className="text-sm text-gray-500">
            L'application a rencontré un problème inattendu. Vos données sont
            enregistrées localement sur ce poste et ne sont pas perdues.
          </p>
          <button onClick={this.handleReload} className="btn-primary mx-auto">
            <RotateCw className="w-4 h-4" /> Recharger la page
          </button>
          <details className="text-left">
            <summary className="text-xs text-gray-400 cursor-pointer select-none">
              Détail technique
            </summary>
            <p className="mt-2 text-xs text-gray-500 font-mono break-words bg-gray-50 rounded-md p-3">
              {this.state.error.message || String(this.state.error)}
            </p>
          </details>
        </div>
      </div>
    );
  }
}
