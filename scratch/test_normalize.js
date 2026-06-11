const KOLOM_SYNONIEMEN = {
  // klanten
  'naam':            ['naam', 'bedrijfsnaam', 'klantnaam', 'klant', 'bedrijf', 'company', 'name', 'client'],
  'email':           ['email', 'e-mail', 'mail', 'emailadres', 'e-mailadres'],
  'telefoonnummer':  ['telefoonnummer', 'telefoon', 'tel', 'phone', 'mobiel', 'nummer'],
  'sector':          ['sector', 'branche', 'industrie', 'industry', 'categorie'],
  'contactpersoon':  ['contactpersoon', 'contact', 'aanspreekpunt', 'contactperson'],
  // projecten
  'projectnaam':     ['projectnaam', 'project', 'opdracht', 'opdrachtnaam', 'project naam'],
  'klant_naam':      ['klant_naam', 'klantnaam', 'klant', 'opdrachtgever', 'bedrijf'],
  'type':            ['type', 'soort', 'contracttype', 'projecttype'],
  'startdatum':      ['startdatum', 'start', 'begindatum', 'vanaf', 'start datum'],
  'einddatum':       ['einddatum', 'eind', 'tot', 'einde', 'eind datum'],
  'status':          ['status', 'staat', 'fase'],
  // facturen
  'factuurdatum':    ['factuurdatum', 'datum', 'factuur datum', 'invoice date'],
  'vervaldatum':     ['vervaldatum', 'verval', 'deadline', 'betaaltermijn', 'due date'],
  'totaalbedrag':    ['totaalbedrag', 'bedrag', 'totaal', 'amount', 'som', 'factuurbedrag'],
  'betalingsstatus': ['betalingsstatus', 'betaalstatus', 'status betaling', 'betaald'],
  'betalingsdatum':  ['betalingsdatum', 'betaald op', 'betaaldatum'],
  // developers
  'rol':             ['rol', 'functie', 'role', 'positie'],
  'uurtarief':       ['uurtarief', 'tarief', 'rate', 'uurprijs', 'prijs per uur'],
  'weekcapaciteit':  ['weekcapaciteit', 'capaciteit', 'uren per week', 'beschikbaarheid'],
  // timesheets
  'developer_naam':  ['developer_naam', 'developer', 'medewerker', 'consultant', 'freelancer', 'naam developer'],
  'project_naam':    ['project_naam', 'projectnaam', 'project'],
  'week_startdatum': ['week_startdatum', 'week', 'datum', 'weekstart', 'periode'],
  'aantal_uren':     ['aantal_uren', 'uren', 'hours', 'gewerkte uren', 'aantal'],
  'omschrijving':    ['omschrijving', 'beschrijving', 'notitie', 'opmerking', 'description']
};

function normaliseerHeader(header) {
  const schoon = header.toLowerCase().trim().replace(/[_\-\.]/g, ' ').replace(/\s+/g, ' ');
  
  // 1. Eerst exact matching proberen
  for (const [standaard, synoniemen] of Object.entries(KOLOM_SYNONIEMEN)) {
    if (synoniemen.some(s => s === schoon)) {
      return standaard;
    }
  }

  // 2. Indien geen exacte match, woord-gebaseerde matching proberen (word boundaries)
  for (const [standaard, synoniemen] of Object.entries(KOLOM_SYNONIEMEN)) {
    if (synoniemen.some(s => {
      // Match s als heel woord in schoon, of schoon als heel woord in s
      const escapedS = s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const escapedSchoon = schoon.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      
      const regexS = new RegExp('\\b' + escapedS + '\\b');
      const regexSchoon = new RegExp('\\b' + escapedSchoon + '\\b');
      
      return regexS.test(schoon) || regexSchoon.test(s);
    })) {
      return standaard;
    }
  }
  return null;
}

const testHeaders = [
  'Bedrijfsnaam', 'E-mail', 'Tel', 'Branche', 'interne notities', 'Uren', 'Tarief', 'datum', 'project_naam', 'control'
];

console.log("Header mappings with word boundaries:");
testHeaders.forEach(h => {
  console.log(`"${h}" -> "${normaliseerHeader(h)}"`);
});
