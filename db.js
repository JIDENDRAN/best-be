import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'database.db');

export async function initDatabase() {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await db.run('PRAGMA foreign_keys = ON');

  // Create tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      password TEXT NOT NULL,
      qr_code TEXT
    );

    CREATE TABLE IF NOT EXISTS whatsapp_auth_state (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      fromLocation TEXT NOT NULL,
      toLocation TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      vehicle TEXT,
      packageType TEXT,
      status TEXT DEFAULT 'Pending',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      seats TEXT NOT NULL,
      ac TEXT NOT NULL,
      price TEXT NOT NULL,
      desc TEXT NOT NULL,
      image TEXT NOT NULL,
      bgImage TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      duration TEXT NOT NULL,
      places TEXT NOT NULL,
      price TEXT NOT NULL,
      image TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration for older databases
  try {
    await db.run('ALTER TABLE admin_settings ADD COLUMN qr_code TEXT');
  } catch (err) {
    // Column already exists
  }

  // Seed default admin settings
  await db.run("UPDATE admin_settings SET name = 'admin' WHERE name = 'Superadmin'");
  await db.run("UPDATE admin_settings SET phone = '6382513075', whatsapp = '6382513075' WHERE id = (SELECT MIN(id) FROM admin_settings)");
  const adminCount = await db.get('SELECT COUNT(*) as count FROM admin_settings');
  if (adminCount.count === 0) {
    await db.run(
      'INSERT INTO admin_settings (name, phone, whatsapp, password) VALUES (?, ?, ?, ?)',
      ['admin', '6382513075', '6382513075', 'admin123']
    );
    console.log('Seeded default admin settings.');
  }

  // Seed default premium cars matching exact assets
  // We clear the cars table to ensure the database always synchronizes with these exact 6 vehicles and rates.
  await db.run('DELETE FROM cars');
  const defaultCars = [
    {
      name: 'Innova Crysta',
      seats: '7 Seater',
      ac: 'AC',
      price: '₹22/km',
      desc: '[Outstation Plan]\nRate: ₹22/km\nMin Distance: Above 300 km\nDriver Charge: ₹500/day\n\n[Day Rental Plan]\nBase Rent: ₹2700/day\nPer km Charge: ₹17/km',
      image: 'innova_crysta-removebg-preview.png',
      bgImage: 'kodaikanal_bg.png'
    },
    {
      name: 'Swift Dzire',
      seats: '4 Seater',
      ac: 'AC',
      price: '₹14/km',
      desc: '[Outstation Plan]\nRate: ₹14/km\nMin Distance: Above 250 km\nDriver Charge: ₹300/day\n\n[Day Rental Plan]\nBase Rent: ₹1600\nPer km Charge: ₹11/km\nDriver Charge: ₹300',
      image: 'sedan_cab-removebg-preview.png',
      bgImage: 'kanyakumari_bg.png'
    },
    {
      name: 'Maruti Ciaz Premium Sedan',
      seats: '4 Seater',
      ac: 'AC',
      price: '₹15/km',
      desc: '[Outstation Plan]\nRate: ₹15/km\nMin Distance: Above 250 km\nDriver Charge: ₹300/day\n\n[Day Rental Plan]\nBase Rent: ₹1700/day\nPer km Charge: ₹11/km',
      image: 'sedan_cab-removebg-preview.png',
      bgImage: 'munnar_bg.png'
    },
    {
      name: 'Prime SUV',
      seats: '7 Seater',
      ac: 'AC',
      price: '₹19/km',
      desc: '[Outstation Plan]\nRate: ₹19/km\nMin Distance: Above 300 km\nDriver Charge: ₹400/day\n\n[Day Rental Plan]\nBase Rent: ₹2300/day\nPer km Charge: ₹13/km\nDriver Charge: ₹400/day',
      image: 'suv-removebg-preview.png',
      bgImage: 'thirumalai_mahal_bg.png'
    },
    {
      name: 'Tempo Traveller (12 Seater)',
      seats: '12 Seater',
      ac: 'AC',
      price: '₹25/km',
      desc: '[Outstation Plan]\nRate: ₹25/km\nMin Distance: Above 350 km\n\n[Day Rental Plan]\nBase Rent: ₹2800/day\nPer km Charge: ₹18/km',
      image: 'tempo_traveller-removebg-preview.png',
      bgImage: 'rameswaram_bg.png'
    },
    {
      name: 'Tempo Traveller (18 Seater)',
      seats: '18 Seater',
      ac: 'AC',
      price: '₹30/km',
      desc: '[Outstation Plan]\nRate: ₹30/km\nMin Distance: Above 300 km\n\n[Day Rental Plan]\nBase Rent: ₹3900/day\nPer km Charge: ₹22/km',
      image: 'tempo_traveller-removebg-preview.png',
      bgImage: 'ooty_bg.png'
    }
  ];

  for (const car of defaultCars) {
    await db.run(
      'INSERT INTO cars (name, seats, ac, price, desc, image, bgImage) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [car.name, car.seats, car.ac, car.price, car.desc, car.image, car.bgImage]
    );
  }
  console.log('Seeded default vehicles.');

  // Seed default tour packages
  const packagesCount = await db.get('SELECT COUNT(*) as count FROM packages');
  if (packagesCount.count === 0) {
    const defaultPackages = [
      {
        name: 'Madurai Local Tour',
        duration: '8 Hours / 80 KM',
        places: 'Visit the architectural marvel of Meenakshi Amman Temple, historical Thirumalai Nayakkar Mahal Palace, and the scenic Gandhi Memorial Museum.',
        price: '₹2600',
        image: 'meenakshi_bg.png'
      },
      {
        name: 'Rameswaram Tour',
        duration: '12 Hours / 420 KM',
        places: 'Pilgrimage to Ramanathaswamy Temple, dynamic sea drive to Dhanushkodi beach, and cross the iconic Pamban Bridge.',
        price: '₹6000',
        image: 'rameswaram_bg.png'
      },
      {
        name: 'Kodaikanal Tour',
        duration: '12 Hours / 300 KM',
        places: 'Relax by Kodaikanal Lake, walk through Coaker\'s scenic path, and capture the colossal Pillar Rocks hills in the mist.',
        price: '₹5000',
        image: 'kodaikanal_bg.png'
      },
      {
        name: 'Ooty Tour',
        duration: '2 Days / 600 KM',
        places: 'Tour beautiful Ooty botanical flower gardens, cruise on Ooty Lake, and climb Doddabetta Peak for massive panoramic tea estate views.',
        price: '₹11000',
        image: 'ooty_bg.png'
      }
    ];

    for (const pkg of defaultPackages) {
      await db.run(
        'INSERT INTO packages (name, duration, places, price, image) VALUES (?, ?, ?, ?, ?)',
        [pkg.name, pkg.duration, pkg.places, pkg.price, pkg.image]
      );
    }
    console.log('Seeded default tour packages.');
  }

  return db;
}
