const pool = require('../backend/db');

async function run() {
  try {
    const res = await pool.query(`
      SELECT routine_name, routine_definition 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' AND routine_name = 'sync_timesheet_to_olap'
    `);
    
    for (let row of res.rows) {
      console.log('==================================================');
      console.log('FUNCTION:', row.routine_name);
      console.log('==================================================');
      console.log(row.routine_definition);
      console.log('\n');
    }
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

run();
