const pool = require('./db');
pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'cvs'")
  .then(r => {
    console.table(r.rows);
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
