require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('FATAL: Supabase env vars ontbreken!');
  console.error('URL:', supabaseUrl ? 'OK' : 'ONTBREEKT');
  console.error('KEY:', supabaseKey ? 'OK' : 'ONTBREEKT');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);


module.exports = supabase;
