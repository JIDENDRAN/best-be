import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');

const pool = new Pool({
  connectionString,
  ssl: isLocalhost ? false : { rejectUnauthorized: false }
});

// Test connection
pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

function convertQuery(sql, params = []) {
  let index = 1;
  const formattedSql = sql.replace(/\?/g, () => `$${index++}`);
  return {
    formattedSql,
    pgParams: params
  };
}

export const db = {
  query: (text, params) => pool.query(text, params),
  
  get: async (text, params) => {
    const { formattedSql, pgParams } = convertQuery(text, params);
    const res = await pool.query(formattedSql, pgParams);
    return res.rows[0] || null;
  },
  
  all: async (text, params) => {
    const { formattedSql, pgParams } = convertQuery(text, params);
    const res = await pool.query(formattedSql, pgParams);
    return res.rows;
  },
  
  run: async (text, params) => {
    const { formattedSql, pgParams } = convertQuery(text, params);
    let sqlToRun = formattedSql;
    let isInsert = sqlToRun.trim().toUpperCase().startsWith('INSERT');
    if (isInsert && !sqlToRun.toUpperCase().includes('RETURNING')) {
      sqlToRun += ' RETURNING id';
    }
    try {
      const res = await pool.query(sqlToRun, pgParams);
      let lastID = null;
      if (isInsert && res.rows[0]) {
        lastID = res.rows[0].id || null;
      }
      return {
        lastID,
        changes: res.rowCount
      };
    } catch (err) {
      console.error('db.run error:', err.message, 'SQL:', sqlToRun);
      throw err;
    }
  },
  
  exec: async (text) => {
    return pool.query(text);
  }
};

export async function initDatabase() {
  // Verify the connection works
  await pool.query('SELECT NOW()');

  // Create tables using Postgres-compliant statements
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      "fromLocation" TEXT NOT NULL,
      "toLocation" TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT,
      vehicle TEXT,
      "packageType" TEXT,
      status TEXT DEFAULT 'Pending',
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cars (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      seats TEXT NOT NULL,
      ac TEXT NOT NULL,
      price TEXT NOT NULL,
      "desc" TEXT NOT NULL,
      image TEXT NOT NULL,
      "bgImage" TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS packages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      duration TEXT NOT NULL,
      places TEXT NOT NULL,
      price TEXT NOT NULL,
      image TEXT NOT NULL,
      rating TEXT DEFAULT '5.0',
      "reviewCount" TEXT DEFAULT '100+',
      location TEXT
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      message TEXT NOT NULL,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default admin settings
  await pool.query("UPDATE admin_settings SET name = 'admin' WHERE name = 'Superadmin'");
  await pool.query("UPDATE admin_settings SET phone = '6382513075', whatsapp = '6382513075' WHERE id = (SELECT MIN(id) FROM admin_settings)");
  
  const adminCountRes = await pool.query('SELECT COUNT(*) as count FROM admin_settings');
  const adminCount = parseInt(adminCountRes.rows[0].count, 10);
  if (adminCount === 0) {
    await pool.query(
      'INSERT INTO admin_settings (name, phone, whatsapp, password) VALUES ($1, $2, $3, $4)',
      ['admin', '6382513075', '6382513075', 'admin123']
    );
    console.log('Seeded default admin settings.');
  }

  // Seed default premium cars matching exact assets
  const carsCountRes = await pool.query('SELECT COUNT(*) as count FROM cars');
  const carsCount = parseInt(carsCountRes.rows[0].count, 10);
  if (carsCount === 0) {
    const defaultCars = [
      {
        name: 'Innova Crysta',
        seats: '7 Seats',
        ac: 'AC',
        price: '₹22/km',
        desc: '[Outstation Plan]\nRate: ₹22/km\nMin Distance: Above 300 kms\nDriver Charge: Rs. 400 / day\n\n[Day Rental Plan]\nBase Rent: Rs. 2700\nPer km Charge: Rs. 17/km\nDriver Charge: Rs. 400 / day',
        image: 'car 1.jpeg',
        bgImage: 'kodaikanal_bg.png'
      },
      {
        name: 'Toyota Innova',
        seats: '7 Seats',
        ac: 'AC',
        price: '₹19/km',
        desc: '[Outstation Plan]\nRate: ₹19/km\nMin Distance: Above 300 kms\nDriver Charge: Rs. 300 / day\n\n[Day Rental Plan]\nBase Rent: Rs. 2300\nPer km Charge: Rs. 13/km\nDriver Charge: Rs. 300 / day',
        image: 'car 2.jpeg',
        bgImage: 'thirumalai_mahal_bg.png'
      },
      {
        name: 'Swift Dzire',
        seats: '4 Seats',
        ac: 'AC',
        price: '₹14/km',
        desc: '[Outstation Plan]\nRate: ₹14/km\nMin Distance: Above 250 kms\nDriver Charge: Rs. 300 / day\n\n[Day Rental Plan]\nBase Rent: Rs. 1600\nPer km Charge: Rs. 11/km\nDriver Charge: Rs. 300 / day',
        image: 'car 3.png',
        bgImage: 'kanyakumari_bg.png'
      },
      {
        name: 'Tempo Traveller (12 Seater)',
        seats: '12 Seats',
        ac: 'AC',
        price: '₹25/km',
        desc: '[Outstation Plan]\nRate: ₹25/km\nMin Distance: Above 350 kms\nDriver Charge: Rs. 300 / day\n\n[Day Rental Plan]\nBase Rent: Rs. 2800\nPer km Charge: Rs. 18/km\nDriver Charge: Rs. 300 / day',
        image: 'car 4.jpg',
        bgImage: 'rameswaram_bg.png'
      },
      {
        name: 'Tempo Traveller (18 Seater)',
        seats: '18 Seats',
        ac: 'AC',
        price: '₹30/km',
        desc: '[Outstation Plan]\nRate: ₹30/km\nMin Distance: Above 300 kms\nDriver Charge: Rs. 300 / day\n\n[Day Rental Plan]\nBase Rent: Rs. 3900\nPer km Charge: Rs. 22/km\nDriver Charge: Rs. 300 / day',
        image: 'car 5.jpeg',
        bgImage: 'ooty_bg.png'
      },
      {
        name: 'Urbania',
        seats: '12+1 / 14+1 Seats',
        ac: 'AC',
        price: '₹27/km',
        desc: '[Outstation Plan]\nRate: ₹27/km\nMin Distance: Above 250 kms\nDriver Charge: Rs. 300 / day\n\n[Day Rental Plan]\nBase Rent: Rs. 7500\nPer km Charge: Rs. 27/km\nDriver Charge: Rs. 300 / day',
        image: 'car 6.jpeg',
        bgImage: 'munnar_bg.png'
      }
    ];

    for (const car of defaultCars) {
      await pool.query(
        'INSERT INTO cars (name, seats, ac, price, "desc", image, "bgImage") VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [car.name, car.seats, car.ac, car.price, car.desc, car.image, car.bgImage]
      );
    }
    console.log('Seeded default vehicles.');
  }

  // Seed default tour packages
  // Ensure we add the new columns if they don't exist
  try {
    await pool.query("ALTER TABLE packages ADD COLUMN IF NOT EXISTS rating TEXT DEFAULT '5.0'");
    await pool.query("ALTER TABLE packages ADD COLUMN IF NOT EXISTS \"reviewCount\" TEXT DEFAULT '100+'");
    await pool.query("ALTER TABLE packages ADD COLUMN IF NOT EXISTS location TEXT");
  } catch(e) {}

  const packagesCountRes = await pool.query('SELECT COUNT(*) as count FROM packages');
  const packagesCount = parseInt(packagesCountRes.rows[0].count, 10);
  if (packagesCount === 0) {
    const defaultPackages = [
      {
        name: 'Madurai Local Tour',
        duration: '8 Hours / 80 KM',
        places: 'Visit the architectural marvel of Meenakshi Amman Temple, historical Thirumalai Nayakkar...',
        price: '₹2600',
        rating: '5.0',
        reviewCount: '250+',
        location: 'Madurai, Tamil Nadu',
        image: 'meenakshi_bg.png',
      },
      {
        name: 'Rameswaram Tour',
        duration: '2 Days / 120 KM',
        places: 'Pilgrimage to Ramanathaswamy Temple, dynamic sea drive to Dhanushkodi beach, and...',
        price: '₹6000',
        rating: '5.0',
        reviewCount: '200+',
        location: 'Rameswaram, Tamil Nadu',
        image: 'rameswaram_bg.png',
      },
      {
        name: 'Kodaikanal Tour',
        duration: '2 Days / 120 KM',
        places: 'Relax by Kodaikanal Lake, walk through Coaker\'s walk, and capture the colossal Pillar Rocks.',
        price: '₹5000',
        rating: '5.0',
        reviewCount: '180+',
        location: 'Kodaikanal, Tamil Nadu',
        image: 'kodaikanal_bg.png',
      },
      {
        name: 'Ooty & Coonoor Tour',
        duration: '3 Days / 200 KM',
        places: 'Experience the Nilgiris with scenic toy train rides, tea gardens, lakes, and breathtaking views.',
        price: '₹6500',
        rating: '4.9',
        reviewCount: '150+',
        location: 'Ooty, Tamil Nadu',
        image: 'ooty_bg.png',
      },
      {
        name: 'Kanyakumari Tour',
        duration: '1 Day / 240 KM',
        places: 'Vivekananda Rock Memorial, Thiruvalluvar Statue, and the tri-sea confluence at sunset.',
        price: '₹5500',
        rating: '4.9',
        reviewCount: '300+',
        location: 'Kanyakumari, Tamil Nadu',
        image: 'kanyakumari_bg.png',
      },
      {
        name: 'Munnar Tour',
        duration: '2 Days / 280 KM',
        places: 'Tea gardens, Eravikulam National Park, Mattupetty Dam, and stunning hill views.',
        price: '₹7999',
        rating: '4.8',
        reviewCount: '120+',
        location: 'Munnar, Kerala',
        image: 'munnar_bg.png',
      }
    ];

    for (const pkg of defaultPackages) {
      await pool.query(
        'INSERT INTO packages (name, duration, places, price, image, rating, "reviewCount", location) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [pkg.name, pkg.duration, pkg.places, pkg.price, pkg.image, pkg.rating, pkg.reviewCount, pkg.location]
      );
    }
    console.log('Seeded default tour packages.');
  }

  return db;
}
