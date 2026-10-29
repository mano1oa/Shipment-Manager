import { FormEvent, useEffect, useState } from 'react';
import { Users, UserPlus, KeyRound, X } from 'lucide-react';
import { formatDateTime } from '../lib/dateFormat';
import { SettingsCard } from './SettingsSystemPanels';

type UserRole = 'SUPPLY_CHAIN' | 'SOURCING' | 'DIRECTION';

type UserItem = {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export function SettingsUsersView({ currentUserId }: { currentUserId: string }) {
  // Password reset of another user (forgotten password)
  const [resetFor, setResetFor] = useState<UserItem | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetDone, setResetDone] = useState(false);

  function openReset(user: UserItem) {
    setResetFor(user);
    setResetPassword('');
    setResetConfirm('');
    setResetError('');
    setResetDone(false);
  }

  async function handleResetPassword(event: FormEvent) {
    event.preventDefault();
    if (!resetFor || resetDone) return;
    if (resetPassword !== resetConfirm) {
      setResetError('La confirmation ne correspond pas au mot de passe.');
      return;
    }
    try {
      setResetting(true);
      setResetError('');
      const response = await fetch(`/api/admin/users/${resetFor.id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: resetPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Impossible de réinitialiser le mot de passe');
      }
      setResetDone(true);
      setResetPassword('');
      setResetConfirm('');
    } catch (err: any) {
      setResetError(err?.message || 'Erreur lors de la réinitialisation');
    } finally {
      setResetting(false);
    }
  }

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('DIRECTION');
  const [creating, setCreating] = useState(false);

  async function loadUsers() {
    try {
      setLoading(true);
      setError('');

      const response = await fetch('/api/admin/users', {
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Impossible de charger les utilisateurs');
      }

      setUsers(data.users || []);
    } catch (err: any) {
      setError(err?.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleCreateUser(event: FormEvent) {
    event.preventDefault();

    try {
      setCreating(true);
      setError('');

      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          displayName,
          email,
          password,
          role,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Impossible de créer l’utilisateur');
      }

      setDisplayName('');
      setEmail('');
      setPassword('');
      setRole('DIRECTION');

      await loadUsers();
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(
    userId: string,
    newRole: UserRole
  ) {
    try {
      const response = await fetch(
        `/api/admin/users/${userId}/role`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            role: newRole,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Impossible de modifier le rôle');
      }

      await loadUsers();
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la modification du rôle');
    }
  }

  async function handleStatusChange(
    userId: string,
    isActive: boolean
  ) {
    try {
      const response = await fetch(
        `/api/admin/users/${userId}/status`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            isActive,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Impossible de modifier le statut');
      }

      await loadUsers();
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la modification du statut');
    }
  }

  const fieldClass =
    'rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#623387] focus:outline-none focus:ring-2 focus:ring-[#623387]/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

  return (
    <SettingsCard
      icon={Users}
      title="Utilisateurs et accès"
      description="Comptes et rôles de Shipment Manager. Chaque utilisateur change son mot de passe depuis son profil (en haut à droite)."
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreateUser}
        className="mb-5 grid gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60 md:grid-cols-2 xl:grid-cols-5"
      >
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          placeholder="Nom"
          className={fieldClass}
        />

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          type="email"
          placeholder="Email"
          className={fieldClass}
        />

        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={12}
          type="password"
          placeholder="Mot de passe initial (12 car. min.)"
          className={fieldClass}
        />

        <select
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className={fieldClass}
        >
          <option value="SUPPLY_CHAIN">Supply Chain</option>
          <option value="SOURCING">Sourcing</option>
          <option value="DIRECTION">Direction</option>
        </select>

        <button
          type="submit"
          disabled={creating}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-[#623387] px-4 py-2 text-xs font-bold text-white hover:bg-[#522870] disabled:opacity-50"
        >
          <UserPlus className="h-3.5 w-3.5" />
          {creating ? 'Création...' : 'Créer l’utilisateur'}
        </button>
      </form>

      {loading ? (
        <p className="text-xs text-slate-500">Chargement...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Utilisateur</th>
                <th className="px-3 py-2 font-semibold">Email</th>
                <th className="px-3 py-2 font-semibold">Rôle</th>
                <th className="px-3 py-2 font-semibold">Statut</th>
                <th className="px-3 py-2 font-semibold">Dernière connexion</th>
                <th className="px-3 py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {users.map((user) => (
                <tr key={user.id} className={user.is_active ? '' : 'opacity-60'}>
                  <td className="px-3 py-2.5 font-bold text-slate-900 dark:text-slate-100">
                    {user.display_name}
                  </td>

                  <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">
                    {user.email}
                  </td>

                  <td className="px-3 py-2.5">
                    <select
                      value={user.role}
                      onChange={(e) =>
                        handleRoleChange(
                          user.id,
                          e.target.value as UserRole
                        )
                      }
                      className={`${fieldClass} py-1`}
                    >
                      <option value="SUPPLY_CHAIN">Supply Chain</option>
                      <option value="SOURCING">Sourcing</option>
                      <option value="DIRECTION">Direction</option>
                    </select>
                  </td>

                  <td className="px-3 py-2.5">
                    <button
                      onClick={() =>
                        handleStatusChange(
                          user.id,
                          !user.is_active
                        )
                      }
                      title={user.is_active ? 'Cliquer pour désactiver' : 'Cliquer pour réactiver'}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold transition ${
                        user.is_active
                          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {user.is_active
                        ? 'Actif'
                        : 'Désactivé'}
                    </button>
                  </td>

                  <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">
                    {formatDateTime(user.last_login_at, 'Jamais')}
                  </td>

                  <td className="px-3 py-2.5 text-right">
                    {user.id !== currentUserId && (
                      <button
                        type="button"
                        onClick={() => openReset(user)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        <KeyRound className="h-3 w-3" /> Réinitialiser le mot de passe
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <form
            onSubmit={handleResetPassword}
            className="w-full max-w-md space-y-3 rounded-3xl border border-slate-200 bg-white p-6 text-xs shadow-2xl dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Réinitialiser le mot de passe</h3>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {resetFor.display_name} ({resetFor.email}) sera déconnecté. Communiquez-lui le mot de passe provisoire :
                  il pourra le changer depuis son profil.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetFor(null)}
                aria-label="Fermer"
                className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {resetError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {resetError}
              </div>
            )}
            {resetDone ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                Mot de passe réinitialisé.
              </div>
            ) : (
              <>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Mot de passe provisoire <span className="font-normal text-slate-400">(12 caractères min.)</span>
                  <input
                    type="password"
                    required
                    minLength={12}
                    autoComplete="new-password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className={`${fieldClass} mt-1 w-full`}
                    autoFocus
                  />
                </label>
                <label className="block font-semibold text-slate-700 dark:text-slate-300">
                  Confirmer
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    value={resetConfirm}
                    onChange={(e) => setResetConfirm(e.target.value)}
                    className={`${fieldClass} mt-1 w-full`}
                  />
                </label>
              </>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setResetFor(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {resetDone ? 'Fermer' : 'Annuler'}
              </button>
              {!resetDone && (
                <button
                  type="submit"
                  disabled={resetting}
                  className="rounded-xl bg-[#623387] px-5 py-2 font-bold text-white hover:bg-[#522870] disabled:opacity-50"
                >
                  {resetting ? 'Enregistrement...' : 'Réinitialiser'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </SettingsCard>
  );
}
