const http = require('http');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

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
  
  // Test 3: Multi-file Upload Dependency Sorting
  console.log('\n[TEST 3] Multi-file Import - Sorting of Client, Project, and Invoice dependencies...');
  
  // Clean up existing test entities
  await supabase.from('project').delete().ilike('projectnaam', 'E2E Sorting Project');
  await supabase.from('klant').delete().ilike('naam', 'E2E Sorting Klant');
  
  // Let's create the 3 files in an arbitrary order (e.g. Invoices first, then Projects, then Clients)
  const sortedFacturenCsv = 'klant_naam,datum,vervaldatum,totaalbedrag,betalingsstatus\nE2E Sorting Klant,2026-06-11,2026-06-25,1234.56,open';
  const sortedProjectenCsv = 'projectnaam,klant_naam,type,startdatum,status\nE2E Sorting Project,E2E Sorting Klant,T&M,2026-06-11,actief';
  const sortedKlantenCsv = 'naam,email,telefoonnummer,sector\nE2E Sorting Klant,sorting@e2e.com,0611111111,Sorting Industry';
  
  const files3 = [
    {
      fieldname: 'bestanden',
      filename: '3_facturen.csv',
      contentType: 'text/csv',
      content: sortedFacturenCsv
    },
    {
      fieldname: 'bestanden',
      filename: '2_projecten.csv',
      contentType: 'text/csv',
      content: sortedProjectenCsv
    },
    {
      fieldname: 'bestanden',
      filename: '1_klanten.csv',
      contentType: 'text/csv',
      content: sortedKlantenCsv
    }
  ];
  
  const body3 = makeMultipart(files3, { pin: '2526', overschrijf: 'false' }, boundary);
  const res3 = await request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/data-management/import',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body3.length
    }
  }, body3);
  
  if (res3.statusCode !== 200) {
    console.error('Test 3 failed with status:', res3.statusCode, res3.rawBody);
    process.exit(1);
  }
  
  console.log('Test 3 response:', JSON.stringify(res3.body, null, 2));
  
  // If sorting worked correctly:
  // 1. Klanten was processed first, so "E2E Sorting Klant" was imported normally (toegevoegd: 1, autoAangemaakt: []).
  // 2. Projecten was processed second, so it found the already-created "E2E Sorting Klant" and did not auto-create it (autoAangemaakt: []).
  // 3. Facturen was processed third, so it found the already-created "E2E Sorting Klant" and did not auto-create it (autoAangemaakt: []).
  // Let's verify that no "autoAangemaakt" stubs were created for E2E Sorting Klant!
  
  const results = res3.body.resultaten;
  
  // Verify that the files were processed in the correct order:
  // The resultaten array should be in the order: klanten, projecten, facturen
  if (results[0].tabelType !== 'klanten' || results[1].tabelType !== 'projecten' || results[2].tabelType !== 'facturen') {
    console.error('FAIL: Expected results to be returned in sorted order (klanten, projecten, facturen). Got:', results.map(r => r.tabelType));
    process.exit(1);
  }
  
  // Verify that none of them logged autoAangemaakt since the client was created first!
  for (const r of results) {
    if (r.autoAangemaakt && r.autoAangemaakt.length > 0) {
      console.error(`FAIL: Expected no auto-created logs during sorted import because client should exist first. Got log for ${r.bestand}:`, r.autoAangemaakt);
      process.exit(1);
    }
  }
  
  // Verify DB state
  const { data: finalKlant } = await supabase.from('klant').select('*').eq('naam', 'E2E Sorting Klant').single();
  const { data: finalProject } = await supabase.from('project').select('*').eq('projectnaam', 'E2E Sorting Project').single();
  const { data: finalFactuur } = await supabase.from('factuur').select('*').eq('klant_id', finalKlant.klant_id).single();
  
  if (!finalKlant || !finalProject || !finalFactuur) {
    console.error('FAIL: Database verification failed for sorted import.');
    process.exit(1);
  }
  
  // Verify columns on the imported client to ensure it wasn't a stub
  if (finalKlant.email !== 'sorting@e2e.com' || finalKlant.sector !== 'Sorting Industry') {
    console.error('FAIL: Client has stub values, meaning it was auto-created before being fully imported! Client:', finalKlant);
    process.exit(1);
  }
  
  // Clean up
  await supabase.from('factuur').delete().eq('factuur_id', finalFactuur.factuur_id);
  await supabase.from('project').delete().eq('project_id', finalProject.project_id);
  await supabase.from('klant').delete().eq('klant_id', finalKlant.klant_id);
  
  console.log('PASS: Test 3 success (Dependencies correctly sorted and processed in order).');
  
  console.log('\n--- ALL E2E IMPORT TESTS PASSED ---');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Error in e2e tests:', err);
  process.exit(1);
});
