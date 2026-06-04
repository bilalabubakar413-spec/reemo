require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  try {
    console.log('Starting dashboard database migration...');

    // 1. developer_project updates
    console.log('1. Updating developer_project table...');
    await pool.query(`
      ALTER TABLE developer_project 
      ADD COLUMN IF NOT EXISTS uren_per_week INTEGER;
    `);

    // Migrate data from developer table
    await pool.query(`
      UPDATE developer_project dp
      SET uren_per_week = COALESCE(
        (SELECT weekcapaciteit FROM developer d WHERE d.developer_id = dp.developer_id), 40
      )
      WHERE uren_per_week IS NULL;
    `);

    // Add constraints
    await pool.query(`
      ALTER TABLE developer_project
      ALTER COLUMN uren_per_week SET NOT NULL,
      ALTER COLUMN uren_per_week SET DEFAULT 40;
    `);

    // Check constraint safely
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_uren_per_week') THEN
          ALTER TABLE developer_project ADD CONSTRAINT check_uren_per_week CHECK (uren_per_week > 0 AND uren_per_week <= 60);
        END IF;
      END $$;
    `);

    // 2. urenregistratie updates
    console.log('2. Updating urenregistratie table...');
    await pool.query(`
      ALTER TABLE urenregistratie 
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
    `);

    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_status_values') THEN
          ALTER TABLE urenregistratie ADD CONSTRAINT check_status_values CHECK (status IN ('pending', 'approved', 'rejected'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_uren_per_dag') THEN
          UPDATE urenregistratie SET aantal_uren = 8 WHERE aantal_uren > 8;
          ALTER TABLE urenregistratie ADD CONSTRAINT check_uren_per_dag CHECK (aantal_uren > 0 AND aantal_uren <= 8);
        END IF;
      END $$;
    `);

    // 3. contract constraints
    console.log('3. Updating contract table...');
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_uurtarief_positief') THEN
          ALTER TABLE contract ADD CONSTRAINT check_uurtarief_positief CHECK (uurtarief > 0);
        END IF;
      END $$;
    `);

    // 4. Create Views
    console.log('4. Creating Dashboard Views...');
    await pool.query(`
      CREATE OR REPLACE VIEW dashboard_cashflow_mtd AS
      WITH huidige_maand AS (
        SELECT DATE_TRUNC('month', NOW()) AS start_maand,
               DATE_TRUNC('month', NOW()) + INTERVAL '1 month' AS eind_maand
      ),
      verwacht AS (
        SELECT SUM(dp.uren_per_week * c.uurtarief * 4) AS bedrag
        FROM developer_project dp
        JOIN project p ON dp.project_id = p.project_id
        JOIN contract c ON c.klant_id = p.klant_id AND c.status = 'actief'
        WHERE dp.start_datum < (SELECT eind_maand FROM huidige_maand)
          AND (dp.eind_datum IS NULL OR dp.eind_datum >= (SELECT start_maand FROM huidige_maand))
      ),
      geleverd AS (
        SELECT SUM(u.aantal_uren * c.uurtarief) AS bedrag
        FROM urenregistratie u
        JOIN project p ON u.project_id = p.project_id
        JOIN contract c ON c.klant_id = p.klant_id AND c.status = 'actief'
        WHERE u.status = 'approved'
          AND u.datum >= (SELECT start_maand FROM huidige_maand)
          AND u.datum < (SELECT eind_maand FROM huidige_maand)
      ),
      gefactureerd AS (
        SELECT SUM(totaalbedrag) AS bedrag
        FROM factuur
        WHERE factuurdatum >= (SELECT start_maand FROM huidige_maand)
          AND factuurdatum < (SELECT eind_maand FROM huidige_maand)
      ),
      ontvangen AS (
        SELECT SUM(totaalbedrag) AS bedrag
        FROM factuur
        WHERE betalingsstatus IN ('betaald', 'paid')
          AND factuurdatum >= (SELECT start_maand FROM huidige_maand)
          AND factuurdatum < (SELECT eind_maand FROM huidige_maand)
      )
      SELECT 
        COALESCE((SELECT bedrag FROM verwacht), 0) AS verwacht,
        COALESCE((SELECT bedrag FROM geleverd), 0) AS geleverd,
        COALESCE((SELECT bedrag FROM gefactureerd), 0) AS gefactureerd,
        COALESCE((SELECT bedrag FROM ontvangen), 0) AS ontvangen;
    `);

    await pool.query(`
      CREATE OR REPLACE VIEW dashboard_per_klant_mtd AS
      SELECT 
        k.klant_id,
        k.naam AS klant,
        COALESCE(SUM(DISTINCT dp.uren_per_week * c.uurtarief * 4), 0) AS verwacht,
        COALESCE(SUM(CASE WHEN u.status = 'approved' THEN u.aantal_uren * c.uurtarief END), 0) AS geleverd,
        COALESCE((SELECT SUM(totaalbedrag) FROM factuur f 
                  WHERE f.klant_id = k.klant_id 
                    AND DATE_TRUNC('month', f.factuurdatum) = DATE_TRUNC('month', NOW())), 0) AS gefactureerd
      FROM klant k
      LEFT JOIN project p ON p.klant_id = k.klant_id
      LEFT JOIN contract c ON c.klant_id = k.klant_id AND c.status = 'actief'
      LEFT JOIN developer_project dp ON dp.project_id = p.project_id
      LEFT JOIN urenregistratie u ON u.project_id = p.project_id 
        AND DATE_TRUNC('month', u.datum) = DATE_TRUNC('month', NOW())
      GROUP BY k.klant_id, k.naam
      ORDER BY verwacht DESC;
    `);

    console.log('Migration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    pool.end();
  }
}

runMigration();
