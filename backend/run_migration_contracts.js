const pool = require('./db');

async function run() {
  try {
    console.log('--- STARTING CONTRACTS MIGRATION ---');

    // 1. Alter contract table to add developer_id, uren_per_week, rol_op_project
    console.log('1. Adding columns to contract table...');
    await pool.query(`
      ALTER TABLE contract 
      ADD COLUMN IF NOT EXISTS developer_id INTEGER REFERENCES developer(developer_id),
      ADD COLUMN IF NOT EXISTS uren_per_week INTEGER DEFAULT 40,
      ADD COLUMN IF NOT EXISTS rol_op_project VARCHAR;
    `);

    // 2. Alter urenregistratie table to add contract_id
    console.log('2. Adding contract_id to urenregistratie table...');
    await pool.query(`
      ALTER TABLE urenregistratie 
      ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES contract(contract_id);
    `);

    // 3. Make sure developer 11 (Alex Rivera) has some developer projects so he has contracts
    console.log('3. Inserting developer projects for Alex Rivera (ID 11)...');
    await pool.query(`
      INSERT INTO developer_project (developer_id, project_id, start_datum, eind_datum, rol_op_project, uren_per_week)
      VALUES 
        (11, 1, '2026-01-01', NULL, 'Senior Frontend Developer', 24),
        (11, 2, '2026-05-01', NULL, 'UI Consultant', 16)
      ON CONFLICT (developer_id, project_id) DO UPDATE 
      SET uren_per_week = EXCLUDED.uren_per_week, rol_op_project = EXCLUDED.rol_op_project;
    `);

    // 4. Migrate all developer_project records to the contract table
    console.log('4. Migrating developer_project records to contract table...');
    const devProjs = await pool.query(`
      SELECT dp.*, p.klant_id, COALESCE(d.uurtarief, 85.00) as uurtarief 
      FROM developer_project dp
      JOIN project p ON dp.project_id = p.project_id
      JOIN developer d ON dp.developer_id = d.developer_id
    `);

    for (let dp of devProjs.rows) {
      // Check if this contract already exists
      const exists = await pool.query(`
        SELECT contract_id FROM contract 
        WHERE developer_id = $1 AND project_id = $2 AND startdatum = $3
      `, [dp.developer_id, dp.project_id, dp.start_datum]);

      if (exists.rows.length === 0) {
        await pool.query(`
          INSERT INTO contract (klant_id, project_id, developer_id, startdatum, einddatum, uurtarief, uren_per_week, rol_op_project, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'actief')
        `, [
          dp.klant_id,
          dp.project_id,
          dp.developer_id,
          dp.start_datum,
          dp.eind_datum,
          dp.uurtarief,
          dp.uren_per_week,
          dp.rol_op_project
        ]);
      }
    }

    // 5. Link existing urenregistratie timesheets to their contracts
    console.log('5. Linking timesheets to contract_id...');
    await pool.query(`
      UPDATE urenregistratie u
      SET contract_id = (
        SELECT c.contract_id 
        FROM contract c
        WHERE c.developer_id = u.developer_id 
          AND c.project_id = u.project_id
          AND u.datum >= c.startdatum 
          AND (c.einddatum IS NULL OR u.datum <= c.einddatum)
        LIMIT 1
      )
      WHERE u.contract_id IS NULL;
    `);

    console.log('--- CONTRACTS MIGRATION COMPLETED SUCCESSFULLY ---');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    await pool.end();
  }
}

run();
