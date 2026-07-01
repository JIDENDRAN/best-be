import makeWASocket, { DisconnectReason, proto, Browsers } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { initAuthCreds } from '@whiskeysockets/baileys/lib/Utils/auth-utils.js';
import { BufferJSON } from '@whiskeysockets/baileys/lib/Utils/generics.js';

let sock = null;
let isConnected = false;
let database = null;
let reconnectTimeout = null;

export async function useSQLiteAuthState(db) {
  const writeData = async (data, id) => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    await db.run(
      'INSERT INTO whatsapp_auth_state (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value',
      [id, value]
    );
  };

  const readData = async (id) => {
    try {
      const row = await db.get('SELECT value FROM whatsapp_auth_state WHERE id = ?', [id]);
      if (!row) return null;
      return JSON.parse(row.value, BufferJSON.reviver);
    } catch (error) {
      return null;
    }
  };

  const removeData = async (id) => {
    try {
      await db.run('DELETE FROM whatsapp_auth_state WHERE id = ?', [id]);
    } catch (error) {
      // Ignore
    }
  };

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          if (ids.length === 0) return data;
          
          const fullIds = ids.map(id => `${type}-${id}`);
          const placeholders = fullIds.map(() => '?').join(',');
          
          try {
            const rows = await database.all(`SELECT id, value FROM whatsapp_auth_state WHERE id IN (${placeholders})`, fullIds);
            const rowsMap = {};
            for (const row of rows) {
              rowsMap[row.id] = row.value;
            }

            for (const id of ids) {
              const key = `${type}-${id}`;
              const rowValue = rowsMap[key];
              if (rowValue) {
                let parsed = JSON.parse(rowValue, BufferJSON.reviver);
                if (type === 'app-state-sync-key' && parsed) {
                  parsed = proto.Message.AppStateSyncKeyData.fromObject(parsed);
                }
                data[id] = parsed;
              }
            }
          } catch (error) {
            console.error('Batch read error:', error);
          }
          
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(value, key) : removeData(key));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      return writeData(creds, 'creds');
    }
  };
}

export async function connectToWhatsApp(db) {
  if (db) {
    database = db;
  }

  if (!database) {
    console.error('Database not initialized for WhatsApp bot.');
    return;
  }

  // Clear any existing reconnect timeout
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  // Clean up old socket listeners
  if (sock) {
    try {
      sock.ev.removeAllListeners('connection.update');
      sock.ev.removeAllListeners('creds.update');
      sock.end(new Error('Reconnecting'));
    } catch (err) {
      // Ignore
    }
    sock = null;
  }

  try {
    const { state, saveCreds } = await useSQLiteAuthState(database);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false, // We will print it custom with qrcode-terminal
      logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console.log('\n==================================================================');
        console.log('SCAN QR CODE BELOW TO CONNECT THE ADMIN WHATSAPP NOTIFICATION BOT:');
        console.log('==================================================================\n');
        qrcode.generate(qr, { small: true });
        console.log('\n==================================================================\n');
        
        // Also save QR to database so frontend can display it in the Admin Dashboard!
        await database.run(
          "UPDATE admin_settings SET qr_code = ?",
          [qr]
        ).catch((err) => {
          console.error('Failed to save QR code in settings:', err);
        });
      }

      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`WhatsApp connection closed (status code: ${statusCode}). Reconnecting: ${shouldReconnect}`);
        
        // Remove qr_code from DB if connection closed or logged out
        await database.run("UPDATE admin_settings SET qr_code = NULL").catch(() => {});

        if (shouldReconnect) {
          reconnectTimeout = setTimeout(() => connectToWhatsApp(), 5000);
        }
      } else if (connection === 'open') {
        console.log('====================================================');
        console.log('✅ WHATSAPP NOTIFICATION BOT CONNECTED SUCCESSFULLY!');
        console.log('====================================================');
        isConnected = true;
        // Remove QR code from DB once connected
        await database.run("UPDATE admin_settings SET qr_code = NULL").catch(() => {});
      }
    });

    // Auto-reply to incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      
      const msg = messages[0];
      // Ignore if it's from ourselves or has no text
      if (!msg.message || msg.key.fromMe) return;

      const senderJid = msg.key.remoteJid;
      // Simple generic auto-reply for customers
      const replyText = "Hello! 👋 Welcome to Madurai Best Tours and Travels.\n\nWe have received your message. Our team will review it and get back to you shortly! You can also book a vehicle directly from our website.";
      
      try {
        await sock.sendMessage(senderJid, { text: replyText });
        console.log(`[WhatsApp] Sent auto-reply to ${senderJid}`);
      } catch (err) {
        console.error('[WhatsApp] Failed to send auto-reply:', err);
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    console.error('Failed to initialize Baileys WhatsApp client:', err);
    reconnectTimeout = setTimeout(() => connectToWhatsApp(), 5000);
  }
}

export async function sendWhatsAppNotification(toPhone, message) {
  if (!sock || !isConnected) {
    console.log('\n⚠️ WhatsApp notification not dispatched. WhatsApp bot is not active or authenticated yet.');
    console.log('Notification Content:\n', message, '\n');
    return false;
  }

  try {
    // Format recipient phone number to JID format
    let cleanPhone = toPhone.replace(/[^0-9]/g, '');
    if (!cleanPhone.startsWith('91') && cleanPhone.length === 10) {
      cleanPhone = '91' + cleanPhone;
    }
    const jid = `${cleanPhone}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: message });
    console.log(`[WhatsApp Success] Booking notification dispatched to admin JID: ${jid}`);
    return true;
  } catch (err) {
    console.error('Error dispatching WhatsApp notification via Baileys:', err);
    return false;
  }
}

export function getWhatsAppStatus() {
  return isConnected;
}

export async function disconnectWhatsApp() {
  if (sock) {
    try {
      await sock.logout();
    } catch (err) {
      console.error('Error logging out of WhatsApp:', err);
    }
  }
  if (database) {
    await database.run("DELETE FROM whatsapp_auth_state").catch(() => {});
    await database.run("UPDATE admin_settings SET qr_code = NULL").catch(() => {});
  }
  isConnected = false;
  sock = null;
}
