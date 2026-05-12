const pool = require('./db');

async function check() {
  try {
    const q1 = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'timesheet_feiten'");
    console.log('timesheet_feiten:', q1.rows);
    
    const q2 = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'dim_tijd'");
    console.log('dim_tijd:', q2.rows);
    
    const q3 = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'urenregistratie'");
    console.log('urenregistratie:', q3.rows);
    
    const q4 = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'project'");
    console.log('project:', q4.rows);
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

check();
