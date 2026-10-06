import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';

const USAGE = `Usage:
  cli create-admin <email> [name]   Create an admin and print their invite link
  cli reset-link <email>            Print a new invite (password reset) link for a user`;

async function main(args: string[]): Promise<number> {
  const [command, email, ...rest] = args;
  if (!command || !email) {
    console.error(USAGE);
    return 1;
  }
  const config = loadConfig();
  const { stores, pool } = await bootstrap(config);
  try {
    if (command === 'create-admin') {
      if (await stores.users.findByEmail(email)) {
        console.error(`${email} already has an account. Use reset-link to get a new sign-in link.`);
        return 1;
      }
      const user = await stores.users.create({ email, name: rest.join(' ') || email.split('@')[0]!, role: 'admin' });
      const token = await stores.users.createInvite(user.id);
      console.log(`Admin ${user.email} created. Open this link within 7 days to set a password:\n${config.baseUrl}/invite/${token}`);
      return 0;
    }
    if (command === 'reset-link') {
      const user = await stores.users.findByEmail(email);
      if (!user) {
        console.error(`No user with email ${email}`);
        return 1;
      }
      const token = await stores.users.createInvite(user.id);
      console.log(`Open this link within 7 days to set a new password:\n${config.baseUrl}/invite/${token}`);
      return 0;
    }
    console.error(USAGE);
    return 1;
  } finally {
    await pool.end();
  }
}

process.exitCode = await main(process.argv.slice(2));
