const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    console.log('--- STARTING COMPLETE DATABASE ADJUSTMENTS FOR CONTRACTS ---');

    // 1. Add contract_id to timesheet_feiten
    console.log('1. Adding contract_id to timesheet_feiten...');
    await pool.query(`
      ALTER TABLE timesheet_feiten 
      ADD COLUMN IF NOT EXISTS contract_id INTEGER REFERENCES contract(contract_id);
    `);

    // 2. Create calculate_timesheet_amount trigger function on urenregistratie
    console.log('2. Creating calculate_timesheet_amount trigger...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION calculate_timesheet_amount()
      RETURNS TRIGGER AS $$
      DECLARE
        v_uurtarief NUMERIC;
      BEGIN
        -- A. Resolve contract_id if NULL
        IF NEW.contract_id IS NULL THEN
          SELECT contract_id INTO NEW.contract_id
          FROM contract
          WHERE developer_id = NEW.developer_id
            AND project_id = NEW.project_id
            AND NEW.datum >= startdatum
            AND (einddatum IS NULL OR NEW.datum <= einddatum)
          LIMIT 1;
        END IF;

        -- B. If contract_id is set, get uurtarief from contract
        IF NEW.contract_id IS NOT NULL THEN
          SELECT uurtarief INTO v_uurtarief
          FROM contract
          WHERE contract_id = NEW.contract_id;
        END IF;

        -- C. Fallback to developer's default rate if no contract rate is found
        IF v_uurtarief IS NULL THEN
          SELECT uurtarief INTO v_uurtarief
          FROM developer
          WHERE developer_id = NEW.developer_id;
        END IF;

        -- D. Default fallback rate
        IF v_uurtarief IS NULL THEN
          v_uurtarief := 85.00;
        END IF;

        -- E. Calculate bedrag if NULL or 0
        IF NEW.bedrag IS NULL OR NEW.bedrag = 0 THEN
          NEW.bedrag := NEW.aantal_uren * v_uurtarief;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create the trigger on urenregistratie BEFORE INSERT OR UPDATE
    await pool.query(`
      DROP TRIGGER IF EXISTS trg_calculate_timesheet_amount ON urenregistratie;
      CREATE TRIGGER trg_calculate_timesheet_amount
      BEFORE INSERT OR UPDATE ON urenregistratie
      FOR EACH ROW
      EXECUTE FUNCTION calculate_timesheet_amount();
    `);

    // 3. Create sync_contract_to_developer_project trigger function on contract
    console.log('3. Creating contract sync trigger to developer_project...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION sync_contract_to_developer_project()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          -- Try to find another active contract for the same developer and project
          -- to keep the developer_project table updated, otherwise delete it.
          DECLARE
            v_alt_contract RECORD;
          BEGIN
            SELECT * INTO v_alt_contract
            FROM contract
            WHERE developer_id = OLD.developer_id AND project_id = OLD.project_id AND status = 'actief'
            ORDER BY startdatum DESC
            LIMIT 1;

            IF v_alt_contract.contract_id IS NOT NULL THEN
              UPDATE developer_project
              SET start_datum = v_alt_contract.startdatum,
                  eind_datum = v_alt_contract.einddatum,
                  rol_op_project = v_alt_contract.rol_op_project,
                  uren_per_week = v_alt_contract.uren_per_week
              WHERE developer_id = OLD.developer_id AND project_id = OLD.project_id;
            ELSE
              DELETE FROM developer_project
              WHERE developer_id = OLD.developer_id AND project_id = OLD.project_id;
            END IF;
          END;
        ELSE
          -- INSERT or UPDATE
          -- Only sync active contracts to developer_project
          IF NEW.status = 'actief' THEN
            INSERT INTO developer_project (developer_id, project_id, start_datum, eind_datum, rol_op_project, uren_per_week)
            VALUES (NEW.developer_id, NEW.project_id, NEW.startdatum, NEW.einddatum, NEW.rol_op_project, NEW.uren_per_week)
            ON CONFLICT (developer_id, project_id) DO UPDATE SET
              start_datum = EXCLUDED.start_datum,
              eind_datum = EXCLUDED.eind_datum,
              rol_op_project = EXCLUDED.rol_op_project,
              uren_per_week = EXCLUDED.uren_per_week;
          ELSE
            -- If contract is no longer active, check if there's any other active contract
            DECLARE
              v_alt_contract RECORD;
            BEGIN
              SELECT * INTO v_alt_contract
              FROM contract
              WHERE developer_id = NEW.developer_id AND project_id = NEW.project_id AND status = 'actief'
              ORDER BY startdatum DESC
              LIMIT 1;

              IF v_alt_contract.contract_id IS NOT NULL THEN
                UPDATE developer_project
                SET start_datum = v_alt_contract.startdatum,
                    eind_datum = v_alt_contract.einddatum,
                    rol_op_project = v_alt_contract.rol_op_project,
                    uren_per_week = v_alt_contract.uren_per_week
                WHERE developer_id = NEW.developer_id AND project_id = NEW.project_id;
              ELSE
                DELETE FROM developer_project
                WHERE developer_id = NEW.developer_id AND project_id = NEW.project_id;
              END IF;
            END;
          END IF;
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create the trigger on contract AFTER INSERT OR UPDATE OR DELETE
    await pool.query(`
      DROP TRIGGER IF EXISTS trg_sync_contract_to_developer_project ON contract;
      CREATE TRIGGER trg_sync_contract_to_developer_project
      AFTER INSERT OR UPDATE OR DELETE ON contract
      FOR EACH ROW
      EXECUTE FUNCTION sync_contract_to_developer_project();
    `);

    // 4. Update sync_timesheet_to_olap trigger function to include contract_id and update dims correctly
    console.log('4. Updating sync_timesheet_to_olap trigger function...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION sync_timesheet_to_olap()
      RETURNS TRIGGER AS $$
      DECLARE
        v_datum_id INTEGER;
        v_klant_id INTEGER;
        v_maand_namen TEXT[] := ARRAY['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
        v_dag_namen TEXT[] := ARRAY['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
      BEGIN
        -- Als we updaten of inserten naar 'approved'
        IF NEW.status = 'approved' THEN
          
          -- A. DIM_TIJD: Zoek of maak de datum
          SELECT datum_id INTO v_datum_id FROM dim_tijd WHERE datum = NEW.datum;
          IF v_datum_id IS NULL THEN
            INSERT INTO dim_tijd (
              datum, dag, dag_naam, week, maand, maand_naam, kwartaal, jaar
            ) VALUES (
              NEW.datum,
              EXTRACT(DAY FROM NEW.datum)::INTEGER,
              v_dag_namen[EXTRACT(ISODOW FROM NEW.datum)::INTEGER],
              EXTRACT(WEEK FROM NEW.datum)::INTEGER,
              EXTRACT(MONTH FROM NEW.datum)::INTEGER,
              v_maand_namen[EXTRACT(MONTH FROM NEW.datum)::INTEGER],
              EXTRACT(QUARTER FROM NEW.datum)::INTEGER,
              EXTRACT(YEAR FROM NEW.datum)::INTEGER
            ) RETURNING datum_id INTO v_datum_id;
          END IF;

          -- B. KLANT_ID ophalen via het project
          SELECT klant_id INTO v_klant_id FROM project WHERE project_id = NEW.project_id;

          -- C. DIM_DEVELOPER: zorg dat de developer in de dimensie-tabel staat
          INSERT INTO dim_developer (developer_id, naam, rol, uurtarief, weekcapaciteit, email, status)
          SELECT developer_id, naam, rol, uurtarief, weekcapaciteit, email, 'actief'
          FROM developer WHERE developer_id = NEW.developer_id
          ON CONFLICT (developer_id) DO UPDATE SET
            naam = EXCLUDED.naam,
            rol = EXCLUDED.rol,
            uurtarief = EXCLUDED.uurtarief,
            weekcapaciteit = EXCLUDED.weekcapaciteit,
            email = EXCLUDED.email;

          -- D. DIM_KLANT: zorg dat de klant in de dimensie-tabel staat
          INSERT INTO dim_klant (klant_id, naam, sector, contactpersoon, email, land)
          SELECT klant_id, naam, sector, contactpersoon, email, NULL
          FROM klant WHERE klant_id = v_klant_id
          ON CONFLICT (klant_id) DO UPDATE SET
            naam = EXCLUDED.naam,
            sector = EXCLUDED.sector,
            contactpersoon = EXCLUDED.contactpersoon,
            email = EXCLUDED.email;

          -- E. DIM_PROJECT: zorg dat het project in de dimensie-tabel staat
          INSERT INTO dim_project (project_id, naam, type, contract, klant_id, start_datum, eind_datum, status)
          SELECT project_id, projectnaam, type, NULL, klant_id, startdatum, einddatum, status
          FROM project WHERE project_id = NEW.project_id
          ON CONFLICT (project_id) DO UPDATE SET
            naam = EXCLUDED.naam,
            type = EXCLUDED.type,
            start_datum = EXCLUDED.start_datum,
            eind_datum = EXCLUDED.eind_datum,
            status = EXCLUDED.status;

          -- F. Invoegen of updaten in de feitentabel
          INSERT INTO timesheet_feiten (
            bron_uren_id, developer_id, klant_id, datum_id, project_id, contract_id,
            aantal_uren, bedrag, status, omschrijving, ingevoerd_op
          ) VALUES (
            NEW.uren_id, NEW.developer_id, v_klant_id, v_datum_id, NEW.project_id, NEW.contract_id,
            NEW.aantal_uren, NEW.bedrag, NEW.status, NEW.omschrijving, NEW.ingevoerd_op
          )
          ON CONFLICT (bron_uren_id) DO UPDATE SET
            developer_id = EXCLUDED.developer_id,
            klant_id = EXCLUDED.klant_id,
            datum_id = EXCLUDED.datum_id,
            project_id = EXCLUDED.project_id,
            contract_id = EXCLUDED.contract_id,
            aantal_uren = EXCLUDED.aantal_uren,
            bedrag = EXCLUDED.bedrag,
            status = EXCLUDED.status,
            omschrijving = EXCLUDED.omschrijving,
            ingevoerd_op = EXCLUDED.ingevoerd_op;

        -- G. Als een timesheet wordt afgekeurd nadat hij goedgekeurd was
        ELSIF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status != 'approved' THEN
          DELETE FROM timesheet_feiten WHERE bron_uren_id = NEW.uren_id;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // 5. Recreate VIEWS using contract instead of developer_project
    console.log('5. Drop existing views for clean creation...');
    await pool.query(`
      DROP VIEW IF EXISTS dashboard_cashflow_mtd CASCADE;
      DROP VIEW IF EXISTS dashboard_per_klant_mtd CASCADE;
      DROP VIEW IF EXISTS v_developers_per_klant CASCADE;
      DROP VIEW IF EXISTS v_developer_beschikbaarheid CASCADE;
    `);

    console.log('5. Recreating database views...');
    
    // View A: dashboard_cashflow_mtd
    await pool.query(`
      CREATE OR REPLACE VIEW dashboard_cashflow_mtd AS
      WITH huidige_maand AS (
        SELECT DATE_TRUNC('month', NOW()) AS start_maand,
               DATE_TRUNC('month', NOW()) + INTERVAL '1 month' AS eind_maand
      ),
      verwacht AS (
        SELECT SUM(c.uren_per_week * c.uurtarief * 4) AS bedrag
        FROM contract c
        WHERE c.status = 'actief'
          AND c.startdatum < (SELECT eind_maand FROM huidige_maand)
          AND (c.einddatum IS NULL OR c.einddatum >= (SELECT start_maand FROM huidige_maand))
      ),
      geleverd AS (
        SELECT SUM(u.aantal_uren * COALESCE(c.uurtarief, d.uurtarief, 85.00)) AS bedrag
        FROM urenregistratie u
        LEFT JOIN contract c ON u.contract_id = c.contract_id
        LEFT JOIN developer d ON u.developer_id = d.developer_id
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

    // View B: dashboard_per_klant_mtd
    await pool.query(`
      CREATE OR REPLACE VIEW dashboard_per_klant_mtd AS
      SELECT 
        k.klant_id,
        k.naam AS klant,
        COALESCE((
          SELECT SUM(c.uren_per_week * c.uurtarief * 4)
          FROM contract c
          WHERE c.klant_id = k.klant_id 
            AND c.status = 'actief'
            AND c.startdatum < DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
            AND (c.einddatum IS NULL OR c.einddatum >= DATE_TRUNC('month', NOW()))
        ), 0) AS verwacht,
        COALESCE((
          SELECT SUM(u.aantal_uren * COALESCE(c.uurtarief, d.uurtarief, 85.00))
          FROM urenregistratie u
          JOIN project p ON u.project_id = p.project_id
          LEFT JOIN contract c ON u.contract_id = c.contract_id
          LEFT JOIN developer d ON u.developer_id = d.developer_id
          WHERE p.klant_id = k.klant_id
            AND u.status = 'approved'
            AND u.datum >= DATE_TRUNC('month', NOW())
            AND u.datum < DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
        ), 0) AS geleverd,
        COALESCE((
          SELECT SUM(totaalbedrag) 
          FROM factuur f 
          WHERE f.klant_id = k.klant_id 
            AND f.factuurdatum >= DATE_TRUNC('month', NOW())
            AND f.factuurdatum < DATE_TRUNC('month', NOW()) + INTERVAL '1 month'
        ), 0) AS gefactureerd
      FROM klant k
      ORDER BY verwacht DESC;
    `);

    // View C: v_developers_per_klant
    await pool.query(`
      CREATE OR REPLACE VIEW v_developers_per_klant AS
      SELECT k.naam AS klant_naam,
          k.sector,
          d.naam AS developer_naam,
          d.rol,
          COALESCE(c.uurtarief, d.uurtarief) AS uurtarief,
          c.rol_op_project,
          c.startdatum AS start_datum,
          c.einddatum AS eind_datum,
          p.projectnaam
      FROM contract c
      JOIN developer d ON c.developer_id = d.developer_id
      JOIN project p ON c.project_id = p.project_id
      JOIN klant k ON p.klant_id = k.klant_id
      ORDER BY k.naam, d.naam;
    `);

    // View D: v_developer_beschikbaarheid
    await pool.query(`
      CREATE OR REPLACE VIEW v_developer_beschikbaarheid AS
      SELECT d.developer_id,
          d.naam,
          d.rol,
          d.uurtarief,
          d.weekcapaciteit,
          COUNT(DISTINCT c.project_id) AS actieve_projecten,
          COALESCE(SUM(u.aantal_uren) FILTER (WHERE u.datum >= CURRENT_DATE - 7), 0) AS uren_deze_week
      FROM developer d
      LEFT JOIN contract c ON d.developer_id = c.developer_id AND c.status = 'actief' AND (c.einddatum IS NULL OR c.einddatum >= CURRENT_DATE)
      LEFT JOIN urenregistratie u ON d.developer_id = u.developer_id
      GROUP BY d.developer_id, d.naam, d.rol, d.uurtarief, d.weekcapaciteit
      ORDER BY d.naam;
    `);

    // 6. Recalculate historical data for consistency
    console.log('6. Syncing contract_id and recalculating amounts for historical records...');
    
    // Update urenregistratie contract_id links based on date ranges
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

    // Trigger update on all records to force recalculation of bedrag and timesheet_feiten sync
    await pool.query(`
      UPDATE urenregistratie 
      SET aantal_uren = aantal_uren;
    `);

    console.log('--- DATABASE ADJUSTMENTS COMPLETED SUCCESSFULLY ---');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    await pool.end();
  }
}

run();
