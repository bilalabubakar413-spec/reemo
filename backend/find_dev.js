const pool = require('./db');
async function check() {
  try {
    const res = await pool.query("SELECT * FROM developer WHERE email = 'developer@reemo.io' OR email = 'alex@reemo.io' OR naam ILIKE '%alex%' OR naam ILIKE '%rivera%'");
    console.table(res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
check();
