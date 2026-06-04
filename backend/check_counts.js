const pool = require('./db');

async function check() {
  try {
    const rows = await pool.query(`
      SELECT k.naam, 
             (SELECT COUNT(*) FROM project p WHERE p.klant_id = k.klant_id AND p.status = 'Actief') AS project_count,
             (SELECT COUNT(DISTINCT c.developer_id) FROM contract c WHERE c.klant_id = k.klant_id AND c.status = 'actief') AS developer_count
      FROM klant k
      ORDER BY k.naam
    `);
    console.log('--- KLANTEN met project_count en developer_count ---');
    console.table(rows.rows);
  } catch (e) {
    console.error('Failed:', e);
  } finally {
    await pool.end();
  }
}
check();
