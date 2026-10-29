import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { User, ChevronDown, KeyRound, LogOut, X, Loader2, CheckCircle2, AlertCircle, Sun, Moon } from 'lucide-react';

const PASSWORD_MIN_LENGTH = 12;

interface UserProfileMenuProps {
  user: { id: string; email: string; display_name: string };
  roleLabel: string;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout: () => void;
}

/** Navbar profile: identity, theme, password change and sign-out. */
export const UserProfileMenu: React.FC<UserProfileMenuProps> = ({ user, roleLabel, darkMode, onToggleDarkMode, onLogout }) => {
  const [open, setOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = user.display_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?';

  const itemClass =
    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800';

  return (
    <div ref={menuRef} className="relative border-l border-slate-200 pl-3 dark:border-slate-700">
      <button
        id="nav-btn-profile"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl p-1 pr-2 transition hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#623387]/10 text-[11px] font-extrabold text-[#623387] dark:bg-[#623387]/30 dark:text-[#D7BCE8]">
          {initials}
        </span>
        <span className="hidden max-w-[160px] text-left lg:block">
          <span className="block truncate text-xs font-semibold text-slate-900 dark:text-white">{user.display_name}</span>
          <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">{roleLabel}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          <div className="flex items-center gap-3 border-b border-slate-100 px-3 pb-3 pt-1 dark:border-slate-800">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#623387] text-sm font-extrabold text-white">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{user.display_name}</p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{user.email}</p>
              <span className="mt-1 inline-block rounded-full bg-[#EAD7F9] px-2 py-0.5 text-[10px] font-bold text-[#623387] dark:bg-purple-950 dark:text-[#B688FF]">
                {roleLabel}
              </span>
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                setOpen(false);
                setShowPasswordModal(true);
              }}
            >
              <KeyRound className="h-4 w-4 text-[#623387] dark:text-[#B688FF]" /> Changer le mot de passe
            </button>
            <button type="button" role="menuitem" className={itemClass} onClick={onToggleDarkMode}>
              {darkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-500" />}
              {darkMode ? 'Passer en thème clair' : 'Passer en thème sombre'}
            </button>
            <button
              type="button"
              role="menuitem"
              className={`${itemClass} text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50`}
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
            >
              <LogOut className="h-4 w-4" /> Se déconnecter
            </button>
          </div>
        </div>
      )}

      {/* Portal: the navbar's backdrop-blur would otherwise contain the fixed overlay */}
      {showPasswordModal && createPortal(<ChangePasswordModal onClose={() => setShowPasswordModal(false)} />, document.body)}
    </div>
  );
};

const ChangePasswordModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`Le nouveau mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('La confirmation ne correspond pas au nouveau mot de passe.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Le nouveau mot de passe doit être différent de l’actuel.');
      return;
    }

    try {
      setSaving(true);
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      setDone(true);
    } catch (err: any) {
      setError(err?.message || 'Impossible de changer le mot de passe.');
    } finally {
      setSaving(false);
    }
  }

  const fieldClass =
    'mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-900 focus:border-[#623387] focus:outline-none focus:ring-2 focus:ring-[#623387]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#623387] text-white">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white">Changer le mot de passe</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Vos autres sessions seront déconnectées.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Mot de passe modifié avec succès.
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl bg-[#623387] px-5 py-2 text-xs font-bold text-white hover:bg-[#522870]"
              >
                Fermer
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3 text-xs">
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}
            <label className="block font-semibold text-slate-700 dark:text-slate-300">
              Mot de passe actuel
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={fieldClass}
                autoFocus
              />
            </label>
            <label className="block font-semibold text-slate-700 dark:text-slate-300">
              Nouveau mot de passe <span className="font-normal text-slate-400">({PASSWORD_MIN_LENGTH} caractères min.)</span>
              <input
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={fieldClass}
              />
            </label>
            <label className="block font-semibold text-slate-700 dark:text-slate-300">
              Confirmer le nouveau mot de passe
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={fieldClass}
              />
            </label>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-[#623387] px-5 py-2 font-bold text-white hover:bg-[#522870] disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />} Enregistrer
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
