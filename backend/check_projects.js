const pool = require('./db');
async function check() {
  try {
    const clients = await pool.query('SELECT klant_id, naam FROM klant');
    console.log('--- CLIENTS ---');
    console.table(clients.rows);

    const projs = await pool.query('SELECT project_id, klant_id, projectnaam FROM project');
    console.log('--- PROJECTS ---');
    console.table(projs.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
check();
