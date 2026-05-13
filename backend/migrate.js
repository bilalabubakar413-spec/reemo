const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('FATAL: DATABASE_URL ontbreekt!');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


async function run() {
  try {
    console.log('Running SQL...');
    await pool.query(`
      ALTER TABLE developer 
      ADD COLUMN IF NOT EXISTS skills TEXT,
      ADD COLUMN IF NOT EXISTS beschikbaarheid VARCHAR DEFAULT 'beschikbaar';
    `);
    console.log('SQL Success');
  } catch (e) {
    console.error('SQL Error:', e.message);
  } finally {
    await pool.end();
  }
}

run();
