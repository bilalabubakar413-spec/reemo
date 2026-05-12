const pool = require('./db');

async function testTrigger() {
  try {
    const q1 = await pool.query(`
      SELECT 'zondag'::text[]
    `);
    console.log(q1.rows);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

testTrigger();
