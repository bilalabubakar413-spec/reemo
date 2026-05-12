require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://ekldjmogkgucxdbftgmb.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_s974HGAthUiBPrPUGS4nDw_xe4yyXd1';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
