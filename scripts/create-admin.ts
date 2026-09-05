
import { createUser } from '../src/db/users.ts';

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const displayName =
    process.env.ADMIN_DISPLAY_NAME || 'Administrator';

  if (!email || !password) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD must be defined'
    );
  }

  if (password.length < 12) {
    throw new Error(
      'ADMIN_PASSWORD must contain at least 12 characters'
    );
  }

  const user = await createUser({
    email,
    password,
    displayName,
    role: 'ADMIN',
  });

  console.log('Admin created successfully:', {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
  });
}

main().catch((error) => {
  console.error('Failed to create admin:', error);
  process.exit(1);
});
