import { FormEvent, useEffect, useState } from 'react';

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

export function SettingsUsersView() {
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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          Utilisateurs & accès
        </h1>

        <p className="mt-1 text-sm text-slate-500">
          Gérez les comptes et les rôles de Shipment Manager.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold mb-4">
          Nouvel utilisateur
        </h2>

        <form
          onSubmit={handleCreateUser}
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            placeholder="Nom"
            className="rounded-lg border border-slate-300 px-3 py-2"
          />

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            type="email"
            placeholder="Email"
            className="rounded-lg border border-slate-300 px-3 py-2"
          />

          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            type="password"
            placeholder="Mot de passe initial"
            className="rounded-lg border border-slate-300 px-3 py-2"
          />

          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="SUPPLY_CHAIN">Supply Chain</option>
            <option value="SOURCING">Sourcing</option>
            <option value="DIRECTION">Direction</option>
          </select>

          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {creating ? 'Création...' : 'Créer utilisateur'}
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="p-6 text-sm text-slate-500">
            Chargement...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left">Utilisateur</th>
                  <th className="px-4 py-3 text-left">Email</th>
                  <th className="px-4 py-3 text-left">Rôle</th>
                  <th className="px-4 py-3 text-left">Statut</th>
                  <th className="px-4 py-3 text-left">
                    Dernière connexion
                  </th>
                </tr>
              </thead>

              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-t border-slate-200 dark:border-slate-800"
                  >
                    <td className="px-4 py-3">
                      {user.display_name}
                    </td>

                    <td className="px-4 py-3">
                      {user.email}
                    </td>

                    <td className="px-4 py-3">
                      <select
                        value={user.role}
                        onChange={(e) =>
                          handleRoleChange(
                            user.id,
                            e.target.value as UserRole
                          )
                        }
                        className="rounded-md border border-slate-300 px-2 py-1"
                      >
                        <option value="SUPPLY_CHAIN">
                          Supply Chain
                        </option>
                        <option value="SOURCING">
                          Sourcing
                        </option>
                        <option value="DIRECTION">
                          Direction
                        </option>
                      </select>
                    </td>

                    <td className="px-4 py-3">
                      <button
                        onClick={() =>
                          handleStatusChange(
                            user.id,
                            !user.is_active
                          )
                        }
                        className="rounded-md border border-slate-300 px-3 py-1"
                      >
                        {user.is_active
                          ? 'Actif'
                          : 'Désactivé'}
                      </button>
                    </td>

                    <td className="px-4 py-3 text-slate-500">
                      {user.last_login_at
                        ? new Date(
                            user.last_login_at
                          ).toLocaleString()
                        : 'Jamais'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}