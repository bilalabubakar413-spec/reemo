const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:fOZL7my87SfSXmM3@db.ekldjmogkgucxdbftgmb.supabase.co:5432/postgres',
  ssl: { rejectUnauthorized: false }   // Supabase requires SSL
});


pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
});

module.exports = pool;
