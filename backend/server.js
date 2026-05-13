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

app.get('/api/uren-per-klant', async (req, res) => {
  try { res.json({ ok: true, data: await q('SELECT * FROM v_uren_per_klant ORDER BY 2 DESC') }); }
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
    const rows = await q('SELECT * FROM klant ORDER BY naam');
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
      q(`SELECT p.*, COUNT(dp.developer_id) AS developer_count
         FROM project p
         LEFT JOIN developer_project dp ON dp.project_id = p.project_id
         WHERE p.klant_id=$1
         GROUP BY p.project_id ORDER BY p.startdatum DESC`, [id]),

      q(`SELECT COALESCE(SUM(u.aantal_uren),0) AS totaal_uren,
                COALESCE(SUM(u.bedrag),0)       AS totaal_bedrag
         FROM urenregistratie u
         JOIN project p ON p.project_id = u.project_id
         WHERE p.klant_id=$1 AND u.status = 'approved'`, [id]),

      q(`SELECT * FROM factuur WHERE klant_id=$1 ORDER BY factuurdatum DESC`, [id]),
    ]);

    // Get developers linked to this client via developer_project → project
    const devs = await q(
      `SELECT DISTINCT d.developer_id, d.naam, d.rol, d.uurtarief,
              SUM(u.aantal_uren) FILTER (WHERE date_trunc('month', u.datum)=date_trunc('month', CURRENT_DATE)) AS uren_maand
       FROM developer d
       JOIN developer_project dp ON dp.developer_id = d.developer_id
       JOIN project p            ON p.project_id = dp.project_id
       LEFT JOIN urenregistratie u ON u.developer_id = d.developer_id AND u.project_id = p.project_id
       WHERE p.klant_id=$1
       GROUP BY d.developer_id, d.naam, d.rol, d.uurtarief`, [id]);

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
      SELECT d.*, 
             (SELECT COUNT(*) FROM developer_project dp WHERE dp.developer_id = d.developer_id) as project_count,
             (SELECT SUM(aantal_uren) FROM urenregistratie u WHERE u.developer_id = d.developer_id AND u.status = 'approved' AND u.datum >= date_trunc('week', CURRENT_DATE)) as uren_week,
             (SELECT project_id FROM developer_project dp2 WHERE dp2.developer_id = d.developer_id LIMIT 1) as first_project_id,
             (SELECT p.klant_id FROM project p JOIN developer_project dp3 ON dp3.project_id = p.project_id WHERE dp3.developer_id = d.developer_id LIMIT 1) as first_klant_id
      FROM developer d
      ORDER BY d.naam
    `);
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
      q(`SELECT p.*, k.naam AS klant_naam
         FROM project p
         JOIN developer_project dp ON dp.project_id = p.project_id
         JOIN klant k ON k.klant_id = p.klant_id
         WHERE dp.developer_id=$1
         ORDER BY p.startdatum DESC`, [id]),

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
  const { naam, email, type, rol, uurtarief, weekcapaciteit } = req.body;
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
         SET naam=$1, rol=$2, uurtarief=$3, weekcapaciteit=$4, type=$5
         WHERE email=$6
         RETURNING *`,
        [naam, rol || null, uurtarief || null, weekcapaciteit || 40, type || 'ZZP', email]
      );
    } else {
      // INSERT new developer
      rows = await q(
        `INSERT INTO developer (naam, email, type, rol, uurtarief, weekcapaciteit)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [naam, email, type || 'ZZP', rol || null, uurtarief || null, weekcapaciteit || 40]
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

// PATCH – update developer (specifically for cv_url)
app.patch('/api/developers/:id', async (req, res) => {
  const { id } = req.params;
  const { cv_url, naam, email, rol, uurtarief, weekcapaciteit } = req.body;
  try {
    const fields = [];
    const values = [];
    let i = 1;

    if (cv_url !== undefined) { fields.push(`cv_url=$${i++}`); values.push(cv_url); }
    if (naam !== undefined) { fields.push(`naam=$${i++}`); values.push(naam); }
    if (email !== undefined) { fields.push(`email=$${i++}`); values.push(email); }
    if (rol !== undefined) { fields.push(`rol=$${i++}`); values.push(rol); }
    if (uurtarief !== undefined) { fields.push(`uurtarief=$${i++}`); values.push(uurtarief); }
    if (weekcapaciteit !== undefined) { fields.push(`weekcapaciteit=$${i++}`); values.push(weekcapaciteit); }

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

// POST – log hours (auto-berekent bedrag via developer uurtarief)
app.post('/api/timesheets', async (req, res) => {
  const { developer_id, project_id, datum, aantal_uren, bedrag, omschrijving } = req.body;
  if (!developer_id || !datum || !aantal_uren)
    return res.status(400).json({ ok: false, error: 'developer_id, datum en aantal_uren zijn verplicht' });
  try {
    // Auto-bereken bedrag op basis van developer uurtarief als niet meegegeven
    let finalBedrag = bedrag || null;
    if (!finalBedrag || finalBedrag === 0) {
      const devRows = await q('SELECT uurtarief FROM developer WHERE developer_id=$1', [developer_id]);
      if (devRows.length && devRows[0].uurtarief) {
        finalBedrag = parseFloat(devRows[0].uurtarief) * parseFloat(aantal_uren);
      }
    }
    const rows = await q(
      `INSERT INTO urenregistratie (developer_id, project_id, datum, aantal_uren, bedrag, omschrijving, status)
       VALUES ($1,$2,$3,$4,$5,$6,'pending') RETURNING *`,
      [developer_id, project_id || null, datum, aantal_uren, finalBedrag, omschrijving || null]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
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
      SELECT p.project_id, p.projectnaam, k.naam AS klant_naam
      FROM developer_project dp
      JOIN project p ON p.project_id = dp.project_id
      JOIN klant k ON k.klant_id = p.klant_id
      WHERE dp.developer_id = $1 AND p.status = 'Actief'
      ORDER BY p.projectnaam
    `, [id]);
    res.json({ ok: true, data: rows });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/developer-projects', async (req, res) => {
  const { developer_id, project_id, rol_op_project, startdatum, einddatum } = req.body;
  
  console.log('[POST /api/developer-projects] Body:', req.body);

  if (!developer_id || !project_id || !startdatum) {
    return res.status(400).json({ ok: false, error: 'developer_id, project_id, and startdatum are required' });
  }

  try {
    const devId = parseInt(developer_id);
    const projId = parseInt(project_id);

    // Using ON CONFLICT to avoid errors if already linked
    // Corrected column names to start_datum and eind_datum
    await q(`
      INSERT INTO developer_project (developer_id, project_id, rol_op_project, start_datum, eind_datum)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (developer_id, project_id) DO NOTHING
    `, [devId, projId, rol_op_project || 'Developer', startdatum, einddatum || null]);

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

// GET – developers NOT yet linked to any project of this client
app.get('/api/clients/:id/available-developers', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await q(`
      SELECT d.developer_id, d.naam, d.rol, d.uurtarief
      FROM developer d
      WHERE d.developer_id NOT IN (
        SELECT DISTINCT dp.developer_id
        FROM developer_project dp
        JOIN project p ON p.project_id = dp.project_id
        WHERE p.klant_id = $1
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
      SELECT DISTINCT d.developer_id, d.naam, d.rol, d.uurtarief,
        COALESCE(json_agg(json_build_object('project_id', p.project_id, 'projectnaam', p.projectnaam)) FILTER (WHERE p.project_id IS NOT NULL), '[]') as projecten
      FROM developer d
      JOIN developer_project dp ON dp.developer_id = d.developer_id
      JOIN project p ON p.project_id = dp.project_id
      WHERE p.klant_id = $1
      GROUP BY d.developer_id, d.naam, d.rol, d.uurtarief
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

    // Using ON CONFLICT to avoid errors if already linked
    // Removed RETURNING * as it's a composite key table without 'id'
    await q(`
      INSERT INTO developer_project (developer_id, project_id, start_datum)
      VALUES ($1, $2, CURRENT_DATE)
      ON CONFLICT (developer_id, project_id) DO NOTHING
    `, [devId, projId]);

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
      DELETE FROM developer_project 
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
    // 1. Current Assignment (JOIN project and klant)
    const assignment = await q(`
      SELECT p.projectnaam, k.naam as klant_naam, dp.start_datum, dp.rol_op_project, d.weekcapaciteit
      FROM developer_project dp
      JOIN project p ON p.project_id = dp.project_id
      JOIN klant k ON k.klant_id = p.klant_id
      JOIN developer d ON d.developer_id = dp.developer_id
      WHERE dp.developer_id = $1
      ORDER BY dp.start_datum DESC
      LIMIT 1
    `, [id]);

    // 2. Stats: Hours This Week
    const hoursWeek = await q(`
      SELECT SUM(aantal_uren) as total
      FROM urenregistratie
      WHERE developer_id = $1
      AND datum >= date_trunc('week', CURRENT_DATE)
    `, [id]);

    // 3. Stats: Active Projects Count
    const projectCount = await q(`
      SELECT COUNT(DISTINCT project_id) as count
      FROM developer_project
      WHERE developer_id = $1
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

    // 5. Developer Info (for welcome banner)
    const dev = await q('SELECT naam FROM developer WHERE developer_id = $1', [id]);

    res.json({
      ok: true,
      data: {
        devName: dev[0]?.naam || 'Developer',
        assignment: assignment[0] || null,
        stats: {
          hoursThisWeek: parseFloat(hoursWeek[0]?.total || 0),
          activeProjects: parseInt(projectCount[0]?.count || 0),
          pendingInvoices: 0 // Placeholder as invoices aren't directly linked to developers yet
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


// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('====================================');
  console.log(` REEMO API is running on port ${PORT}`);
  console.log(` Visit:  http://localhost:${PORT}`);
  console.log(` Health: http://localhost:${PORT}/api/health`);
  console.log('====================================');
});
