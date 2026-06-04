const pool = require('./db');
async function check() {
  try {
    const devs = await pool.query('SELECT * FROM developer');
    console.log('--- DEVELOPERS ---');
    console.table(devs.rows);

    const contracts = await pool.query(`
      SELECT c.*, k.naam as klant_naam, p.projectnaam 
      FROM contract c 
      JOIN klant k ON c.klant_id = k.klant_id 
      LEFT JOIN project p ON c.project_id = p.project_id
    `);
    console.log('--- CONTRACTS ---');
    console.table(contracts.rows);

    const devProj = await pool.query(`
      SELECT dp.*, d.naam as dev_naam, p.projectnaam 
      FROM developer_project dp 
      JOIN developer d ON dp.developer_id = d.developer_id 
      JOIN project p ON dp.project_id = p.project_id
    `);
    console.log('--- DEVELOPER PROJECTS ---');
    console.table(devProj.rows);

  } catch (e) {
    console.error('Failed:', e);
  } finally {
    await pool.end();
  }
}
check();
