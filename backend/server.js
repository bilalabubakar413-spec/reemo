console.log('====== DEBUG ENV BIJ START ======');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('ANON_KEY eerste 20:', process.env.SUPABASE_ANON_KEY?.substring(0,20));
console.log('SERVICE_KEY eerste 20:', process.env.SUPABASE_SERVICE_ROLE_KEY?.substring(0,20));
console.log('DATABASE_URL eerste 30:', process.env.DATABASE_URL?.substring(0,30));
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('==================================');

const express  = require('express');
const path     = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool     = require('./db');
const supabase = require('./supabaseClient'); // Uses service role key if available
const supabaseAdmin = supabase; // Unified client for storage operations

const app  = express();
const PORT = process.env.PORT || 3000;

const multer   = require('multer');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
const mammoth  = require('mammoth');
const { parseCV } = require('./cvParser');


app.get('/api/debug-counts', async (req, res) => {
  try {
    const { count: klantCount, error: klantError } = await supabase
      .from('klant')
      .select('*', { count: 'exact', head: true });
    
    const { count: devCount, error: devError } = await supabase
      .from('developer')
      .select('*', { count: 'exact', head: true });
    
    if (klantError || devError) throw (klantError || devError);

    res.json({ klanten: klantCount, developers: devCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Prevent browser caching for EVERYTHING (local dev)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});


// ── Multer – storage configurations ──────────────────────
const fs      = require('fs');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Disk storage for parsing (saves originals temporarily)
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `cv_${Date.now()}${ext}`;
    cb(null, name);
  },
});

// Memory storage for direct storage uploads
const memoryStorage = multer.memoryStorage();

const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
    ].includes(file.mimetype);
    cb(ok ? null : new Error('Alleen PDF, Word of TXT bestanden zijn toegestaan.'), ok);
  },
});

const storageUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 }
});


// ── Static frontend ────────────────────────────────────────────────────────────

const webAppDir = path.resolve(__dirname, '..', 'Web_App');
const indexFile = path.resolve(webAppDir, 'html', 'index.html');

// Serve static assets (css, js, images)
app.use('/css',    express.static(path.join(webAppDir, 'css')));
app.use('/js',     express.static(path.join(webAppDir, 'js')));
app.use('/images', express.static(path.join(webAppDir, 'images')));
app.use('/html',   express.static(path.join(webAppDir, 'html')));

// All page routes → serve index.html using fs to avoid Express v5 Windows sendFile issue
const _serveIndex = (req, res) => {
  try {
    const html = fs.readFileSync(indexFile, 'utf8');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch (e) {
    res.status(500).end('Could not load index.html: ' + e.message);
  }
};
app.get('/',                (req, res) => _serveIndex(req, res));
app.get('/html/index.html', (req, res) => _serveIndex(req, res));
app.get('/index.html',      (req, res) => _serveIndex(req, res));


// ── Helper ─────────────────────────────────────────────────────────────────────
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

// ==============================================================================
//  OLAP VIEWS  (read-only dashboards)
// ==============================================================================

app.get('/api/revenue-per-maand', async (req, res) => {
  try { res.json({ ok: true, data: await q('SELECT * FROM v_revenue_per_maand ORDER BY 1') }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Quarterly revenue: actual (approved timesheets) + expected (contracts)
// Returns per year/quarter: { jaar, kwartaal, geleverd, verwacht }
app.get('/api/revenue-per-kwartaal', async (req, res) => {
  try {
    // Actual revenue = sum of approved timesheet amounts grouped by quarter
    const actual = await q(`
      SELECT
        EXTRACT(YEAR  FROM datum)::int   AS jaar,
        EXTRACT(QUARTER FROM datum)::int AS kwartaal,
        COALESCE(SUM(bedrag), 0)         AS geleverd
      FROM urenregistratie
      WHERE status = 'approved'
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);

    // Expected revenue = per contract: uren_per_week * uurtarief * weeks in quarter
    // We spread each contract across every quarter it overlaps with
    const contracts = await q(`
      SELECT
        startdatum AS start_datum,
        einddatum AS eind_datum,
        COALESCE(uren_per_week, 40) AS uren_per_week,
        COALESCE(uurtarief, 0) AS uurtarief
      FROM contract
      WHERE status = 'actief' AND uurtarief IS NOT NULL AND uurtarief > 0
    `);

    // Build expected per year/quarter by distributing each contract
    const expectedMap = {};
    const today = new Date();
    contracts.forEach(c => {
      const start = new Date(c.start_datum || '2024-01-01');
      const end   = c.eind_datum ? new Date(c.eind_datum) : today;
      const ratePerWeek = parseFloat(c.uren_per_week) * parseFloat(c.uurtarief);

      // Iterate quarters from 2024 Q1 to current+4 quarters
      for (let yr = 2024; yr <= today.getFullYear() + 1; yr++) {
        for (let q = 1; q <= 4; q++) {
          const qStart = new Date(yr, (q - 1) * 3, 1);
          const qEnd   = new Date(yr, q * 3, 0); // last day of quarter
          // Overlap check
          if (qStart > end || qEnd < start) continue;
          const overlapStart = start > qStart ? start : qStart;
          const overlapEnd   = end   < qEnd   ? end   : qEnd;
          const days  = Math.max(0, (overlapEnd - overlapStart) / 86400000 + 1);
          const weeks = days / 7;
          const key = `${yr}_${q}`;
          expectedMap[key] = (expectedMap[key] || 0) + ratePerWeek * weeks;
        }
      }
    });

    // Merge actual + expected into unified result
    const allKeys = new Set([
      ...actual.map(r => `${r.jaar}_${r.kwartaal}`),
      ...Object.keys(expectedMap)
    ]);
    const rows = [...allKeys].map(key => {
      const [jr, kw] = key.split('_').map(Number);
      const act = actual.find(r => r.jaar === jr && r.kwartaal === kw);
      return {
        jaar: jr,
        kwartaal: kw,
        geleverd:  parseFloat(act?.geleverd  || 0),
        verwacht:  Math.round(expectedMap[key] || 0)
      };
    }).sort((a, b) => a.jaar !== b.jaar ? a.jaar - b.jaar : a.kwartaal - b.kwartaal);

    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/uren-per-klant', async (req, res) => {
  try {
    const data = await q(`
      SELECT 
        k.naam AS klant_naam,
        COALESCE(SUM(u.aantal_uren), 0)::numeric AS totaal_uren
      FROM klant k
      LEFT JOIN project p ON p.klant_id = k.klant_id
      LEFT JOIN urenregistratie u ON u.project_id = p.project_id AND u.status = 'approved'
      GROUP BY k.klant_id, k.naam
      ORDER BY totaal_uren DESC
    `);
    res.json({ ok: true, data });
  }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/uren-per-developer', async (req, res) => {
  try { res.json({ ok: true, data: await q('SELECT * FROM v_uren_per_developer ORDER BY 2 DESC') }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/openstaande-timesheets', async (req, res) => {
  try { res.json({ ok: true, data: await q('SELECT * FROM v_openstaande_timesheets') }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ==============================================================================
//  KLANTEN  →  /api/klanten
// ==============================================================================

// GET all
app.get('/api/klanten', async (req, res) => {
  try {
    const rows = await q(`
      SELECT k.*,
             (SELECT COUNT(*) FROM project p WHERE p.klant_id = k.klant_id AND p.status = 'Actief') AS project_count,
             (SELECT COUNT(DISTINCT c.developer_id) FROM contract c WHERE c.klant_id = k.klant_id AND c.status = 'actief') AS developer_count
      FROM klant k
      ORDER BY k.naam
    `);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET single with full detail (projects, developers, hours, invoices)
app.get('/api/klanten/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const klant = await q('SELECT * FROM klant WHERE klant_id=$1', [id]);
    if (!klant.length) return res.status(404).json({ ok: false, error: 'Klant niet gevonden' });

    const [projecten, uren, facturen] = await Promise.all([
      q(`SELECT p.*, COUNT(c.contract_id) AS developer_count
         FROM project p
         LEFT JOIN contract c ON c.project_id = p.project_id AND c.status = 'actief'
         WHERE p.klant_id=$1
         GROUP BY p.project_id ORDER BY p.startdatum DESC`, [id]),

      q(`SELECT COALESCE(SUM(u.aantal_uren),0) AS totaal_uren,
                COALESCE(SUM(u.bedrag),0)       AS totaal_bedrag
         FROM urenregistratie u
         JOIN project p ON p.project_id = u.project_id
         WHERE p.klant_id=$1 AND u.status = 'approved'`, [id]),

      q(`SELECT * FROM factuur WHERE klant_id=$1 ORDER BY factuurdatum DESC`, [id]),
    ]);

    // Get developers linked to this client via contracts
    const devs = await q(
      `SELECT DISTINCT d.developer_id, d.naam, d.rol, COALESCE(c.uurtarief, d.uurtarief) AS uurtarief,
              SUM(u.aantal_uren) FILTER (WHERE date_trunc('month', u.datum)=date_trunc('month', CURRENT_DATE)) AS uren_maand
       FROM developer d
       JOIN contract c ON c.developer_id = d.developer_id
       JOIN project p            ON p.project_id = c.project_id
       LEFT JOIN urenregistratie u ON u.developer_id = d.developer_id AND u.project_id = p.project_id
       WHERE p.klant_id=$1 AND c.status = 'actief'
       GROUP BY d.developer_id, d.naam, d.rol, c.uurtarief, d.uurtarief`, [id]);

    res.json({ ok: true, data: { klant: klant[0], projecten, developers: devs, uren: uren[0], facturen } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST – create
app.post('/api/klanten', async (req, res) => {
  const { naam, email, telefoonnummer, sector, contactpersoon } = req.body;
  if (!naam) return res.status(400).json({ ok: false, error: 'naam is verplicht' });
  try {
    const rows = await q(
      `INSERT INTO klant (naam, email, telefoonnummer, sector, contactpersoon)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [naam, email || null, telefoonnummer || null, sector || null, contactpersoon || null]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PUT – update
app.put('/api/klanten/:id', async (req, res) => {
  const { id } = req.params;
  const { naam, email, telefoonnummer, sector, contactpersoon } = req.body;
  if (!naam) return res.status(400).json({ ok: false, error: 'naam is verplicht' });
  try {
    const rows = await q(
      `UPDATE klant SET naam=$1, email=$2, telefoonnummer=$3, sector=$4, contactpersoon=$5
       WHERE klant_id=$6 RETURNING *`,
      [naam, email || null, telefoonnummer || null, sector || null, contactpersoon || null, id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Klant niet gevonden' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE
app.delete('/api/klanten/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await q('DELETE FROM klant WHERE klant_id=$1 RETURNING klant_id', [id]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Klant niet gevonden' });
    res.json({ ok: true });
  } catch (e) {
    const msg = e.message.includes('foreign key') || e.message.includes('violates')
      ? 'Kan klant niet verwijderen: er zijn nog projecten, uren of facturen gekoppeld.'
      : e.message;
    res.status(500).json({ ok: false, error: msg });
  }
});

// ==============================================================================
//  PROJECTEN  →  /api/projecten
// ==============================================================================

app.get('/api/projecten', async (req, res) => {
  try {
    const rows = await q(
      `SELECT p.*, k.naam AS klant_naam FROM project p
       LEFT JOIN klant k ON k.klant_id = p.klant_id ORDER BY p.startdatum DESC`
    );
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/projecten', async (req, res) => {
  const { klant_id, projectnaam, type, startdatum, einddatum, status } = req.body;
  if (!klant_id || !projectnaam) return res.status(400).json({ ok: false, error: 'klant_id en projectnaam zijn verplicht' });
  try {
    const rows = await q(
      `INSERT INTO project (klant_id, projectnaam, type, startdatum, einddatum, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [klant_id, projectnaam, type || 'T&M', startdatum || null, einddatum || null, status || 'Actief']
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ==============================================================================
//  FACTUREN  →  /api/facturen
// ==============================================================================

app.get('/api/facturen', async (req, res) => {
  try {
    const rows = await q(
      `SELECT f.*, k.naam AS klant_naam FROM factuur f
       LEFT JOIN klant k ON k.klant_id = f.klant_id ORDER BY f.factuurdatum DESC`
    );
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/facturen', async (req, res) => {
  const { klant_id, factuurdatum, vervaldatum, totaalbedrag } = req.body;
  if (!klant_id || !factuurdatum || !totaalbedrag) return res.status(400).json({ ok: false, error: 'klant_id, factuurdatum en totaalbedrag zijn verplicht' });
  try {
    const rows = await q(
      `INSERT INTO factuur (klant_id, factuurdatum, vervaldatum, totaalbedrag, betalingsstatus)
       VALUES ($1,$2,$3,$4,'open') RETURNING *`,
      [klant_id, factuurdatum, vervaldatum || null, totaalbedrag]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.patch('/api/facturen/:id', async (req, res) => {
  const { betalingsstatus } = req.body;
  const id = req.params.id;
  if (!betalingsstatus) return res.status(400).json({ ok: false, error: 'betalingsstatus is verplicht' });
  try {
    const validStatuses = ['open', 'betaald', 'te_laat'];
    if (!validStatuses.includes(betalingsstatus)) {
        return res.status(400).json({ ok: false, error: 'Ongeldige betalingsstatus' });
    }
    const rows = await q(
      `UPDATE factuur SET betalingsstatus=$1 WHERE factuur_id=$2 RETURNING *`,
      [betalingsstatus, id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Factuur niet gevonden' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ==============================================================================
//  DEVELOPERS  →  /api/developers
// ==============================================================================

// GET all
app.get('/api/developers', async (req, res) => {
  try {
    const rows = await q(`
      SELECT d.developer_id, d.naam, d.email, d.type, d.rol, d.uurtarief, d.weekcapaciteit,
             d.aangemaakt_op, d.skills, d.beschikbaarheid, d.cv_url, d.status,
             (SELECT COUNT(*) FROM contract c WHERE c.developer_id = d.developer_id AND c.status = 'actief' AND (c.einddatum IS NULL OR c.einddatum >= CURRENT_DATE)) as project_count,
             (SELECT SUM(aantal_uren) FROM urenregistratie u WHERE u.developer_id = d.developer_id AND u.status = 'approved' AND u.datum >= date_trunc('week', CURRENT_DATE)) as uren_week,
             (SELECT SUM(c.uren_per_week) FROM contract c WHERE c.developer_id = d.developer_id AND c.status = 'actief' AND (c.einddatum IS NULL OR c.einddatum >= CURRENT_DATE)) as assigned_hours,
             (SELECT project_id FROM contract c2 WHERE c2.developer_id = d.developer_id AND c2.status = 'actief' LIMIT 1) as first_project_id,
             (SELECT klant_id FROM contract c3 WHERE c3.developer_id = d.developer_id AND c3.status = 'actief' LIMIT 1) as first_klant_id
      FROM developer d
      WHERE d.status = 'active'
      ORDER BY d.naam
    `);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/developers/all', async (req, res) => {
  try {
    const rows = await q(`SELECT * FROM developer ORDER BY naam`);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET single with full detail (projects, hours, cv)
app.get('/api/developers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const dev = await q('SELECT * FROM developer WHERE developer_id=$1', [id]);
    if (!dev.length) return res.status(404).json({ ok: false, error: 'Developer niet gevonden' });

    const [projecten, uren, cvs] = await Promise.all([
      q(`SELECT p.project_id, p.projectnaam, p.status as project_status,
                k.naam AS klant_naam, k.klant_id,
                c.contract_id, c.rol_op_project, c.uren_per_week, c.uurtarief,
                c.startdatum, c.einddatum, c.status as contract_status
         FROM project p
         JOIN contract c ON c.project_id = p.project_id
         JOIN klant k ON k.klant_id = c.klant_id
         WHERE c.developer_id=$1 AND c.status = 'actief'
         ORDER BY c.startdatum DESC`, [id]),

      q(`SELECT u.*, p.projectnaam, k.naam AS klant_naam
         FROM urenregistratie u
         JOIN project p ON p.project_id = u.project_id
         JOIN klant k ON k.klant_id = p.klant_id
         WHERE u.developer_id=$1
         ORDER BY u.datum DESC LIMIT 50`, [id]),

      q(`SELECT * FROM cvs WHERE developer_id=$1 ORDER BY uploaded_at DESC LIMIT 1`, [id]).catch(e => [])
    ]);

    res.json({ 
      ok: true, 
      data: { 
        developer: dev[0], 
        projecten, 
        uren, 
        cv: cvs && cvs.length ? cvs[0] : null 
      } 
    });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET – Get signed URL for developer CV
app.get('/api/developers/:id/cv-url', async (req, res) => {
  const { id } = req.params;
  try {
    const devRows = await q('SELECT cv_url FROM developer WHERE developer_id = $1', [id]);
    if (!devRows.length || !devRows[0].cv_url) {
      return res.status(404).json({ ok: false, error: 'Geen CV gevonden voor deze developer' });
    }

    const cvPath = devRows[0].cv_url;
    // Fetch developer name for friendly download filename
    const dev = await q('SELECT naam FROM developer WHERE developer_id = $1', [id]);
    const devName = dev[0]?.naam || 'Developer';
    const safeName = devName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    const ext = cvPath.split('.').pop();
    const downloadName = `CV_${safeName}.${ext}`;

    // Create signed URL via supabaseAdmin with download option
    const { data, error } = await supabaseAdmin.storage
      .from('cvs')
      .createSignedUrl(cvPath, 3600, {
        download: downloadName
      });

    if (error) throw error;
    res.json({ ok: true, data: { url: data.signedUrl } });
  } catch (e) {
    console.error('[CV URL] Error:', e.message);
    res.status(500).json({ ok: false, error: 'Fout bij ophalen CV link: ' + e.message });
  }
});

// POST – storage upload
app.post('/api/storage/upload', storageUpload.single('file'), async (req, res) => {
  const { bucket, developer_id } = req.body;
  const file = req.file;

  if (!file || !bucket || !developer_id) {
    return res.status(400).json({ ok: false, error: 'Bestand, bucket en developer_id zijn verplicht' });
  }

  try {
    const ext = file.originalname.split('.').pop() || 'pdf';
    const safeBase = file.originalname.replace(/\.[^/.]+$/, "").replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filePath = `${developer_id}_${safeBase}.${ext}`;

    console.log(`Stap 3: Upload naar Supabase Storage (${bucket}) gestart. Pad: ${filePath}, Size: ${file.size} bytes`);

    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('[STORAGE UPLOAD] Supabase Error:', error);
      throw error;
    }

    console.log('Stap 4: Storage response:', data, 'Geen fout');

    // Update developer table with cv_url
    await q('UPDATE developer SET cv_url = $1 WHERE developer_id = $2', [filePath, developer_id]);
    console.log('Stap 5: cv_url opgeslagen in database:', filePath);

    res.json({ ok: true, data: { filePath } });
  } catch (e) {
    console.error('[STORAGE UPLOAD] Fatal Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// TEST Storage endpoint
app.post('/api/test-storage', storageUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Geen bestand ontvangen' });
  try {
    const filePath = `test_${Date.now()}.pdf`;
    const { data, error } = await supabaseAdmin.storage
      .from('cvs')
      .upload(filePath, req.file.buffer, { contentType: req.file.mimetype });
    
    if (error) throw error;
    res.json({ ok: true, path: filePath });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


// POST – create or update (check-first, no UNIQUE constraint required)
app.post('/api/developers', async (req, res) => {
  const { naam, email, type, rol, uurtarief, weekcapaciteit, status, skills } = req.body;
  if (!naam || !email) return res.status(400).json({ ok: false, error: 'naam en email zijn verplicht' });
  try {
    // Check if developer with this email already exists
    const existing = await q('SELECT developer_id FROM developer WHERE email = $1', [email]);

    let rows;
    let wasUpdated = false;

    if (existing.length > 0) {
      // UPDATE existing developer
      wasUpdated = true;
      rows = await q(
        `UPDATE developer
         SET naam=$1, rol=$2, uurtarief=$3, weekcapaciteit=$4, type=$5, status=$6, skills=$7
         WHERE email=$8
         RETURNING *`,
        [naam, rol || null, uurtarief || null, weekcapaciteit || 40, type || 'ZZP', status || 'active', skills || null, email]
      );
    } else {
      // INSERT new developer
      rows = await q(
        `INSERT INTO developer (naam, email, type, rol, uurtarief, weekcapaciteit, status, skills)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [naam, email, type || 'ZZP', rol || null, uurtarief || null, weekcapaciteit || 40, status || 'active', skills || null]
      );
    }

    const devData = rows[0];
    const developer_id = devData.developer_id;
    console.log('Stap 1: Developer aangemaakt/geüpdatet, id:', developer_id);

    res.status(wasUpdated ? 200 : 201).json({ ok: true, data: devData, upserted: wasUpdated });
  } catch (e) {
    console.error('[POST /api/developers]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PATCH – update developer fields including beschikbaarheid and weekcapaciteit
app.patch('/api/developers/:id', async (req, res) => {
  const { id } = req.params;
  const { cv_url, naam, email, rol, uurtarief, weekcapaciteit, beschikbaarheid, skills } = req.body;
  console.log(`[PATCH /api/developers/${id}] Body:`, req.body);
  try {

    const fields = [];
    const values = [];
    let i = 1;

    if (cv_url !== undefined)        { fields.push(`cv_url=$${i++}`);        values.push(cv_url); }
    if (naam !== undefined)          { fields.push(`naam=$${i++}`);          values.push(naam); }
    if (email !== undefined)         { fields.push(`email=$${i++}`);         values.push(email); }
    if (rol !== undefined)           { fields.push(`rol=$${i++}`);           values.push(rol); }
    if (uurtarief !== undefined)     { fields.push(`uurtarief=$${i++}`);     values.push(uurtarief); }
    if (weekcapaciteit !== undefined){ fields.push(`weekcapaciteit=$${i++}`);values.push(parseInt(weekcapaciteit)); }
    if (beschikbaarheid !== undefined){ fields.push(`beschikbaarheid=$${i++}`); values.push(beschikbaarheid); }
    if (skills !== undefined)         { fields.push(`skills=$${i++}`);        values.push(JSON.stringify(skills || [])); }

    if (fields.length === 0) return res.status(400).json({ ok: false, error: 'Geen velden om bij te werken' });

    values.push(id);
    const rows = await q(
      `UPDATE developer SET ${fields.join(', ')} WHERE developer_id=$${i} RETURNING *`,
      values
    );

    if (!rows.length) return res.status(404).json({ ok: false, error: 'Developer niet gevonden' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    console.error('[PATCH /api/developers/:id] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/developers/:id/skills', async (req, res) => {
  const { id } = req.params;
  const { skills } = req.body;
  try {
    const skillsJson = JSON.stringify(skills || []);
    const { rows } = await q(
      `UPDATE developer SET skills=$1 WHERE developer_id=$2 RETURNING *`,
      [skillsJson, id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Developer niet gevonden' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    console.error('[PATCH /api/developers/:id/skills] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==============================================================================
//  URENREGISTRATIE  →  /api/timesheets
// ==============================================================================

// GET all  (joined with developer & project/klant for display)
app.get('/api/timesheets', async (req, res) => {
  try {
    const rows = await q(`
      SELECT
        u.uren_id        AS id,
        d.developer_id   AS "developer_id",
        d.naam           AS "developerName",
        k.naam           AS "clientName",
        p.projectnaam    AS "projectName",
        u.datum          AS date,
        u.aantal_uren    AS "hoursWorked",
        u.bedrag,
        u.omschrijving   AS description,
        u.status
      FROM urenregistratie u
      JOIN developer d ON d.developer_id = u.developer_id
      LEFT JOIN project  p ON p.project_id  = u.project_id
      LEFT JOIN klant    k ON k.klant_id    = p.klant_id
      ORDER BY u.datum DESC
    `);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST – log hours (auto-lookup actief contract op basis van developer+project+datum)
app.post('/api/timesheets', async (req, res) => {
  console.log('TIMESHEET BODY:', JSON.stringify(req.body, null, 2));
  const { developer_id, project_id, datum, aantal_uren, omschrijving } = req.body;

  if (!developer_id || !project_id || !datum || !aantal_uren) {
    return res.status(400).json({
      ok: false,
      error: `Verplichte velden ontbreken: ${[
        !developer_id && 'developer_id',
        !project_id && 'project_id',
        !datum && 'datum',
        !aantal_uren && 'aantal_uren'
      ].filter(Boolean).join(', ')}`
    });
  }

  let contract_id = null;
  let bedrag = null;

  try {
    const contracts = await q(`
      SELECT contract_id, uurtarief 
      FROM contract 
      WHERE developer_id = $1 
        AND project_id = $2 
        AND status = 'actief' 
        AND startdatum <= $3 
        AND (einddatum IS NULL OR einddatum >= $3)
      ORDER BY startdatum DESC
      LIMIT 1
    `, [developer_id, project_id, datum]);

    if (contracts.length) {
      contract_id = contracts[0].contract_id;
      bedrag = parseFloat(aantal_uren) * parseFloat(contracts[0].uurtarief);
    }
  } catch (e) {
    console.warn('Contract lookup mislukt (niet fataal):', e.message);
  }

  if (!bedrag) {
    try {
      const devRows = await q('SELECT uurtarief FROM developer WHERE developer_id=$1', [developer_id]);
      if (devRows.length && devRows[0].uurtarief) {
        bedrag = parseFloat(devRows[0].uurtarief) * parseFloat(aantal_uren);
      }
    } catch (e) {
      console.warn('Developer uurtarief lookup failed:', e.message);
    }
  }

  try {
    const rows = await q(
      `INSERT INTO urenregistratie (developer_id, project_id, contract_id, datum, aantal_uren, bedrag, omschrijving, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
      [developer_id, project_id, contract_id, datum, aantal_uren, bedrag, omschrijving || '']
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (error) {
    console.error('INSERT FOUT:', error);
    res.status(400).json({ ok: false, error: error.message });
  }
});

// PATCH – approve or reject single
app.patch('/api/timesheets/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['approved','rejected','pending'].includes(status?.toLowerCase()))
    return res.status(400).json({ ok: false, error: 'status must be approved, rejected or pending' });
  try {
    const rows = await q(
      'UPDATE urenregistratie SET status=$1 WHERE uren_id=$2 RETURNING *',
      [status, id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PATCH – bulk approve
app.patch('/api/timesheets', async (req, res) => {
  try {
    const rows = await q(
      "UPDATE urenregistratie SET status='approved' WHERE status='pending' RETURNING uren_id"
    );
    res.json({ ok: true, data: { approvedCount: rows.length } });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// DELETE
app.delete('/api/timesheets/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await q('DELETE FROM urenregistratie WHERE uren_id=$1', [id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ==============================================================================
//  FACTUREN  →  /api/facturen
// ==============================================================================

// GET all
app.get('/api/facturen', async (req, res) => {
  try {
    const rows = await q(`
      SELECT
        f.factuur_id        AS id,
        k.naam              AS "clientName",
        f.factuurdatum      AS "dateSent",
        f.vervaldatum       AS "paymentDeadline",
        f.totaalbedrag      AS amount,
        f.betalingsstatus   AS status
      FROM factuur f
      JOIN klant k ON k.klant_id = f.klant_id
      ORDER BY f.factuurdatum DESC
    `);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST – create invoice
app.post('/api/facturen', async (req, res) => {
  const { klant_id, factuurdatum, vervaldatum, totaalbedrag } = req.body;
  if (!klant_id || !totaalbedrag || !vervaldatum)
    return res.status(400).json({ ok: false, error: 'klant_id, totaalbedrag en vervaldatum zijn verplicht' });
  try {
    const rows = await q(
      `INSERT INTO factuur (klant_id, factuurdatum, vervaldatum, totaalbedrag, betalingsstatus)
       VALUES ($1,$2,$3,$4,'Open') RETURNING *`,
      [klant_id, factuurdatum || new Date().toISOString().slice(0,10), vervaldatum, totaalbedrag]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// PATCH – update payment status
app.patch('/api/facturen/:id', async (req, res) => {
  const { id } = req.params;
  const { betalingsstatus } = req.body;
  
  if (!betalingsstatus) return res.status(400).json({ ok: false, error: 'betalingsstatus is verplicht' });
  
  // Normalize status names to match DB exactly
  let status = betalingsstatus.toLowerCase();
  if (status === 'paid') status = 'betaald';
  if (status === 'overdue') status = 'te_laat';
  
  const validStatuses = ['open', 'betaald', 'te_laat'];
  if (!validStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Ongeldige betalingsstatus: ' + status });
  }

  try {
    const rows = await q(
      'UPDATE factuur SET betalingsstatus=$1 WHERE factuur_id=$2 RETURNING *',
      [status, id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Factuur niet gevonden' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ==============================================================================
//  PROJECTS  →  /api/projecten  (for dropdowns)
// ==============================================================================

app.get('/api/developer-projects/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await q(`
      SELECT DISTINCT p.project_id, p.projectnaam, k.naam AS klant_naam
      FROM contract c
      JOIN project p ON p.project_id = c.project_id
      JOIN klant k ON k.klant_id = p.klant_id
      WHERE c.developer_id = $1 AND c.status = 'actief' AND p.status = 'Actief'
      ORDER BY p.projectnaam
    `, [id]);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/developer-projects', async (req, res) => {
  const { developer_id, project_id, rol_op_project, startdatum, einddatum, uren_per_week } = req.body;
  
  console.log('[POST /api/developer-projects] Body:', req.body);

  if (!developer_id || !project_id || !startdatum || !uren_per_week) {
    return res.status(400).json({ ok: false, error: 'developer_id, project_id, startdatum and uren_per_week are required' });
  }

  try {
    const devId = parseInt(developer_id);
    const projId = parseInt(project_id);
    const hours = parseInt(uren_per_week);

    // 1. Fetch klant_id from project
    const projRows = await q('SELECT klant_id FROM project WHERE project_id = $1', [projId]);
    if (!projRows.length) return res.status(404).json({ ok: false, error: 'Project niet gevonden' });
    const klantId = projRows[0].klant_id;

    // 2. Fetch default uurtarief from developer
    const devRows = await q('SELECT uurtarief FROM developer WHERE developer_id = $1', [devId]);
    const rate = devRows.length ? parseFloat(devRows[0].uurtarief || 85.00) : 85.00;

    // 3. Insert or update contract table (the trigger will sync this to developer_project)
    const exists = await q(`
      SELECT contract_id FROM contract 
      WHERE developer_id = $1 AND project_id = $2 AND startdatum = $3
    `, [devId, projId, startdatum]);

    if (exists.length) {
      await q(`
        UPDATE contract 
        SET uren_per_week = $1,
            einddatum = $2,
            rol_op_project = $3,
            uurtarief = COALESCE(uurtarief, $4),
            status = 'actief'
        WHERE contract_id = $5
      `, [hours, einddatum || null, rol_op_project || 'Developer', rate, exists[0].contract_id]);
    } else {
      await q(`
        INSERT INTO contract (klant_id, project_id, developer_id, startdatum, einddatum, uurtarief, uren_per_week, rol_op_project, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'actief')
      `, [klantId, projId, devId, startdatum, einddatum || null, rate, hours, rol_op_project || 'Developer']);
    }

    res.status(201).json({ ok: true, message: 'Developer succesvol toegewezen' });
  } catch (e) {
    console.error('[POST /api/developer-projects] DB Error:', e);

    res.status(500).json({ ok: false, error: e.message });
  }
});

// PATCH – update client info
app.patch('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  const { naam, email, telefoonnummer, sector, contactpersoon } = req.body;
  if (!naam) return res.status(400).json({ ok: false, error: 'naam is verplicht' });
  try {
    const rows = await q(
      `UPDATE klant SET naam=$1, email=$2, telefoonnummer=$3, sector=$4, contactpersoon=$5
       WHERE klant_id=$6 RETURNING *`,
      [naam, email || null, telefoonnummer || null, sector || null, contactpersoon || null, id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Klant niet gevonden' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// POST – upload client logo
app.post('/api/clients/:id/logo', storageUpload.single('logo'), async (req, res) => {
  const { id } = req.params;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ ok: false, error: 'Geen logo bestand geüpload' });
  }

  try {
    const ext = file.originalname.split('.').pop() || 'png';
    const filePath = `${id}.${ext}`;
    
    // Upload to Supabase Storage with upsert: true
    const { data, error } = await supabaseAdmin.storage
      .from('client-logos')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
        upsert: true
      });

    if (error) {
      console.error('[CLIENT LOGO UPLOAD] Supabase Storage Error:', error);
      throw error;
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('client-logos')
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    // Update database table
    await q('UPDATE klant SET logo_url = $1 WHERE klant_id = $2', [publicUrl, id]);

    res.json({ ok: true, logo_url: publicUrl });
  } catch (e) {
    console.error('[CLIENT LOGO UPLOAD] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE – remove client logo
app.delete('/api/clients/:id/logo', async (req, res) => {
  const { id } = req.params;
  try {
    const clientRows = await q('SELECT logo_url FROM klant WHERE klant_id = $1', [id]);
    if (clientRows.length && clientRows[0].logo_url) {
      const parts = clientRows[0].logo_url.split('/');
      const filename = parts[parts.length - 1];
      if (filename) {
        const { error: storageError } = await supabaseAdmin.storage
          .from('client-logos')
          .remove([filename]);
        if (storageError) {
          console.warn('[CLIENT LOGO DELETE] Supabase Storage Error:', storageError);
        }
      }
    }

    // Set logo_url to NULL in DB
    await q('UPDATE klant SET logo_url = NULL WHERE klant_id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[CLIENT LOGO DELETE] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET – client contracts
app.get('/api/clients/:id/contracts', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await q(`
      SELECT c.*, d.naam AS developer_naam, p.projectnaam 
      FROM contract c
      LEFT JOIN developer d ON d.developer_id = c.developer_id
      LEFT JOIN project p ON p.project_id = c.project_id
      WHERE c.klant_id = $1
      ORDER BY c.startdatum DESC
    `, [id]);
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('[GET /api/clients/:id/contracts] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST – add client contract
app.post('/api/clients/:id/contracts', async (req, res) => {
  const { id } = req.params;
  const { project_id, developer_id, uurtarief, uren_per_week, startdatum, einddatum } = req.body;

  if (!project_id || !developer_id || !uurtarief || !uren_per_week || !startdatum) {
    return res.status(400).json({ ok: false, error: 'Vul alle verplichte velden in.' });
  }

  try {
    const rows = await q(`
      INSERT INTO contract (klant_id, project_id, developer_id, uurtarief, uren_per_week, startdatum, einddatum, status, rol_op_project)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'actief', 'Developer')
      RETURNING *
    `, [id, project_id, developer_id, uurtarief, uren_per_week, startdatum, einddatum || null]);
    
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) {
    console.error('[POST /api/clients/:id/contracts] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET – developers NOT yet linked to any project of this client
app.get('/api/clients/:id/available-developers', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await q(`
      SELECT d.developer_id, d.naam, d.rol, d.uurtarief
      FROM developer d
      WHERE d.developer_id NOT IN (
        SELECT DISTINCT c.developer_id
        FROM contract c
        JOIN project p ON p.project_id = c.project_id
        WHERE p.klant_id = $1 AND c.status = 'actief'
      )
      ORDER BY d.naam
    `, [id]);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// GET – developers linked to this client
app.get('/api/clients/:id/developers', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await q(`
      SELECT DISTINCT d.developer_id, d.naam, d.rol, COALESCE(c.uurtarief, d.uurtarief) AS uurtarief,
        COALESCE(json_agg(json_build_object('project_id', p.project_id, 'projectnaam', p.projectnaam)) FILTER (WHERE p.project_id IS NOT NULL), '[]') as projecten
      FROM developer d
      JOIN contract c ON c.developer_id = d.developer_id
      JOIN project p ON p.project_id = c.project_id
      WHERE p.klant_id = $1 AND c.status = 'actief'
      GROUP BY d.developer_id, d.naam, d.rol, c.uurtarief, d.uurtarief
      ORDER BY d.naam
    `, [id]);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/clients/:id/developers', async (req, res) => {
  const { id } = req.params;
  const { developer_id, project_id } = req.body;
  
  console.log('[POST /api/clients/:id/developers] Body:', req.body);

  if (!developer_id || !project_id) {
    return res.status(400).json({ ok: false, error: 'developer_id en project_id verplicht' });
  }

  try {
    const devId = parseInt(developer_id);
    const projId = parseInt(project_id);

    // Fetch default uurtarief from developer
    const devRows = await q('SELECT uurtarief FROM developer WHERE developer_id = $1', [devId]);
    const rate = devRows.length ? parseFloat(devRows[0].uurtarief || 85.00) : 85.00;

    const exists = await q(`
      SELECT contract_id FROM contract 
      WHERE developer_id = $1 AND project_id = $2 AND startdatum = CURRENT_DATE
    `, [devId, projId]);

    if (!exists.length) {
      await q(`
        INSERT INTO contract (klant_id, project_id, developer_id, startdatum, status, uurtarief, uren_per_week, rol_op_project)
        VALUES ($1, $2, $3, CURRENT_DATE, 'actief', $4, 40, 'Developer')
      `, [id, projId, devId, rate]);
    }

    res.json({ ok: true, message: 'Developer gekoppeld' });
  } catch (e) {
    console.error('[POST /api/clients/:id/developers] DB Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/clients/:id/developers/:developerId', async (req, res) => {
  const { id, developerId } = req.params;
  try {
    await q(`
      DELETE FROM contract 
      WHERE developer_id = $1 
      AND project_id IN (SELECT project_id FROM project WHERE klant_id = $2)
    `, [developerId, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==============================================================================
//  DEVELOPER DASHBOARD  →  /api/developers/:id/dashboard
// ==============================================================================
app.get('/api/developers/:id/dashboard', async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Fetch all active contracts
    const contracts = await q(`
      SELECT 
        c.contract_id, 
        c.project_id,
        p.projectnaam, 
        k.naam as klant_naam, 
        c.startdatum as start_datum, 
        c.einddatum as eind_datum, 
        c.rol_op_project, 
        c.uren_per_week,
        c.uurtarief
      FROM contract c
      JOIN project p ON p.project_id = c.project_id
      JOIN klant k ON k.klant_id = c.klant_id
      WHERE c.developer_id = $1 AND c.status = 'actief'
      ORDER BY c.startdatum DESC
    `, [id]);

    // 2. Stats: Hours This Week
    const hoursWeek = await q(`
      SELECT SUM(aantal_uren) as total
      FROM urenregistratie
      WHERE developer_id = $1
      AND datum >= date_trunc('week', CURRENT_DATE)
    `, [id]);

    // 3. Stats: Active Projects Count (from active contracts)
    const projectCount = await q(`
      SELECT COUNT(DISTINCT project_id) as count
      FROM contract
      WHERE developer_id = $1 AND status = 'actief'
    `, [id]);

    // 4. Recent Timesheets (last 5)
    const recentTimesheets = await q(`
      SELECT u.uren_id as id, p.projectnaam, k.naam as klant_naam, u.datum, u.aantal_uren, u.status, u.omschrijving
      FROM urenregistratie u
      JOIN project p ON p.project_id = u.project_id
      JOIN klant k ON k.klant_id = p.klant_id
      WHERE u.developer_id = $1
      ORDER BY u.datum DESC
      LIMIT 5
    `, [id]);

    // 5. Developer Info (for welcome banner + status)
    const dev = await q('SELECT naam, weekcapaciteit, beschikbaarheid FROM developer WHERE developer_id = $1', [id]);

    // 6. Realisatie this month
    const realisatieQuery = await q(`
      WITH maand AS (
        SELECT date_trunc('month', CURRENT_DATE) as start_date,
               date_trunc('month', CURRENT_DATE) + interval '1 month' as end_date
      ),
      approved_uren AS (
        SELECT COALESCE(SUM(u.bedrag), 0) as bedrag
        FROM urenregistratie u, maand m
        WHERE u.developer_id = $1 AND u.status = 'approved'
          AND u.datum >= m.start_date AND u.datum < m.end_date
      ),
      verwacht AS (
        SELECT COALESCE(SUM(c.uren_per_week * c.uurtarief * 4), 0) as bedrag
        FROM contract c, maand m
        WHERE c.developer_id = $1 AND c.status = 'actief'
          AND c.startdatum < m.end_date
          AND (c.einddatum IS NULL OR c.einddatum >= m.start_date)
      )
      SELECT
        (SELECT bedrag FROM approved_uren) as approved_bedrag,
        (SELECT bedrag FROM verwacht) as verwacht_bedrag
    `, [id]);
    
    const realisatieData = realisatieQuery[0] || { approved_bedrag: 0, verwacht_bedrag: 0 };
    let realisatiePct = 0;
    if (parseFloat(realisatieData.verwacht_bedrag) > 0) {
      realisatiePct = Math.round((parseFloat(realisatieData.approved_bedrag) / parseFloat(realisatieData.verwacht_bedrag)) * 100);
    }

    res.json({
      ok: true,
      data: {
        devName: dev[0]?.naam || 'Developer',
        devCapacity: parseInt(dev[0]?.weekcapaciteit || 40),
        devBeschikbaarheid: dev[0]?.beschikbaarheid || 'beschikbaar',
        contracts: contracts || [],
        stats: {
          hoursThisWeek: parseFloat(hoursWeek[0]?.total || 0),
          activeProjects: parseInt(projectCount[0]?.count || 0),
          realisatiePct: realisatiePct
        },
        recentTimesheets
      }
    });
  } catch (e) {
    console.error('[GET /api/developers/:id/dashboard] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ==============================================================================
//  HEALTH CHECK
// ==============================================================================

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, message: 'Database connected ✓' }); }
  catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

// GET uploaded CV file for download
app.get('/api/cv/file/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filepath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ ok: false, error: 'Bestand niet gevonden.' });
  res.download(filepath);
});

// ==============================================================================
//  CV UPLOAD & PARSE  →  POST /api/cv/parse
//  Accepts: PDF, DOCX, TXT
//  Returns: structured CV data for preview before saving
// ==============================================================================
app.post('/api/cv/parse', upload.single('cv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Geen bestand ontvangen.' });

  try {
    let text = '';
    const mime     = req.file.mimetype;
    const filepath = req.file.path; // disk path (multer disk storage)

    if (mime === 'application/pdf') {
      const buffer = fs.readFileSync(filepath);
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdfDoc = await loadingTask.promise;
      const pages = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page    = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map(item => item.str).join(' '));
      }
      text = pages.join('\n');
    } else if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/msword'
    ) {
      const result = await mammoth.extractRawText({ path: filepath });
      text = result.value;
    } else {
      text = fs.readFileSync(filepath, 'utf-8');
    }

    if (!text || text.trim().length < 20) {
      return res.status(422).json({ ok: false, error: 'Kon geen tekst lezen uit het bestand. Zorg dat het CV niet beveiligd of gescand is.' });
    }

    const parsed = parseCV(text);
    console.log(`[CV] Parsed "${parsed.name || 'Onbekend'}" – ${parsed.skills.length} skills gevonden`);
    // Return filename so frontend can build a real download URL
    res.json({ ok: true, data: { ...parsed, savedFilename: req.file.filename, originalName: req.file.originalname } });

  } catch (e) {
    console.error('[CV] Parse error:', e.message);
    res.status(500).json({ ok: false, error: 'Fout bij het lezen van het CV: ' + e.message });
  }
});
// ── Dashboard Endpoints ────────────────────────────────────────────────────────

// GET /api/dashboard/cashflow — MTD + cumulatief totaal
app.get('/api/dashboard/cashflow', async (req, res) => {
  try {
    const [mtdRows, totaalRows] = await Promise.all([
      q('SELECT * FROM dashboard_cashflow_mtd'),
      q('SELECT * FROM dashboard_cashflow_totaal')
    ]);

    const mtdRaw   = mtdRows[0]   || {};
    const totaalRaw = totaalRows[0] || {};

    const verwacht  = parseFloat(mtdRaw.verwacht)  || 0;
    const geleverd  = parseFloat(mtdRaw.geleverd)  || 0;
    const realisatie_percentage = verwacht > 0 ? ((geleverd / verwacht) * 100).toFixed(1) : 0;

    // Maandnaam voor weergave
    const nu = new Date();
    const maandnaam = nu.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });

    res.json({
      ok: true,
      data: {
        // Legacy flat fields (backwards compat met bestaande KPI cards)
        verwacht,
        geleverd,
        gefactureerd: parseFloat(mtdRaw.gefactureerd) || 0,
        ontvangen:    parseFloat(mtdRaw.ontvangen)    || 0,
        realisatie_percentage: parseFloat(realisatie_percentage),
        // Nieuwe gestructureerde velden
        mtd: {
          verwacht,
          geleverd,
          gefactureerd: parseFloat(mtdRaw.gefactureerd) || 0,
          ontvangen:    parseFloat(mtdRaw.ontvangen)    || 0,
          maand: maandnaam
        },
        totaal: {
          ooit_gefactureerd: parseFloat(totaalRaw.ooit_gefactureerd) || 0,
          ooit_ontvangen:    parseFloat(totaalRaw.ooit_ontvangen)    || 0,
          openstaand:        parseFloat(totaalRaw.openstaand)        || 0
        }
      }
    });
  } catch (e) {
    console.error('[GET /api/dashboard/cashflow] DB Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/dashboard/per-klant
app.get('/api/dashboard/per-klant', async (req, res) => {
  try {
    const rows = await q('SELECT * FROM dashboard_per_klant_mtd');
    const data = rows.map(r => {
      const verwacht = parseFloat(r.verwacht) || 0;
      const geleverd = parseFloat(r.geleverd) || 0;
      const real_perc = verwacht > 0 ? ((geleverd / verwacht) * 100).toFixed(1) : 0;
      return {
        klant_id: r.klant_id,
        klant: r.klant,
        verwacht,
        geleverd,
        gefactureerd: parseFloat(r.gefactureerd) || 0,
        realisatie_percentage: parseFloat(real_perc)
      };
    });
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[GET /api/dashboard/per-klant] DB Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /api/facturen/klaar-om-te-genereren — Vind alle maanden met goedgekeurde uren die nog niet gefactureerd zijn
app.get('/api/facturen/klaar-om-te-genereren', async (req, res) => {
  try {
    const rows = await q(`
      SELECT u.datum, u.uren_id
      FROM urenregistratie u
      WHERE u.status = 'approved'
        AND u.factuur_id IS NULL
        AND u.uren_id NOT IN (SELECT uren_id FROM factuur_regelitem)
    `);

    const maanden = {};
    rows.forEach(u => {
      let datumStr = '';
      if (u.datum instanceof Date) {
        datumStr = u.datum.toISOString();
      } else if (typeof u.datum === 'string') {
        datumStr = u.datum;
      } else if (u.datum) {
        datumStr = String(u.datum);
      }
      const maand = datumStr.substring(0, 7); // '2026-06'
      if (maand && maand.length === 7) {
        if (!maanden[maand]) maanden[maand] = 0;
        maanden[maand]++;
      }
    });

    const resultaat = Object.entries(maanden)
      .map(([maand, aantalUren]) => ({ maand, aantalUren }))
      .sort((a, b) => b.maand.localeCompare(a.maand)); // Nieuwste eerst

    return res.json({ ok: true, maanden: resultaat });
  } catch (e) {
    console.error('[GET /api/facturen/klaar-om-te-genereren] Error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/facturen/genereer-maand — Auto-genereer facturen voor ongefactureerde approved uren
app.post('/api/facturen/genereer-maand', async (req, res) => {
  try {
    // Default = vorige maand; body kan { maand: "2026-05" } meegeven
    let maandInput = req.body?.maand;
    let maandDatum;
    if (maandInput) {
      maandDatum = new Date(maandInput + '-01');
    } else {
      const nu = new Date();
      maandDatum = new Date(nu.getFullYear(), nu.getMonth() - 1, 1);
    }
    const maandStr = maandDatum.toISOString().slice(0, 10); // "2026-05-01"

    console.log(`[genereer-maand] Genereer facturen voor maand: ${maandStr}`);

    // Stap 1: Vind klanten met ongefactureerde approved uren in die maand
    const klanten = await q(`
      SELECT DISTINCT k.klant_id, k.naam
      FROM klant k
      JOIN project p ON p.klant_id = k.klant_id
      JOIN urenregistratie u ON u.project_id = p.project_id
      WHERE u.status = 'approved'
        AND DATE_TRUNC('month', u.datum) = DATE_TRUNC('month', $1::date)
        AND u.uren_id NOT IN (SELECT fr.uren_id FROM factuur_regelitem fr)
    `, [maandStr]);

    if (klanten.length === 0) {
      return res.json({ ok: true, data: { gegenereerd: 0, resultaten: [], melding: 'Geen openstaande uren voor deze maand.' } });
    }

    const resultaten = [];

    for (const klant of klanten) {
      // Stap 2: Haal ongefactureerde uren op — alleen die met contract_id (anders geen tarief)
      const uren = await q(`
        SELECT u.uren_id, u.aantal_uren, u.bedrag,
               COALESCE(c.uurtarief, d.uurtarief) AS uurtarief,
               COALESCE(u.contract_id, c.contract_id) AS contract_id
        FROM urenregistratie u
        JOIN project p ON u.project_id = p.project_id
        LEFT JOIN contract c ON u.contract_id = c.contract_id
        LEFT JOIN developer d ON u.developer_id = d.developer_id
        WHERE p.klant_id = $1
          AND u.status = 'approved'
          AND DATE_TRUNC('month', u.datum) = DATE_TRUNC('month', $2::date)
          AND u.uren_id NOT IN (SELECT uren_id FROM factuur_regelitem)
          AND (u.bedrag IS NOT NULL OR c.uurtarief IS NOT NULL OR d.uurtarief IS NOT NULL)
      `, [klant.klant_id, maandStr]);

      if (uren.length === 0) continue;

      // Stap 3: Bereken totaal
      const totaal = uren.reduce((sum, u) => {
        const tarief = parseFloat(u.uurtarief || 0);
        const hrs    = parseFloat(u.aantal_uren || 0);
        return sum + (u.bedrag ? parseFloat(u.bedrag) : hrs * tarief);
      }, 0);

      if (totaal <= 0) continue;

      // Stap 4: Maak factuur aan
      const factuurdatum = new Date();
      const vervaldatum  = new Date(factuurdatum.getTime() + 14 * 86400000);
      const factuurRows  = await q(`
        INSERT INTO factuur (klant_id, factuurdatum, vervaldatum, totaalbedrag, betalingsstatus)
        VALUES ($1, $2, $3, $4, 'open')
        RETURNING factuur_id
      `, [klant.klant_id, factuurdatum.toISOString().slice(0,10), vervaldatum.toISOString().slice(0,10), totaal.toFixed(2)]);

      const factuurId = factuurRows[0].factuur_id;

      // Stap 5: Koppel uren als regelitems
      for (const uur of uren) {
        const tarief = parseFloat(uur.uurtarief || 85);
        const hrs    = parseFloat(uur.aantal_uren);
        await q(`
          INSERT INTO factuur_regelitem (factuur_id, uren_id, aantal_uren, uurtarief)
          VALUES ($1, $2, $3, $4)
        `, [factuurId, uur.uren_id, hrs, tarief]);
      }

      // Stap 5b: Koppel factuur_id terug naar urenregistratie
      const urenIds = uren.map(u => u.uren_id);
      await q(`
        UPDATE urenregistratie
        SET factuur_id = $1
        WHERE uren_id = ANY($2::int[])
      `, [factuurId, urenIds]);

      console.log(`[genereer-maand] Factuur ${factuurId} aangemaakt voor ${klant.naam}: €${totaal.toFixed(2)}`);
      resultaten.push({ klant: klant.naam, factuur_id: factuurId, totaal: parseFloat(totaal.toFixed(2)), regelitems: uren.length });
    }

    res.json({
      ok: true,
      data: {
        gegenereerd: resultaten.length,
        resultaten,
        melding: resultaten.length > 0
          ? `${resultaten.length} factuur${resultaten.length !== 1 ? 'en' : ''} gegenereerd.`
          : 'Geen ongefactureerde uren gevonden.'
      }
    });
  } catch (e) {
    console.error('[POST /api/facturen/genereer-maand] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PATCH /api/facturen/:id/markeer-betaald — Markeer een factuur als betaald
app.patch('/api/facturen/:id/markeer-betaald', async (req, res) => {
  const { id } = req.params;
  const betalingsdatum = req.body?.betalingsdatum || new Date().toISOString().split('T')[0];
  try {
    const rows = await q(`
      UPDATE factuur
      SET betalingsstatus = 'betaald',
          betalingsdatum  = $1
      WHERE factuur_id = $2
        AND betalingsstatus != 'betaald'
      RETURNING factuur_id, betalingsstatus, betalingsdatum, totaalbedrag
    `, [betalingsdatum, id]);

    if (rows.length === 0) {
      // Factuur bestond al als betaald, of niet gevonden — geen fout
      return res.json({ ok: true, data: null, melding: 'Factuur was al betaald of niet gevonden.' });
    }

    console.log(`[PATCH markeer-betaald] Factuur #${id} gemarkeerd als betaald op ${betalingsdatum}`);
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    console.error('[PATCH /api/facturen/:id/markeer-betaald] Error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('====================================');
  console.log(` REEMO API is running on port ${PORT}`);
  console.log(` Visit:  http://localhost:${PORT}`);
  console.log(` Health: http://localhost:${PORT}/api/health`);
  console.log('====================================');
});
