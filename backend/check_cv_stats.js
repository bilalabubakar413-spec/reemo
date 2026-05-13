const pool = require('./db');
async function check() {
  try {
    const res = await pool.query(`
      SELECT COUNT(*) as totaal,
             COUNT(cv_url) as met_cv,
             COUNT(*) - COUNT(cv_url) as zonder_cv
      FROM developer;
    `);
    console.table(res.rows);
  } catch (e) {
    console.error('Query failed:', e.message);
  } finally {
    await pool.end();
  }
}
check();
