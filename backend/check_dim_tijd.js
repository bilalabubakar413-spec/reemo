const pool = require('./db');

async function check() {
  try {
    const q = await pool.query("SELECT datum_id, datum FROM dim_tijd LIMIT 5");
    console.log(q.rows);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

check();
