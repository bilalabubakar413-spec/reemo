const pool = require('./db');

async function check() {
  try {
    const q = await pool.query("SELECT column_default FROM information_schema.columns WHERE table_name = 'dim_tijd' AND column_name = 'datum_id'");
    console.log(q.rows);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

check();
