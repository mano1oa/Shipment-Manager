import { FormEvent, useState } from 'react';

interface LoginViewProps {
  onLoginSuccess: (user: {
    id: string;
    email: string;
    display_name: string;
    role: string;
  }) => void;
}

export default function LoginView({
  onLoginSuccess,
}: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(
          data.error || 'Impossible de se connecter'
        );
        return;
      }

      onLoginSuccess(data.user);
    } catch (err) {
      console.error('Login error:', err);

      setError(
        'Une erreur est survenue pendant la connexion'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl p-8">
          <div className="mb-8">
            <p className="text-sm font-medium text-blue-600 mb-2">
              Supply Chain Control Tower
            </p>

            <h1 className="text-2xl font-semibold text-slate-900">
              Shipment Manager
            </h1>

            <p className="text-sm text-slate-500 mt-2">
              Connectez-vous pour accéder au suivi des expéditions.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-5"
          >
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                Adresse email
              </label>

              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="nom@entreprise.com"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-2"
              >
                Mot de passe
              </label>

              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                placeholder="Votre mot de passe"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading
                ? 'Connexion...'
                : 'Se connecter'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
