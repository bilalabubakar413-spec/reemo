const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:fOZL7my87SfSXmM3@db.ekldjmogkgucxdbftgmb.supabase.co:5432/postgres',
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
