const pool = require('./db');

async function check() {
  try {
    const res = await pool.query(`
      SELECT trigger_name, event_manipulation, action_statement 
      FROM information_schema.triggers 
      WHERE event_object_table = 'urenregistratie';
    `);
    console.log('Triggers:', res.rows);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

check();
