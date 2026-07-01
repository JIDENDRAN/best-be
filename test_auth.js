import { db, initDatabase } from './db.js';
import { useSQLiteAuthState } from './whatsapp.js';
initDatabase().then(async (d) => {
  try {
    const auth = await useSQLiteAuthState(d);
    console.log('Creds from DB:', auth.state.creds ? 'EXISTS' : 'NULL');
    if (auth.state.creds && auth.state.creds.me) {
      console.log('Phone:', auth.state.creds.me.id);
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
});
