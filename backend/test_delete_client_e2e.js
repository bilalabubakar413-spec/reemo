const http = require('http');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

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
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

async function cleanUpE2E() {
  console.log('Cleaning up old test data...');
  
  // Find test client IDs and developer IDs
  const { data: klienten } = await supabase.from('klant').select('klant_id').ilike('naam', 'Klant Delete E2E');
  const clientIds = (klienten || []).map(k => k.klant_id);
  
  const { data: devs } = await supabase.from('developer').select('developer_id').ilike('naam', 'Developer Delete E2E');
  const devIds = (devs || []).map(d => d.developer_id);
  
  if (clientIds.length > 0) {
    const { data: projecten } = await supabase.from('project').select('project_id').in('klant_id', clientIds);
    const projectIds = (projecten || []).map(p => p.project_id);
    
    const { data: facturen } = await supabase.from('factuur').select('factuur_id').in('klant_id', clientIds);
    const factuurIds = (facturen || []).map(f => f.factuur_id);
    
    let urenIds = [];
    if (projectIds.length > 0) {
      const { data: uren } = await supabase.from('urenregistratie').select('uren_id').in('project_id', projectIds);
      urenIds = (uren || []).map(u => u.uren_id);
    }
    
    // Clean up timesheet_feiten
    await supabase.from('timesheet_feiten').delete().in('klant_id', clientIds).then(() => {}).catch(() => {});
    if (urenIds.length > 0) {
      await supabase.from('timesheet_feiten').delete().in('bron_uren_id', urenIds).then(() => {}).catch(() => {});
      await supabase.from('factuur_regelitem').delete().in('uren_id', urenIds).then(() => {}).catch(() => {});
    }
    if (factuurIds.length > 0) {
      await supabase.from('factuur_regelitem').delete().in('factuur_id', factuurIds).then(() => {}).catch(() => {});
    }
    if (urenIds.length > 0) {
      await supabase.from('urenregistratie').delete().in('uren_id', urenIds).then(() => {}).catch(() => {});
    }
    if (projectIds.length > 0) {
      await supabase.from('contract').delete().in('project_id', projectIds).then(() => {}).catch(() => {});
      await supabase.from('developer_project').delete().in('project_id', projectIds).then(() => {}).catch(() => {});
    }
    if (factuurIds.length > 0) {
      await supabase.from('factuur').delete().in('factuur_id', factuurIds).then(() => {}).catch(() => {});
    }
    if (projectIds.length > 0) {
      await supabase.from('project').delete().in('project_id', projectIds).then(() => {}).catch(() => {});
    }
    await supabase.from('klant').delete().in('klant_id', clientIds).then(() => {}).catch(() => {});
  }
  
  if (devIds.length > 0) {
    // Make sure timesheet_feiten, contract, and developer_project are cleared for developer
    await supabase.from('timesheet_feiten').delete().in('developer_id', devIds).then(() => {}).catch(() => {});
    await supabase.from('contract').delete().in('developer_id', devIds).then(() => {}).catch(() => {});
    await supabase.from('developer_project').delete().in('developer_id', devIds).then(() => {}).catch(() => {});
    await supabase.from('urenregistratie').delete().in('developer_id', devIds).then(() => {}).catch(() => {});
    await supabase.from('developer').delete().in('developer_id', devIds).then(() => {}).catch(() => {});
  }
}

async function runDeleteClientTests() {
  console.log('--- STARTING E2E DELETE CLIENT TESTS ---');

  await cleanUpE2E();

  // 2. Setup Test Data
  console.log('Creating test client...');
  const { data: client, error: cErr } = await supabase.from('klant').insert({
    naam: 'Klant Delete E2E',
    sector: 'Testing'
  }).select('*').single();
  if (cErr) throw cErr;

  console.log('Creating test developer...');
  const { data: developer, error: dErr } = await supabase.from('developer').insert({
    naam: 'Developer Delete E2E',
    email: 'delete_e2e@test.com',
    rol: 'Tester',
    uurtarief: 100,
    weekcapaciteit: 40,
    status: 'available'
  }).select('*').single();
  if (dErr) throw dErr;

  console.log('Creating test project...');
  const { data: project, error: pErr } = await supabase.from('project').insert({
    klant_id: client.klant_id,
    projectnaam: 'Project Delete E2E',
    type: 'T&M',
    status: 'actief'
  }).select('*').single();
  if (pErr) throw pErr;

  console.log('Creating test contract...');
  const { data: contract, error: conErr } = await supabase.from('contract').insert({
    developer_id: developer.developer_id,
    project_id: project.project_id,
    klant_id: client.klant_id,
    uurtarief: 100,
    startdatum: '2026-06-11',
    status: 'actief'
  }).select('*').single();
  if (conErr) throw conErr;

  console.log('Creating test invoice...');
  const { data: invoice, error: fErr } = await supabase.from('factuur').insert({
    klant_id: client.klant_id,
    factuurdatum: '2026-06-11',
    totaalbedrag: 1500.00,
    betalingsstatus: 'open'
  }).select('*').single();
  if (fErr) throw fErr;

  console.log('Creating test hours...');
  const { data: hours, error: hErr } = await supabase.from('urenregistratie').insert({
    developer_id: developer.developer_id,
    project_id: project.project_id,
    contract_id: contract.contract_id,
    datum: '2026-06-11',
    aantal_uren: 8,
    bedrag: 800,
    omschrijving: 'E2E Delete Hours',
    status: 'approved'
  }).select('*').single();
  if (hErr) throw hErr;

  // 3. Test GET check-actief
  console.log('\n[TEST 1] GET /api/clients/:id/check-actief...');
  const checkRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/clients/${client.klant_id}/check-actief`,
    method: 'GET'
  });

  if (checkRes.statusCode !== 200) {
    console.error('FAIL: check-actief failed with status:', checkRes.statusCode);
    process.exit(1);
  }

  const checkData = checkRes.body;
  console.log('Check Actief Data:', JSON.stringify(checkData, null, 2));

  if (!checkData.actief) {
    console.error('FAIL: Expected check-actief to return true');
    process.exit(1);
  }
  if (checkData.projecten.length !== 1 || checkData.projecten[0].naam !== 'Project Delete E2E') {
    console.error('FAIL: Expected 1 project named "Project Delete E2E"');
    process.exit(1);
  }
  if (checkData.aantalFacturen !== 1) {
    console.error('FAIL: Expected 1 invoice');
    process.exit(1);
  }
  if (checkData.openFacturen !== 1) {
    console.error('FAIL: Expected 1 open invoice');
    process.exit(1);
  }
  if (checkData.aantalUren !== 1) {
    console.error('FAIL: Expected 1 hour registration');
    process.exit(1);
  }
  if (checkData.totaleWaarde !== 2300.00) { // 1500 invoice + 800 hours
    console.error('FAIL: Expected total value 2300, got:', checkData.totaleWaarde);
    process.exit(1);
  }
  if (!checkData.gekoppeldeDevelopers.includes('Developer Delete E2E')) {
    console.error('FAIL: Expected developer "Developer Delete E2E" to be in linked developers list');
    process.exit(1);
  }
  console.log('PASS: check-actief returns correct impact details.');

  // 4. Test DELETE with incorrect PIN (403 check)
  console.log('\n[TEST 2] DELETE /api/clients/:id with incorrect PIN...');
  const deleteFailRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/clients/${client.klant_id}`,
    method: 'DELETE',
    headers: {
      'x-admin-pin': '0000'
    }
  });

  if (deleteFailRes.statusCode !== 403) {
    console.error('FAIL: Expected 403 Forbidden with invalid PIN, got:', deleteFailRes.statusCode, deleteFailRes.body);
    process.exit(1);
  }
  console.log('PASS: Correctly rejected deletion with 403 on invalid PIN.');

  // 5. Test DELETE with correct PIN (200 OK + cascade delete check)
  console.log('\n[TEST 3] DELETE /api/clients/:id with correct PIN (Cascade delete verification)...');
  const deleteSuccessRes = await request({
    hostname: 'localhost',
    port: 3000,
    path: `/api/clients/${client.klant_id}`,
    method: 'DELETE',
    headers: {
      'x-admin-pin': '2526'
    }
  });

  if (deleteSuccessRes.statusCode !== 200) {
    console.error('FAIL: Deletion failed with status:', deleteSuccessRes.statusCode, deleteSuccessRes.body);
    process.exit(1);
  }

  console.log('Delete Response:', JSON.stringify(deleteSuccessRes.body, null, 2));
  
  const delReport = deleteSuccessRes.body.verwijderd;
  if (delReport.projecten !== 1 || delReport.facturen !== 1 || delReport.uren !== 1) {
    console.error('FAIL: Incorrect deletion report counts in response:', delReport);
    process.exit(1);
  }

  // 6. DB Verification
  console.log('\n[TEST 4] Database state verification after cascade delete...');

  // Verify client is deleted
  const { data: dbClient } = await supabase.from('klant').select('*').eq('klant_id', client.klant_id).maybeSingle();
  if (dbClient) {
    console.error('FAIL: Client still exists in database!');
    process.exit(1);
  }

  // Verify project is deleted
  const { data: dbProject } = await supabase.from('project').select('*').eq('project_id', project.project_id).maybeSingle();
  if (dbProject) {
    console.error('FAIL: Project still exists in database!');
    process.exit(1);
  }

  // Verify invoice is deleted
  const { data: dbInvoice } = await supabase.from('factuur').select('*').eq('factuur_id', invoice.factuur_id).maybeSingle();
  if (dbInvoice) {
    console.error('FAIL: Invoice still exists in database!');
    process.exit(1);
  }

  // Verify hours are deleted
  const { data: dbHours } = await supabase.from('urenregistratie').select('*').eq('uren_id', hours.uren_id).maybeSingle();
  if (dbHours) {
    console.error('FAIL: Hours still exists in database!');
    process.exit(1);
  }

  // Verify contract is deleted
  const { data: dbContract } = await supabase.from('contract').select('*').eq('contract_id', contract.contract_id).maybeSingle();
  if (dbContract) {
    console.error('FAIL: Contract still exists in database!');
    process.exit(1);
  }

  // CRITICAL CHECK: Verify developer STILL EXISTS in the database!
  console.log('Verifying that developer remains in database...');
  const { data: dbDev } = await supabase.from('developer').select('*').eq('developer_id', developer.developer_id).maybeSingle();
  if (!dbDev) {
    console.error('FAIL: Developer was incorrectly deleted during client purge!');
    process.exit(1);
  }
  console.log('Developer still exists:', dbDev);

  // Clean up developer
  console.log('Cleaning up developer...');
  await supabase.from('developer').delete().eq('developer_id', developer.developer_id);

  console.log('PASS: All database cascade deletion state verified correctly (Developer remains untouched).');
  console.log('\n--- ALL E2E DELETE CLIENT TESTS PASSED ---');
  process.exit(0);
}

runDeleteClientTests().catch(err => {
  console.error('Error running delete client tests:', err);
  process.exit(1);
});
