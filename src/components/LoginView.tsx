import { FormEvent, useState } from 'react';
import { AlertCircle, ArrowRight, BellRing, ClipboardCheck, Eye, EyeOff, Loader2, Lock, Mail, Plane, Ship } from 'lucide-react';
import nexthopeLogotype from '../assets/nexthope-logotype.png';
import { LoginRouteLegend, LoginRouteMap } from './LoginRouteMap';

interface LoginViewProps {
  onLoginSuccess: (user: {
    id: string;
    email: string;
    display_name: string;
    role: string;
  }) => void;
}

const HIGHLIGHTS = [
  { icon: Plane, title: 'Suivi aérien et maritime', text: 'Chaque colis, du fournisseur jusqu’à Madagascar.' },
  { icon: BellRing, title: 'Alertes automatiques', text: 'Retards, colis perdus ou incomplets signalés à temps.' },
  { icon: ClipboardCheck, title: 'Réception Madagascar', text: 'Pointage des articles reçus, facture par facture.' },
];

export default function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
        setError(data.error || 'Impossible de se connecter');
        return;
      }

      onLoginSuccess(data.user);
    } catch (err) {
      console.error('Login error:', err);
      setError('Une erreur est survenue pendant la connexion');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#623387] focus:ring-4 focus:ring-[#623387]/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-[#A175E0] dark:focus:ring-[#A175E0]/15';

  return (
    <div className="flex min-h-dvh flex-col bg-[#F7F7F7] font-sans dark:bg-slate-950 lg:flex-row">
      {/* Phone / tablet: violet band with the map */}
      <section className="flex flex-col gap-3 rounded-b-[28px] bg-[#623387] px-6 pb-5 pt-6 text-white lg:hidden">
        <p className="inline-flex items-center gap-2 self-start rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-[11px] font-semibold">
          <span className="h-1.5 w-1.5 rounded-full bg-[#62D18F]" />
          Supply Chain Control Tower
        </p>
        <LoginRouteMap compact className="mx-auto max-w-md" />
        <LoginRouteLegend />
      </section>

      {/* Brand panel (large screens): NextHope gradient, violet → magenta */}
      <aside className="relative hidden w-[46%] max-w-[640px] flex-col justify-between gap-8 overflow-hidden bg-[#623387] p-14 text-white lg:flex">
        <div className="relative">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-[#62D18F]" />
            Supply Chain Control Tower
          </p>
        </div>

        <div className="relative space-y-8">
          <figure className="max-w-[470px] space-y-3">
            <LoginRouteMap />
            <figcaption>
              <LoginRouteLegend />
            </figcaption>
          </figure>

          <h2 className="max-w-md text-[38px] font-semibold leading-[1.12] tracking-tight">
            Toutes vos expéditions, en un seul endroit.
          </h2>

          <ul className="space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-sm text-white/70">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-white/60">
          <Ship className="h-3.5 w-3.5" /> NextHope · Shipment Manager
        </p>
      </aside>

      {/* Form */}
      <main className="flex flex-1 items-center justify-center px-6 py-6 sm:px-8 lg:py-10">
        <div className="w-full max-w-sm">
          <img
            src={nexthopeLogotype}
            alt="NextHope"
            className="mb-5 h-7 w-auto select-none dark:brightness-0 dark:invert lg:mb-10 lg:h-[44px]"
            draggable={false}
          />

          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-white">Connexion</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Connectez-vous pour accéder au suivi des expéditions.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Adresse email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={inputClass}
                  placeholder="nom@entreprise.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                Mot de passe
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`${inputClass} pr-11`}
                  placeholder="Votre mot de passe"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#623387] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[#623387]/25 transition hover:bg-[#522870] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Connexion…
                </>
              ) : (
                <>
                  Se connecter
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-xs text-slate-500 dark:text-slate-400 lg:mt-10">
            Accès réservé aux équipes NextHope. Un problème de connexion ? Contactez l’équipe Supply Chain.
          </p>
        </div>
      </main>
    </div>
  );
}
