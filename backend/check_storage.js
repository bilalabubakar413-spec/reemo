const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkBuckets() {
    const { data, error } = await supabase.storage.listBuckets();
    if (error) {
        console.error('Error listing buckets:', error.message);
        return;
    }
    console.log('Buckets:', data.map(b => b.name));
    
    if (data.some(b => b.name === 'cvs')) {
        const { data: files, error: fError } = await supabase.storage.from('cvs').list();
        if (fError) {
            console.error('Error listing files in cvs:', fError.message);
        } else {
            console.log('Files in cvs bucket:', files.map(f => f.name));
        }
    } else {
        console.log('Bucket "cvs" does NOT exist!');
    }
}

checkBuckets();
