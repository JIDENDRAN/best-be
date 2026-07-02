import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { initDatabase } from './db.js';
import { connectToWhatsApp, sendWhatsAppNotification, getWhatsAppStatus, disconnectWhatsApp } from './whatsapp.js';

const app = express();
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Configure Multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Image Upload API
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  // Return the relative URL string that will be stored in the database
  res.status(200).json({ filePath: `/uploads/${req.file.filename}` });
});

const PORT = process.env.PORT || 5000;

process.on('exit', (code) => {
  console.log(`Process exiting with code ${code}`);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Initialize Database & WhatsApp Bot
let db = null;
initDatabase()
  .then((database) => {
    db = database;
    console.log('SQLite Database loaded and tables initialized.');
    
    // Boot WhatsApp Bot
    // The admin can re-authenticate it from the Admin Dashboard -> Settings if needed.
    connectToWhatsApp(db);
  })
  .catch((err) => {
    console.error('Failed to boot SQLite Database:', err);
  });

// --- HELPER FUNCTION FOR WHATSAPP ALERT DISPATCH ---
async function dispatchAdminWhatsAppAlert(booking) {
  try {
    const admin = await db.get('SELECT * FROM admin_settings LIMIT 1');
    const targetPhone = admin ? admin.whatsapp : '6382513075';
    
    const message = `🚨 *New Booking from Madurai Best Tours and Travels* 🚨\n\n` +
      `👤 *Customer Name:* ${booking.name}\n` +
      `📞 *Phone Number:* ${booking.phone}\n` +
      `📍 *Start Location:* ${booking.fromLocation}\n` +
      `🏁 *End Location:* ${booking.toLocation}\n` +
      `📅 *Date & Time:* ${booking.date} at ${booking.time || 'Not Specified'}\n` +
      `🚗 *Selected Vehicle:* ${booking.vehicle || 'Not Selected'}\n` +
      `📦 *Package Type:* ${booking.packageType || 'Custom Trip'}\n` +
      `🔔 *Booking Status:* ${booking.status}`;
      
    await sendWhatsAppNotification(targetPhone, message);
  } catch (err) {
    console.error('Failed to dispatch WhatsApp booking alert:', err);
  }
}

async function dispatchContactWhatsAppAlert(messageData) {
  try {
    const admin = await db.get('SELECT * FROM admin_settings LIMIT 1');
    const targetPhone = admin ? admin.whatsapp : '6382513075';
    
    const message = `✉️ *New Message received from Madurai Best Tours and Travels* ✉️\n\n` +
      `👤 *Sender Name:* ${messageData.name}\n` +
      `📧 *Email:* ${messageData.email}\n` +
      `📞 *Phone Number:* ${messageData.phone}\n` +
      `💬 *Message:* ${messageData.message}`;
      
    await sendWhatsAppNotification(targetPhone, message);
  } catch (err) {
    console.error('Failed to dispatch WhatsApp contact alert:', err);
  }
}

// --- BOOKINGS API ---

app.post('/api/bookings', async (req, res) => {
  try {
    const { fromLocation, toLocation, date, time, name, phone, vehicle, packageType } = req.body;
    
    const result = await db.run(
      'INSERT INTO bookings ("fromLocation", "toLocation", date, time, name, phone, vehicle, "packageType", status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [fromLocation, toLocation, date, time, name, phone, vehicle || 'Not Selected', packageType || 'Custom Trip', 'Pending']
    );
    
    const newBooking = await db.get('SELECT * FROM bookings WHERE id = ?', [result.lastID]);
    
    // Send instant background WhatsApp notification to admin
    dispatchAdminWhatsAppAlert(newBooking);
    
    res.status(201).json({ message: 'Booking saved successfully', booking: newBooking });
  } catch (error) {
    console.error('Error saving booking:', error);
    res.status(500).json({ error: 'Failed to save booking' });
  }
});

app.get('/api/bookings', async (req, res) => {
  try {
    const bookings = await db.all('SELECT * FROM bookings ORDER BY id DESC');
    res.status(200).json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

app.put('/api/bookings/:id', async (req, res) => {
  try {
    const { status } = req.body;
    await db.run('UPDATE bookings SET status = ? WHERE id = ?', [status, req.params.id]);
    const updated = await db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
    res.status(200).json({ message: 'Booking status updated successfully', booking: updated });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ error: 'Failed to update booking status' });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM bookings WHERE id = ?', [req.params.id]);
    res.status(200).json({ message: 'Booking deleted successfully' });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// --- CARS (FLEET) API ---

app.get('/api/cars', async (req, res) => {
  try {
    const cars = await db.all('SELECT * FROM cars ORDER BY id ASC');
    res.status(200).json(cars);
  } catch (error) {
    console.error('Error fetching fleet:', error);
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

app.post('/api/cars', async (req, res) => {
  try {
    const { name, seats, ac, price, desc, image, bgImage } = req.body;
    const result = await db.run(
      'INSERT INTO cars (name, seats, ac, price, "desc", image, "bgImage") VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, seats, ac, price, desc, image || 'toyota_etios-removebg-preview.png', bgImage || 'kanyakumari_bg.png']
    );
    const newCar = await db.get('SELECT * FROM cars WHERE id = ?', [result.lastID]);
    res.status(201).json({ message: 'Car added successfully', car: newCar });
  } catch (error) {
    console.error('Error creating car:', error);
    res.status(500).json({ error: 'Failed to add vehicle' });
  }
});

app.put('/api/cars/:id', async (req, res) => {
  try {
    const { name, seats, ac, price, desc, image, bgImage } = req.body;
    await db.run(
      'UPDATE cars SET name = ?, seats = ?, ac = ?, price = ?, "desc" = ?, image = ?, "bgImage" = ? WHERE id = ?',
      [name, seats, ac, price, desc, image, bgImage, req.params.id]
    );
    const updated = await db.get('SELECT * FROM cars WHERE id = ?', [req.params.id]);
    res.status(200).json({ message: 'Car details updated successfully', car: updated });
  } catch (error) {
    console.error('Error updating car:', error);
    res.status(500).json({ error: 'Failed to update vehicle' });
  }
});

app.delete('/api/cars/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM cars WHERE id = ?', [req.params.id]);
    res.status(200).json({ message: 'Car removed successfully' });
  } catch (error) {
    console.error('Error removing car:', error);
    res.status(500).json({ error: 'Failed to delete vehicle' });
  }
});

// --- TOUR PACKAGES API ---

app.get('/api/packages', async (req, res) => {
  try {
    const packages = await db.all('SELECT * FROM packages ORDER BY id ASC');
    res.status(200).json(packages);
  } catch (error) {
    console.error('Error fetching packages:', error);
    res.status(500).json({ error: 'Failed to fetch packages' });
  }
});

app.post('/api/packages', async (req, res) => {
  try {
    const { name, duration, places, price, image, rating, reviewCount, location } = req.body;
    const result = await db.run(
      'INSERT INTO packages (name, duration, places, price, image, rating, "reviewCount", location) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, duration, places, price, image || 'meenakshi_bg.png', rating || '5.0', reviewCount || '100+', location || 'Tamil Nadu']
    );
    const newPackage = await db.get('SELECT * FROM packages WHERE id = ?', [result.lastID]);
    res.status(201).json({ message: 'Tour package added successfully', package: newPackage });
  } catch (error) {
    console.error('Error adding package:', error);
    res.status(500).json({ error: 'Failed to add tour package' });
  }
});

app.put('/api/packages/:id', async (req, res) => {
  try {
    const { name, duration, places, price, image, rating, reviewCount, location } = req.body;
    await db.run(
      'UPDATE packages SET name = ?, duration = ?, places = ?, price = ?, image = ?, rating = ?, "reviewCount" = ?, location = ? WHERE id = ?',
      [name, duration, places, price, image, rating, reviewCount, location, req.params.id]
    );
    const updated = await db.get('SELECT * FROM packages WHERE id = ?', [req.params.id]);
    res.status(200).json({ message: 'Package updated successfully', package: updated });
  } catch (error) {
    console.error('Error updating package:', error);
    res.status(500).json({ error: 'Failed to update package' });
  }
});

app.delete('/api/packages/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM packages WHERE id = ?', [req.params.id]);
    res.status(200).json({ message: 'Package deleted successfully' });
  } catch (error) {
    console.error('Error deleting package:', error);
    res.status(500).json({ error: 'Failed to delete package' });
  }
});

// --- CONTACT US API ---

app.post('/api/contacts', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    const result = await db.run(
      'INSERT INTO contacts (name, email, phone, message) VALUES (?, ?, ?, ?)',
      [name, email, phone, message]
    );
    const newMsg = await db.get('SELECT * FROM contacts WHERE id = ?', [result.lastID]);
    
    // Send instant WhatsApp alert to Admin
    dispatchContactWhatsAppAlert(newMsg);
    
    res.status(201).json({ message: 'Message sent successfully', contact: newMsg });
  } catch (error) {
    console.error('Error saving contact query:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

app.get('/api/contacts', async (req, res) => {
  try {
    const msgs = await db.all('SELECT * FROM contacts ORDER BY id DESC');
    res.status(200).json(msgs);
  } catch (error) {
    console.error('Error fetching contact messages:', error);
    res.status(500).json({ error: 'Failed to retrieve messages' });
  }
});

app.delete('/api/contacts/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM contacts WHERE id = ?', [req.params.id]);
    res.status(200).json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Error deleting contact message:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// --- ADMIN SYSTEM CONFIG API ---

app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await db.get('SELECT * FROM admin_settings WHERE name = ? AND password = ?', [username, password]);
    if (admin) {
      res.status(200).json({ success: true, message: 'Admin authenticated successfully', admin });
    } else {
      res.status(401).json({ success: false, error: 'Invalid admin username or password' });
    }
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: 'Authentication engine error' });
  }
});

app.get('/api/admin/settings', async (req, res) => {
  try {
    const admin = await db.get('SELECT * FROM admin_settings LIMIT 1');
    res.status(200).json(admin);
  } catch (error) {
    console.error('Error loading settings:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

app.put('/api/admin/settings', async (req, res) => {
  try {
    const { name, phone, whatsapp, password } = req.body;
    await db.run(
      'UPDATE admin_settings SET name = ?, phone = ?, whatsapp = ?, password = ? WHERE id = (SELECT MIN(id) FROM admin_settings)',
      [name, phone, whatsapp, password]
    );
    const updated = await db.get('SELECT * FROM admin_settings WHERE id = (SELECT MIN(id) FROM admin_settings)');
    res.status(200).json({ message: 'Admin profile updated successfully', admin: updated });
  } catch (error) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({ error: 'Failed to update admin profile' });
  }
});

app.post('/api/admin/add', async (req, res) => {
  try {
    const { name, phone, whatsapp, password } = req.body;
    await db.run(
      'INSERT INTO admin_settings (name, phone, whatsapp, password) VALUES (?, ?, ?, ?)',
      [name, phone, whatsapp, password]
    );
    res.status(201).json({ message: 'Additional administrator created successfully' });
  } catch (error) {
    console.error('Error creating admin:', error);
    res.status(500).json({ error: 'Failed to create administrator' });
  }
});

app.get('/api/admin/whatsapp-status', async (req, res) => {
  try {
    const admin = await db.get('SELECT qr_code FROM admin_settings LIMIT 1');
    const isConnected = getWhatsAppStatus();
    res.status(200).json({
      isConnected,
      qrCode: isConnected ? null : (admin ? admin.qr_code : null)
    });
  } catch (error) {
    console.error('Error fetching WhatsApp status:', error);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

app.post('/api/admin/whatsapp-reconnect', async (req, res) => {
  try {
    // Clear existing auth credentials and QR code to force a clean reconnect session
    await db.run("DELETE FROM whatsapp_auth_state").catch(() => {});
    await db.run("UPDATE admin_settings SET qr_code = NULL").catch(() => {});

    connectToWhatsApp(db);
    res.status(200).json({ message: 'Reconnection sequence triggered' });
  } catch (error) {
    console.error('Error triggering WhatsApp reconnect:', error);
    res.status(500).json({ error: 'Failed to trigger reconnect' });
  }
});

app.post('/api/admin/whatsapp-disconnect', async (req, res) => {
  try {
    await disconnectWhatsApp();
    res.status(200).json({ message: 'WhatsApp bot disconnected successfully' });
  } catch (error) {
    console.error('Error disconnecting WhatsApp:', error);
    res.status(500).json({ error: 'Failed to disconnect bot' });
  }
});

app.post('/api/admin/whatsapp-test', async (req, res) => {
  try {
    const admin = await db.get('SELECT * FROM admin_settings LIMIT 1');
    const targetPhone = admin ? admin.whatsapp : '6382513075';
    
    const message = `👋 *Test Message from Madurai Best Tours and Travels* \n\nIf you are seeing this, your WhatsApp Notification Bot is successfully connected and ready to receive live booking alerts! ✅`;
      
    const success = await sendWhatsAppNotification(targetPhone, message);
    if (success) {
      res.status(200).json({ message: 'Test message sent successfully' });
    } else {
      res.status(500).json({ error: 'Failed to send test message (Bot might be disconnected)' });
    }
  } catch (error) {
    console.error('Error sending test message:', error);
    res.status(500).json({ error: 'Error sending test message' });
  }
});

app.post('/api/admin/whatsapp-custom-message', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Phone number and message are required' });
    }
    
    const success = await sendWhatsAppNotification(phone, message);
    if (success) {
      res.status(200).json({ message: 'Custom message sent successfully' });
    } else {
      res.status(500).json({ error: 'Failed to send custom message. Number might not be on WhatsApp or Bot is disconnected.' });
    }
  } catch (error) {
    console.error('Error sending custom message:', error);
    res.status(500).json({ error: 'Error sending custom message' });
  }
});


app.listen(PORT, () => {
  console.log(`SQLite Express Backend is active on port ${PORT}`);
});
