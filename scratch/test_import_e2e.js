const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const envPath = fs.existsSync('.env') ? '.env' : (fs.existsSync('backend/.env') ? 'backend/.env' : '../backend/.env');
require('dotenv').config({ path: envPath });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function makeMultipart(files, fields, boundary) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const file of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`));
    parts.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content));
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
}

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, rawBody: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING E2E IMPORT TESTS ---');
  
  const boundary = '----Boundary' + Math.random().toString(36).slice(2);
  
  // Test 1: Preview of Klanten with custom/ignored headers
  console.log('\n[TEST 1] Preview - Smart Header Mapping & Ignored Columns...');
  const klantenCsv = 'Bedrijfsnaam,E-mail,Tel,Branche,interne notities\nTestKlantE2E,e2e@test.com,0687654321,Tech,secret memo here';
  
  const files1 = [
    {
      fieldname: 'bestanden',
      filename: 'klanten_test.csv',
      contentType: 'text/csv',
      content: klantenCsv
    }
  ];
  
  const body1 = makeMultipart(files1, {}, boundary);
  const res1 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/data-management/preview',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body1.length
    }
  }, body1);
  
  if (res1.statusCode !== 200) {
    console.error('Test 1 failed with status:', res1.statusCode, res1.rawBody);
    process.exit(1);
  }
  
  const previewData = res1.body.resultaten[0];
  console.log('Preview Result:', JSON.stringify(previewData, null, 2));
  
  if (previewData.tabelType !== 'klanten') {
    console.error('FAIL: Expected table type to be "klanten", got:', previewData.tabelType);
    process.exit(1);
  }
  
  // Verify mappings
  const expectedMappings = {
    'Bedrijfsnaam': 'naam',
    'E-mail': 'email',
    'Tel': 'telefoonnummer',
    'Branche': 'sector'
  };
  for (const [orig, std] of Object.entries(expectedMappings)) {
    if (previewData.kolomMapping[orig] !== std) {
      console.error(`FAIL: Expected mapping "${orig}" -> "${std}", got "${previewData.kolomMapping[orig]}"`);
      process.exit(1);
    }
  }
  
  // Verify ignored columns
  if (!previewData.onherkendekolommen.includes('interne notities')) {
    console.error('FAIL: "interne notities" was not ignored. Unrecognized list:', previewData.onherkendekolommen);
    process.exit(1);
  }
  console.log('PASS: Test 1 success (Mappings and Ignored Columns correctly recognized).');

  // Test 2: Import with auto-creation of missing links
  console.log('\n[TEST 2] Import - Auto-creating missing links (Factuur for non-existent client)...');
  
  // Clean up test client if exists
  await supabase.from('klant').delete().ilike('naam', 'Nieuwe Onbekende BV E2E');
  
  const facturenCsv = 'klant_naam,datum,vervaldatum,totaalbedrag,betalingsstatus\nNieuwe Onbekende BV E2E,2026-06-11,2026-06-25,500.00,open';
  
  const files2 = [
    {
      fieldname: 'bestanden',
      filename: 'facturen_test.csv',
      contentType: 'text/csv',
      content: facturenCsv
    }
  ];
  
  const body2 = makeMultipart(files2, { pin: '2526', overschrijf: 'false' }, boundary);
  const res2 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/data-management/import',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body2.length
    }
  }, body2);
  
  if (res2.statusCode !== 200) {
    console.error('Test 2 failed with status:', res2.statusCode, res2.rawBody);
    process.exit(1);
  }
  
  const importResult = res2.body.resultaten[0];
  console.log('Import Result:', JSON.stringify(importResult, null, 2));
  
  if (importResult.toegevoegd !== 1) {
    console.error('FAIL: Expected 1 invoice added, got:', importResult.toegevoegd);
    process.exit(1);
  }
  
  if (!importResult.autoAangemaakt.some(msg => msg.includes('Nieuwe Onbekende BV E2E'))) {
    console.error('FAIL: Missing auto-created log for Nieuwe Onbekende BV E2E. Log:', importResult.autoAangemaakt);
    process.exit(1);
  }
  
  // Verify in database
  const { data: dbKlant } = await supabase
    .from('klant')
    .select('*')
    .eq('naam', 'Nieuwe Onbekende BV E2E')
    .maybeSingle();
    
  if (!dbKlant) {
    console.error('FAIL: Client "Nieuwe Onbekende BV E2E" was not found in the database!');
    process.exit(1);
  }
  console.log('Found auto-created client in DB:', dbKlant);
  
  // Clean up
  await supabase.from('factuur').delete().eq('klant_id', dbKlant.klant_id);
  await supabase.from('klant').delete().eq('klant_id', dbKlant.klant_id);
  
  console.log('PASS: Test 2 success (Auto-created missing client stub and linked successfully).');
  
  console.log('\n--- ALL E2E IMPORT TESTS PASSED ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Error in e2e tests:', err);
  process.exit(1);
});
