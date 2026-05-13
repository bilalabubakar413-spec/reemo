const pool = require('./db');
async function check() {
  try {
    const res = await pool.query(`
      SELECT 'klant' as tabel, COUNT(*) FROM klant
      UNION ALL
      SELECT 'developer', COUNT(*) FROM developer  
      UNION ALL
      SELECT 'urenregistratie', COUNT(*) FROM urenregistratie;
    `);
    console.table(res.rows);
  } catch (e) {
    console.error('Query failed:', e.message);
  } finally {
    await pool.end();
  }
}
check();
