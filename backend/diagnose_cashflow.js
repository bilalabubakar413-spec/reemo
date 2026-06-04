const supabase = require('./supabaseClient');

async function run() {
  // STAP 1A: view output
  console.log('=== STAP 1A: dashboard_cashflow_mtd view ===');
  const { data: mtd } = await supabase.from('dashboard_cashflow_mtd').select('*');
  console.log(JSON.stringify(mtd, null, 2));

  // STAP 1B: facturen + hun uren-datums via regelitems
  console.log('\n=== STAP 1B: Facturen met onderliggende uren-datums ===');
  const { data: facturen } = await supabase
    .from('factuur')
    .select('factuur_id, totaalbedrag, factuurdatum, betalingsstatus, factuur_regelitem(uren_id, urenregistratie(datum, bedrag))')
    .order('factuur_id', { ascending: false });

  for (const f of (facturen || [])) {
    const uren = (f.factuur_regelitem || []).map(r => r.urenregistratie).filter(Boolean);
    const datums = uren.map(u => u.datum).sort();
    const totUren = uren.reduce((s, u) => s + parseFloat(u.bedrag || 0), 0);
    console.log('Factuur', f.factuur_id, '| factuurdatum:', f.factuurdatum,
      '| bedrag:', f.totaalbedrag, '| status:', f.betalingsstatus,
      '| uren-datums:', datums.join(', ') || '(geen regelitems)');
  }

  // STAP 1C: approved uren per maand
  console.log('\n=== STAP 1C: Approved uren per maand ===');
  const { data: uren } = await supabase
    .from('urenregistratie')
    .select('datum, bedrag, status')
    .eq('status', 'approved')
    .order('datum');

  const perMaand = {};
  for (const u of (uren || [])) {
    const m = u.datum.substring(0, 7);
    if (!perMaand[m]) perMaand[m] = { count: 0, bedrag: 0 };
    perMaand[m].count++;
    perMaand[m].bedrag += parseFloat(u.bedrag || 0);
  }
  for (const [m, v] of Object.entries(perMaand)) {
    console.log(m + ': ' + v.count + ' timesheets, €' + v.bedrag.toFixed(2));
  }

  // STAP 1D: Facturen gefilterd op uren-datum (de CORRECTE manier)
  console.log('\n=== STAP 1D: Gefactureerd via uren-datum juni 2026 ===');
  const { data: factJuni } = await supabase
    .from('factuur')
    .select('factuur_id, totaalbedrag, betalingsstatus, factuur_regelitem(uren_id, urenregistratie(datum))')
    .gte('factuurdatum', '2026-06-01')
    .lte('factuurdatum', '2026-06-30');

  let gefact_via_urens_datum = 0;
  for (const f of (factJuni || [])) {
    const uren = (f.factuur_regelitem || []).map(r => r.urenregistratie).filter(Boolean);
    const isJuni = uren.some(u => u.datum && u.datum.startsWith('2026-06'));
    console.log('Factuur', f.factuur_id, '| heeft juni-uren:', isJuni, '| uren-datums:', uren.map(u => u.datum).join(', '));
    if (isJuni) gefact_via_urens_datum += parseFloat(f.totaalbedrag || 0);
  }
  console.log('Gefactureerd via uren-datum methode:', gefact_via_urens_datum);

  // STAP 1E: Diagnose samenvatting
  console.log('\n=== DIAGNOSE SAMENVATTING ===');
  console.log('Huidige view (gefilterd op factuurdatum):');
  console.log('  gefactureerd:', mtd[0]?.gefactureerd, '(FOUT - pakt mei-facturen die in juni zijn gemaakt)');
  console.log('Correct (gefilterd op uren.datum):');
  console.log('  gefactureerd:', gefact_via_urens_datum);
  console.log('\nOorzaak: facturen voor MEI-werk werden op 2026-06-03 aangemaakt,');
  console.log('dus factuurdatum filter pakt ze mee als "juni werk". De uren-datum is mei.');
}

run().catch(console.error);
