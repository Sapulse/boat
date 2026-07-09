import { useState } from 'react';
import logo from '../../assets/logo.png';

// Écran de connexion (Lot 7 allégé — compte unique partagé). Rendu par AppProvider
// UNIQUEMENT en flag on, tant que la session n'est pas établie. Aucun secret ici :
// l'utilisateur tape le mot de passe, le serveur pose un cookie de session signé.

export default function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('contact@brest-ocean-boat.fr');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onLogin(username, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <form onSubmit={submit} className="card p-8 w-full max-w-sm space-y-5">
        <img src={logo} alt="Brest Ocean Boat" className="w-[180px] max-h-12 object-contain mx-auto" />
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900">Connexion</h1>
          <p className="text-xs text-gray-500 mt-1">Accès réservé — CRM Brest Ocean Boat</p>
        </div>
        <div>
          <label htmlFor="login-user" className="label">Identifiant</label>
          <input id="login-user" type="email" autoComplete="username" className="input" value={username} onChange={e => setUsername(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="login-pw" className="label">Mot de passe</label>
          <input id="login-pw" type="password" autoComplete="current-password" className="input" value={password} onChange={e => setPassword(e.target.value)} required autoFocus />
        </div>
        {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full justify-center disabled:opacity-60">
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
