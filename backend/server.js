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

// ===== SUPER-ADMIN WAARBORG =====
const SUPER_ADMIN_EMAIL = 'bilalabubakar413@gmail.com';

const multer   = require('multer');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
const mammoth  = require('mammoth');
const { parseCV } = require('./cvParser');


// ===== AUTH (Fase 3a) — VERIFICATIE, NOG GEEN AFDWINGING =====
const SUPABASE_ISSUER   = 'https://ekldjmogkgucxdbftgmb.supabase.co/auth/v1';
const SUPABASE_JWKS_URL = 'https://ekldjmogkgucxdbftgmb.supabase.co/auth/v1/.well-known/jwks.json';

let _JWKS = null;
let _jwtVerify = null;
async function initJose() {
  if (_JWKS && _jwtVerify) return;
  const { createRemoteJWKSet, jwtVerify } = await import('jose'); // dynamische import: werkt op elke Node-versie
  _JWKS = createRemoteJWKSet(new URL(SUPABASE_JWKS_URL));
  _jwtVerify = jwtVerify;
}

async function authVerify(req, res, next) {
  if (req.method === 'OPTIONS') return next();

  // req.path is ZONDER /api ervoor (want gemount op /api)
  const PUBLIC_PATHS = ['/health'];
  const PUBLIC_PREFIXES = ['/data-management/template/'];
  if (PUBLIC_PATHS.includes(req.path)) return next();
  if (PUBLIC_PREFIXES.some(p => req.path.startsWith(p))) return next();

  const authHeader = req.headers['authorization'] || '';
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    console.log('[AUTH 3b] GEWEIGERD (geen token) op', req.originalUrl);
    return res.status(401).json({ ok: false, error: 'Niet ingelogd' });
  }
  try {
    await initJose();
    const { payload } = await _jwtVerify(token, _JWKS, { issuer: SUPABASE_ISSUER });
    req.authClaims = payload;
    req.authRole = payload.app_metadata && payload.app_metadata.role;

    if (req.authRole === 'admin') return next();

    if (req.authRole === 'developer') {
      try {
        const rows = await q('SELECT developer_id FROM developer WHERE auth_user_id = $1', [req.authClaims.sub]);
        req.myDeveloperId = rows.length ? rows[0].developer_id : null;
      } catch (e) {
        req.myDeveloperId = null;
      }

      // Uitsluiten van admin-only paths om false-positives te vermijden
      if (req.path === '/developers' || req.path === '/developers/all') {
        console.log('[AUTH 3c] developer GEWEIGERD op', req.method, req.originalUrl);
        return res.status(403).json({ ok: false, error: 'Geen toegang' });
      }

      const DEVELOPER_ALLOWED = [
        { method: 'GET',    re: /^\/developers\/[^/]+\/dashboard$/ },
        { method: 'GET',    re: /^\/developers\/[^/]+$/ },
        { method: 'PATCH',  re: /^\/developers\/[^/]+$/ },
        { method: 'PATCH',  re: /^\/developers\/[^/]+\/skills$/ },
        { method: 'GET',    re: /^\/developers\/[^/]+\/cv-url$/ },
        { method: 'GET',    re: /^\/timesheets$/ },
        { method: 'POST',   re: /^\/timesheets$/ },
        { method: 'DELETE', re: /^\/timesheets\/[^/]+$/ },
      ];

      const ok = DEVELOPER_ALLOWED.some(r => r.method === req.method && r.re.test(req.path));
      if (ok) return next();

      console.log('[AUTH 3c] developer GEWEIGERD op', req.method, req.originalUrl);
      return res.status(403).json({ ok: false, error: 'Geen toegang' });
    }

    // onbekende/ontbrekende rol
    console.log('[AUTH 3c] onbekende rol GEWEIGERD op', req.originalUrl);
    return res.status(403).json({ ok: false, error: 'Geen toegang' });
  } catch (e) {
    console.log('[AUTH 3b] GEWEIGERD (ongeldig token) op', req.originalUrl, '-', e.message);
    return res.status(401).json({ ok: false, error: 'Sessie ongeldig of verlopen' });
  }
}

app.use('/api', authVerify);
// ===== EINDE AUTH 3a =====




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


// ===== ADMIN ACCESS MANAGEMENT ENDPOINTS =====

// GET /api/admin/users - List all auth users and link them to developers (admin-only)
app.get('/api/admin/users', async (req, res) => {
  if (req.authRole !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin-rechten vereist' });
  }

  try {
    // 1. Fetch Supabase Auth users (first page, default 50 users is enough)
    const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers();
    if (usersError) {
      throw usersError;
    }

    // 2. Fetch all developer details for mapping
    const devRows = await q('SELECT developer_id, naam, email, auth_user_id FROM developer');

    // 3. Map auth users to their corresponding developer details
    const mappedUsers = users.map(user => {
      const matchingDev = devRows.find(d => d.auth_user_id && String(d.auth_user_id) === String(user.id));
      return {
        id: user.id,
        email: user.email,
        role: user.app_metadata?.role || '—',
        is_super_admin: user.email === SUPER_ADMIN_EMAIL,
        developer_naam: matchingDev ? matchingDev.naam : null
      };
    });

    res.json({ ok: true, data: mappedUsers });
  } catch (e) {
    console.error('[GET /api/admin/users]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/admin/users/invite - Invite a new user by email (admin-only)
app.post('/api/admin/users/invite', async (req, res) => {
  if (req.authRole !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin-rechten vereist' });
  }

  const { email, role } = req.body || {};

  if (!email || !role) {
    return res.status(400).json({ ok: false, error: 'E-mailadres en rol zijn verplicht' });
  }

  if (role !== 'admin' && role !== 'developer') {
    return res.status(400).json({ ok: false, error: 'Ongeldige rol opgegeven' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig e-mailadres' });
  }

  try {
    const redirectUrl = 'https://reemo-2.onrender.com/set-password';
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: redirectUrl });
    
    if (error) {
      const msg = error.message || '';
      if (error.status === 422 || msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists')) {
        return res.status(409).json({ ok: false, error: 'Er bestaat al een account met dit e-mailadres' });
      }
      throw error;
    }

    const newUserId = data?.user?.id;
    if (!newUserId) {
      return res.status(500).json({ ok: false, error: 'Uitnodiging mislukt (geen user-id terug)' });
    }

    const { error: roleError } = await supabase.auth.admin.updateUserById(newUserId, {
      app_metadata: { role }
    });
    if (roleError) {
      return res.status(500).json({ ok: false, error: roleError.message });
    }

    res.json({ ok: true, data: { id: newUserId, email, role } });
  } catch (e) {
    console.error('[POST /api/admin/users/invite]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/admin/users/reset-link - Send reset link to a user (admin-only, with super-admin protection)
app.post('/api/admin/users/reset-link', async (req, res) => {
  if (req.authRole !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin-rechten vereist' });
  }

  const { email } = req.body || {};

  if (!email) {
    return res.status(400).json({ ok: false, error: 'E-mailadres is verplicht' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ ok: false, error: 'Ongeldig e-mailadres' });
  }

  if (email === SUPER_ADMIN_EMAIL) {
    return res.status(403).json({ ok: false, error: 'Dit account is beveiligd' });
  }

  try {
    const redirectUrl = 'https://reemo-2.onrender.com/set-password';
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
    if (error) throw error;

    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/admin/users/reset-link]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// POST /api/admin/developers/:developer_id/invite - Invite a developer and link instantly (admin-only)
app.post('/api/admin/developers/:developer_id/invite', async (req, res) => {
  if (req.authRole !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin-rechten vereist' });
  }

  const { developer_id } = req.params;
  const { email: inputEmail } = req.body || {};

  try {
    // 1. Fetch developer row
    const devRows = await q('SELECT developer_id, naam, email, auth_user_id FROM developer WHERE developer_id = $1', [developer_id]);
    if (!devRows.length) {
      return res.status(404).json({ ok: false, error: 'Developer niet gevonden' });
    }
    const dev = devRows[0];

    // 2. Check if already linked
    if (dev.auth_user_id) {
      return res.status(409).json({ ok: false, error: 'Deze developer is al gekoppeld aan een account.' });
    }

    // 3. Determine email address
    let email = (inputEmail || dev.email || '').trim();
    if (!email) {
      return res.status(400).json({ ok: false, error: 'Geen e-mailadres bekend. Vul een e-mailadres in.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ ok: false, error: 'Ongeldig e-mailadres' });
    }

    // 4. Update email if changed or was null
    if (email.toLowerCase() !== (dev.email || '').toLowerCase()) {
      await q('UPDATE developer SET email = $1 WHERE developer_id = $2', [email, developer_id]);
    }

    // 5. Send invitation
    const redirectUrl = 'https://reemo-2.onrender.com/set-password';
    let newUserId = null;
    let alreadyExisted = false;

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: redirectUrl });
    
    if (error) {
      const msg = error.message || '';
      // If user already exists/registered, link to existing account (Edge C4)
      if (error.status === 422 || msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists')) {
        const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
        if (listError) throw listError;

        const existingUser = users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
        if (!existingUser) {
          return res.status(500).json({ ok: false, error: 'Er bestaat al een account met dit e-mailadres, maar kon het ID niet ophalen.' });
        }
        newUserId = existingUser.id;
        alreadyExisted = true;
      } else {
        throw error;
      }
    } else {
      newUserId = data?.user?.id;
      if (!newUserId) {
        return res.status(500).json({ ok: false, error: 'Uitnodiging mislukt (geen user-id terug)' });
      }

      // Update user metadata role to developer
      const { error: roleError } = await supabase.auth.admin.updateUserById(newUserId, {
        app_metadata: { role: 'developer' }
      });
      if (roleError) {
        return res.status(500).json({ ok: false, error: roleError.message });
      }
    }

    // 6. Link developer profile to the auth user ID
    await q('UPDATE developer SET auth_user_id = $1 WHERE developer_id = $2', [newUserId, developer_id]);

    res.json({
      ok: true,
      data: {
        developer_id,
        email,
        auth_user_id: newUserId,
        alreadyExisted
      }
    });
  } catch (e) {
    console.error('[POST /api/admin/developers/:id/invite]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// POST /api/admin/users/:id/role - Update user role (admin-only, with super-admin protection)
app.post('/api/admin/users/:id/role', async (req, res) => {
  if (req.authRole !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin-rechten vereist' });
  }

  const { id } = req.params;
  const { role } = req.body || {};

  if (role !== 'admin' && role !== 'developer') {
    return res.status(400).json({ ok: false, error: 'Ongeldige rol opgegeven' });
  }

  try {
    // 1. Fetch target user to check email before modifying
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(id);
    if (userError || !user) {
      return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden' });
    }

    // 2. Safeguard check: prevent changing the super-admin's role
    if (user.email === SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ ok: false, error: 'Dit account is beveiligd en kan niet gewijzigd worden' });
    }

    // Voorkom dat een admin zichzelf degradeert
    if (id === req.authClaims?.sub && role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Je kunt je eigen admin-rechten niet intrekken' });
    }

    // 3. Update the user role in Supabase auth metadata
    const { error: updateError } = await supabase.auth.admin.updateUserById(id, {
      app_metadata: { role }
    });
    if (updateError) {
      throw updateError;
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(`[POST /api/admin/users/${id}/role]`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// DELETE /api/admin/users/:id - Delete an auth user account (admin-only, with protection)
app.delete('/api/admin/users/:id', async (req, res) => {
  if (req.authRole !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin-rechten vereist' });
  }

  const { id } = req.params;

  try {
    // 1. Fetch target user to check email before deleting
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(id);
    if (userError || !user) {
      return res.status(404).json({ ok: false, error: 'Gebruiker niet gevonden' });
    }

    // Safeguard 1: prevent deleting the super-admin account
    if (user.email === SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ ok: false, error: 'Dit account is beveiligd en kan niet verwijderd worden' });
    }

    // Safeguard 2: prevent self-deletion
    const loggedInUid = req.authClaims?.sub;
    if (id === loggedInUid) {
      return res.status(403).json({ ok: false, error: 'Je kunt je eigen account niet verwijderen' });
    }

    // 2. Unlink the auth account from the developer table in PostgreSQL
    await q('UPDATE developer SET auth_user_id = NULL WHERE auth_user_id = $1', [id]);

    // 3. Delete the auth account from Supabase Auth
    const { error: deleteError } = await supabase.auth.admin.deleteUser(id);
    if (deleteError) {
      throw deleteError;
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(`[DELETE /api/admin/users/${id}]`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /api/admin/pin - Update admin PIN (admin-only)
app.post('/api/admin/pin', async (req, res) => {
  if (req.authRole !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin-rechten vereist' });
  }

  const { currentPin, newPin } = req.body || {};

  if (!currentPin || !newPin) {
    return res.status(400).json({ ok: false, error: 'Huidige en nieuwe PIN zijn verplicht' });
  }

  if (!/^\d{4}$/.test(newPin)) {
    return res.status(400).json({ ok: false, error: 'De PIN moet uit 4 cijfers bestaan' });
  }

  try {
    const huidig = await getAdminPin();
    if (currentPin !== huidig) {
      return res.status(403).json({ ok: false, error: 'Huidige PIN is onjuist' });
    }

    await q(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('admin_pin', $1, now()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()",
      [newPin]
    );

    res.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/admin/pin]', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
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
app.get('/set-password',    (req, res) => _serveIndex(req, res));



// ── Helper ─────────────────────────────────────────────────────────────────────
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

async function getAdminPin() {
  try {
    const rows = await q("SELECT value FROM app_settings WHERE key = 'admin_pin'");
    if (rows && rows.length && rows[0].value) return rows[0].value;
  } catch (e) {
    console.error('[getAdminPin] fout, val terug op env/default:', e.message);
  }
  return process.env.ADMIN_PIN || '2526';
}

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
             (SELECT COUNT(*) FROM developer_project dp WHERE dp.developer_id = d.developer_id AND (dp.eind_datum IS NULL OR dp.eind_datum >= CURRENT_DATE)) as project_count,
             (SELECT SUM(aantal_uren) FROM urenregistratie u WHERE u.developer_id = d.developer_id AND u.status = 'approved' AND u.datum >= date_trunc('week', CURRENT_DATE)) as uren_week,
             (SELECT SUM(dp.uren_per_week) FROM developer_project dp WHERE dp.developer_id = d.developer_id AND (dp.eind_datum IS NULL OR dp.eind_datum >= CURRENT_DATE)) as assigned_hours,
             (SELECT project_id FROM developer_project dp2 WHERE dp2.developer_id = d.developer_id LIMIT 1) as first_project_id,
             (SELECT p.klant_id FROM developer_project dp3 JOIN project p ON dp3.project_id = p.project_id WHERE dp3.developer_id = d.developer_id LIMIT 1) as first_klant_id
      FROM developer d
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

// GET current logged-in developer profile (Fase 3c-2)
app.get('/api/developers/me', async (req, res) => {
  const authUserId = req.authClaims?.sub;
  if (!authUserId) {
    return res.status(401).json({ ok: false, error: 'Geen geldige sessie gevonden' });
  }
  try {
    const rows = await q('SELECT * FROM developer WHERE auth_user_id = $1', [authUserId]);
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Geen gekoppelde developer gevonden voor dit account' });
    }
    res.json({ ok: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET single with full detail (projects, hours, cv)
app.get('/api/developers/:id', async (req, res) => {
  const { id } = req.params;
  if (req.authRole === 'developer' && (!req.myDeveloperId || String(id) !== String(req.myDeveloperId))) {
    return res.status(403).json({ ok: false, error: 'Geen toegang tot deze gegevens' });
  }
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
  if (req.authRole === 'developer' && (!req.myDeveloperId || String(id) !== String(req.myDeveloperId))) {
    return res.status(403).json({ ok: false, error: 'Geen toegang tot deze gegevens' });
  }
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


app.post('/api/developers', async (req, res) => {
  const { naam, type, rol, uurtarief, weekcapaciteit, status, skills } = req.body;
  let { email } = req.body;

  // Convert empty/whitespace string to null, or trim if valid string
  if (typeof email === 'string') {
    const trimmed = email.trim();
    email = trimmed === '' ? null : trimmed;
  } else if (!email) {
    email = null;
  }

  if (!naam || (!email && type !== 'candidate')) {
    return res.status(400).json({ ok: false, error: 'naam en email zijn verplicht' });
  }

  try {
    // Check if developer with this email already exists
    const existing = email ? await q('SELECT developer_id FROM developer WHERE email = $1', [email]) : [];

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
  if (req.authRole === 'developer' && (!req.myDeveloperId || String(id) !== String(req.myDeveloperId))) {
    return res.status(403).json({ ok: false, error: 'Geen toegang tot deze gegevens' });
  }
  const { cv_url, naam, email, rol, uurtarief, weekcapaciteit, beschikbaarheid, skills, type, status } = req.body;
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
    if (type !== undefined)           { fields.push(`type=$${i++}`);          values.push(type); }
    if (status !== undefined)         { fields.push(`status=$${i++}`);        values.push(status); }

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
  if (req.authRole === 'developer' && (!req.myDeveloperId || String(id) !== String(req.myDeveloperId))) {
    return res.status(403).json({ ok: false, error: 'Geen toegang tot deze gegevens' });
  }
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

app.get('/api/developers/:id/check-actief', async (req, res) => {
  const { id } = req.params;
  const devId = parseInt(id, 10);
  if (isNaN(devId)) {
    return res.status(400).json({ error: 'Ongeldige developer ID' });
  }
  try {
    const [contracten, urenCountResult] = await Promise.all([
      q(`
        SELECT c.contract_id, c.project_id, c.status, p.projectnaam, k.naam AS klant_naam
        FROM contract c
        LEFT JOIN project p ON c.project_id = p.project_id
        LEFT JOIN klant k ON c.klant_id = k.klant_id
        WHERE c.developer_id = $1
      `, [devId]),
      q('SELECT COUNT(*)::int FROM urenregistratie WHERE developer_id = $1', [devId])
    ]);

    const aantalUren = urenCountResult[0]?.count || 0;
    const aantalContracten = contracten.length;
    const isActief = aantalContracten > 0 || aantalUren > 0;

    res.json({
      actief: isActief,
      aantalProjecten: contracten.filter(c => c.status === 'actief').length,
      aantalContracten: aantalContracten,
      aantalUren: aantalUren,
      projecten: contracten.map(c => ({
        projectnaam: c.projectnaam || 'Onbekend project',
        klantnaam:   c.klant_naam  || 'Onbekende klant'
      }))
    });
  } catch (err) {
    console.error('[GET /api/developers/:id/check-actief] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/developers/:id', async (req, res) => {
  const { id } = req.params;
  const devId = parseInt(id, 10);
  if (isNaN(devId)) {
    return res.status(400).json({ error: 'Ongeldige developer ID' });
  }

  try {
    // 1. Haal alle uren van deze developer op
    const { data: uren, error: urenFetchErr } = await supabase
      .from('urenregistratie')
      .select('uren_id')
      .eq('developer_id', devId);
    if (urenFetchErr) {
      console.error('Fetch uren error:', urenFetchErr);
      throw urenFetchErr;
    }
    const urenIds = (uren || []).map(u => u.uren_id);

    // 2. Haal alle contracten van deze developer op
    const { data: contracts, error: contractsErr } = await supabase
      .from('contract')
      .select('contract_id')
      .eq('developer_id', devId);
    if (contractsErr) {
      console.error('Fetch contracts error:', contractsErr);
      throw contractsErr;
    }
    const contractIds = (contracts || []).map(c => c.contract_id);

    // 3. Verwijder references in timesheet_feiten
    let tsFilter = `developer_id.eq.${devId}`;
    if (contractIds.length > 0) {
      tsFilter += `,contract_id.in.(${contractIds.join(',')})`;
    }
    const { error: tsFeitenErr } = await supabase
      .from('timesheet_feiten')
      .delete()
      .or(tsFilter);
    if (tsFeitenErr) {
      console.error('Delete timesheet_feiten error:', tsFeitenErr);
      throw tsFeitenErr;
    }

    // 4. Update facturen referencing contracts to set contract_id = null
    if (contractIds.length > 0) {
      const { error: factuurErr } = await supabase
        .from('factuur')
        .update({ contract_id: null })
        .in('contract_id', contractIds);
      if (factuurErr) {
        console.error('Update factuur contract_id error:', factuurErr);
        throw factuurErr;
      }
    }

    // 5. Verwijder factuur-regelitems die naar deze uren wijzen
    if (urenIds.length > 0) {
      const { error: riErr } = await supabase.from('factuur_regelitem').delete().in('uren_id', urenIds);
      if (riErr) {
        console.error('Delete regelitems error:', riErr);
        throw riErr;
      }
    }

    // 6. Verwijder de urenregistraties
    const { error: urenDelErr } = await supabase.from('urenregistratie').delete().eq('developer_id', devId);
    if (urenDelErr) {
      console.error('Delete uren error:', urenDelErr);
      throw urenDelErr;
    }

    // 7. Verwijder contracten van deze developer
    const { error: contractDelErr } = await supabase.from('contract').delete().eq('developer_id', devId);
    if (contractDelErr) {
      console.error('Delete contract error:', contractDelErr);
      throw contractDelErr;
    }

    // 8. Verwijder developer_project koppelingen
    const { error: dpDelErr } = await supabase.from('developer_project').delete().eq('developer_id', devId);
    if (dpDelErr) {
      console.error('Delete developer_project error:', dpDelErr);
      throw dpDelErr;
    }

    // 9. Verwijder het CV-bestand uit Storage (indien aanwezig)
    const { data: dev, error: devFetchErr } = await supabase
      .from('developer').select('cv_url').eq('developer_id', devId).single();
    if (devFetchErr && devFetchErr.code !== 'PGRST116') { // PGRST116 is not found, which is fine
      console.error('Fetch developer cv error:', devFetchErr);
    }
    if (dev?.cv_url) {
      try {
        const bestandsnaam = dev.cv_url.split('/').pop();
        if (bestandsnaam && bestandsnaam.trim() !== '') {
          const { error: storageErr } = await supabase.storage.from('cvs').remove([bestandsnaam]);
          if (storageErr) console.error('Remove CV storage error:', storageErr);
        }
      } catch (err) {
        console.error('Failed to remove CV from storage during developer deletion:', err);
      }
    }

    // 10. Verwijder de developer zelf
    const { error: devDelErr } = await supabase
      .from('developer').delete().eq('developer_id', devId);
    if (devDelErr) {
      console.error('Delete developer error:', devDelErr);
      throw devDelErr;
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Developer delete fout:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================================================
//  URENREGISTRATIE  →  /api/timesheets
// ==============================================================================

// GET all  (joined with developer & project/klant for display)
app.get('/api/timesheets', async (req, res) => {
  try {
    if (req.authRole === 'developer') {
      if (!req.myDeveloperId) {
        return res.json({ ok: true, data: [] });
      }
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
        WHERE u.developer_id = $1
        ORDER BY u.datum DESC
      `, [req.myDeveloperId]);
      return res.json({ ok: true, data: rows });
    }

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
  if (req.authRole === 'developer') {
    if (!req.myDeveloperId) {
      return res.status(403).json({ ok: false, error: 'Geen toegang tot deze gegevens' });
    }
    req.body.developer_id = req.myDeveloperId;
  }
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

  // Vervang de check aantal_uren <= 8 door:
  if (!aantal_uren || aantal_uren <= 0 || aantal_uren > 40) {
    return res.status(400).json({
      ok: false,
      error: 'Voer een geldig aantal uren in (1-40 per week)'
    });
  }

  // Get weekStart and weekEind from datum
  const parts = datum.split('-');
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const day = d.getDay();
  const diff = d.getDate() - (day === 0 ? 6 : day - 1);
  const startDatum = new Date(d.setDate(diff));
  const eindDatum = new Date(startDatum);
  eindDatum.setDate(startDatum.getDate() + 6);

  const pad = (num) => String(num).padStart(2, '0');
  const formatDate = (dateObj) => `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
  
  const weekStart = formatDate(startDatum);
  const weekEind = formatDate(eindDatum);

  // Controleer of er al een timesheet is voor die week + project
  const { data: bestaand, error: checkError } = await supabase
    .from('urenregistratie')
    .select('uren_id')
    .eq('developer_id', developer_id)
    .eq('project_id', project_id)
    .gte('datum', weekStart)  // maandag van die week
    .lte('datum', weekEind);  // zondag van die week

  if (bestaand && bestaand.length > 0) {
    return res.status(400).json({
      ok: false,
      error: 'Je hebt al een timesheet ingediend voor deze week op dit project.'
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
    if (req.authRole === 'developer') {
      if (!req.myDeveloperId) {
        return res.status(403).json({ ok: false, error: 'Geen toegang tot deze gegevens' });
      }
      const ts = await q('SELECT developer_id FROM urenregistratie WHERE uren_id = $1', [id]);
      if (!ts.length || String(ts[0].developer_id) !== String(req.myDeveloperId)) {
        return res.status(403).json({ ok: false, error: 'Geen toegang tot deze gegevens' });
      }
    }
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

app.get('/api/clients/:id/check-actief', async (req, res) => {
  const id = parseInt(req.params.id);

  try {
    const { data: projecten } = await supabase
      .from('project').select('project_id, projectnaam, status').eq('klant_id', id);
    const projectIds = (projecten || []).map(p => p.project_id);

    const { data: facturen } = await supabase
      .from('factuur').select('factuur_id, totaalbedrag, betalingsstatus').eq('klant_id', id);

    let urenCount = 0, urenBedrag = 0, developers = [];
    if (projectIds.length > 0) {
      const { data: uren } = await supabase
        .from('urenregistratie').select('bedrag').in('project_id', projectIds);
      urenCount = uren?.length || 0;
      urenBedrag = (uren || []).reduce((s, u) => s + parseFloat(u.bedrag || 0), 0);

      const { data: contracten } = await supabase
        .from('contract')
        .select('developer:developer_id(naam)')
        .in('project_id', projectIds);
      developers = [...new Set((contracten || []).map(c => c.developer?.naam).filter(Boolean))];
    }

    const factuurBedrag = (facturen || []).reduce((s, f) => s + parseFloat(f.totaalbedrag || 0), 0);
    const openFacturen = (facturen || []).filter(f => ['open','verzonden'].includes(f.betalingsstatus)).length;

    res.json({
      actief: projectIds.length > 0 || (facturen?.length || 0) > 0,
      projecten: (projecten || []).map(p => ({ naam: p.projectnaam, status: p.status })),
      aantalFacturen: facturen?.length || 0,
      openFacturen,
      aantalUren: urenCount,
      totaleWaarde: factuurBedrag + urenBedrag,
      gekoppeldeDevelopers: developers
    });
  } catch (err) {
    console.error('[GET /api/clients/:id/check-actief] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  const id = parseInt(req.params.id);

  // PIN-verificatie — server-side
  const pin = req.body?.pin || req.headers['x-admin-pin'];
  const adminPin = await getAdminPin();
  if (!pin || pin !== adminPin) {
    return res.status(403).json({ error: 'Ongeldige beheerderscode' });
  }

  try {
    // Verzamel gerelateerde ids
    const { data: projecten } = await supabase
      .from('project').select('project_id').eq('klant_id', id);
    const projectIds = (projecten || []).map(p => p.project_id);

    const { data: facturen } = await supabase
      .from('factuur').select('factuur_id').eq('klant_id', id);
    const factuurIds = (facturen || []).map(f => f.factuur_id);

    let urenIds = [];
    if (projectIds.length > 0) {
      const { data: uren } = await supabase
        .from('urenregistratie').select('uren_id').in('project_id', projectIds);
      urenIds = (uren || []).map(u => u.uren_id);
    }

    let contractIds = [];
    if (projectIds.length > 0) {
      const { data: contracten } = await supabase
        .from('contract').select('contract_id').in('project_id', projectIds);
      contractIds = (contracten || []).map(c => c.contract_id);
    }

    // 1. factuur_regelitem (via factuur_id EN via uren_id)
    if (factuurIds.length > 0) {
      await supabase.from('factuur_regelitem').delete().in('factuur_id', factuurIds);
    }
    if (urenIds.length > 0) {
      await supabase.from('factuur_regelitem').delete().in('uren_id', urenIds);
    }

    // 2. timesheet_feiten (via contract_id van de betrokken contracten, EN via project_id, EN via klant_id)
    if (contractIds.length > 0) {
      await supabase.from('timesheet_feiten').delete().in('contract_id', contractIds);
    }
    if (projectIds.length > 0) {
      await supabase.from('timesheet_feiten').delete().in('project_id', projectIds);
    }
    await supabase.from('timesheet_feiten').delete().eq('klant_id', id);

    // 3. urenregistratie (zet eerst factuur_id op null waar nodig, daarna verwijderen via project_id)
    if (projectIds.length > 0) {
      await supabase.from('urenregistratie').update({ factuur_id: null }).in('project_id', projectIds);
      await supabase.from('urenregistratie').delete().in('project_id', projectIds);
    }

    // 4. factuur (VÓÓR contract)
    if (factuurIds.length > 0) {
      await supabase.from('factuur').delete().in('factuur_id', factuurIds);
    }

    // 5. contract (NA factuur)
    if (contractIds.length > 0) {
      await supabase.from('contract').delete().in('contract_id', contractIds);
    }

    // 6. developer_project (via project_id)
    if (projectIds.length > 0) {
      await supabase.from('developer_project').delete().in('project_id', projectIds);
    }

    // 7. project (via klant_id)
    await supabase.from('project').delete().eq('klant_id', id);

    // 8. dim_project / dim_klant (check eerst of er rijen zijn)
    const { data: dimProjRows } = await supabase.from('dim_project').select('project_id').eq('klant_id', id);
    if (dimProjRows && dimProjRows.length > 0) {
      await supabase.from('dim_project').delete().eq('klant_id', id);
    }
    const { data: dimKlantRows } = await supabase.from('dim_klant').select('klant_id').eq('klant_id', id);
    if (dimKlantRows && dimKlantRows.length > 0) {
      await supabase.from('dim_klant').delete().eq('klant_id', id);
    }

    // 9. Logo uit storage verwijderen indien aanwezig
    const { data: klant } = await supabase
      .from('klant').select('logo_url').eq('klant_id', id).single();
    if (klant?.logo_url) {
      const pad = klant.logo_url.split('/client-logos/')[1];
      if (pad) await supabase.storage.from('client-logos').remove([pad]);
    }

    // 10. klant zelf
    const { error } = await supabase.from('klant').delete().eq('klant_id', id);
    if (error) throw error;

    res.json({ ok: true, verwijderd: {
      projecten: projectIds.length,
      facturen: factuurIds.length,
      uren: urenIds.length
    }});
  } catch (err) {
    console.error('Klant delete fout:', err);
    res.status(500).json({ error: err.message });
  }
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

app.delete('/api/developers/:id/cv', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    // Haal cv_url op
    const { data: dev } = await supabase
      .from('developer').select('cv_url').eq('developer_id', id).single();

    // Verwijder bestand uit storage
    if (dev?.cv_url) {
      try {
        const bestandsnaam = dev.cv_url.split('/').pop();
        if (bestandsnaam && bestandsnaam.trim() !== '') {
          const { error: storageErr } = await supabase.storage.from('cvs').remove([bestandsnaam]);
          if (storageErr) console.error('Remove CV storage error:', storageErr);
        }
      } catch (err) {
        console.error('Failed to remove CV from storage during CV deletion:', err);
      }
    }

    // Zet cv_url op null (developer blijft bestaan)
    const { error } = await supabase
      .from('developer').update({ cv_url: null }).eq('developer_id', id);
    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error('CV delete fout:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==============================================================================
//  DEVELOPER DASHBOARD  →  /api/developers/:id/dashboard
// ==============================================================================
app.get('/api/developers/:id/dashboard', async (req, res) => {
  const { id } = req.params;
  if (req.authRole === 'developer' && (!req.myDeveloperId || String(id) !== String(req.myDeveloperId))) {
    return res.status(403).json({ ok: false, error: 'Geen toegang tot deze gegevens' });
  }
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

// POST – bulk upload single CV and map/create developer candidate
app.post('/api/cv-database/bulk-upload-single', storageUpload.single('cv'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Geen bestand ontvangen' });
    const naam = req.body.naam || file.originalname.replace(/\.[^/.]+$/, '');

    // Upload naar Supabase Storage
    const bestandsnaam = `${Date.now()}_${file.originalname.replace(/\s+/g, '_')}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('cvs')
      .upload(bestandsnaam, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Zoek of developer al bestaat op basis van naam
    const naamDelen = naam.trim().split(/\s+/);
    let developerId = null;

    if (naamDelen.length >= 2) {
      const { data: bestaande, error: bestaandeError } = await supabase
        .from('developer')
        .select('developer_id')
        .ilike('naam', `%${naam}%`)
        .limit(1);

      if (bestaandeError) throw bestaandeError;

      if (bestaande && bestaande.length > 0) {
        developerId = bestaande[0].developer_id;

        // Update bestaande developer met nieuwe CV (store just the filename, not public URL)
        const { error: updateError } = await supabase
          .from('developer')
          .update({ cv_url: bestandsnaam })
          .eq('developer_id', developerId);

        if (updateError) throw updateError;
      }
    }

    // Als developer niet bestaat: maak nieuwe aan
    if (!developerId) {
      const { data: nieuw, error: insertError } = await supabase
        .from('developer')
        .insert({
          naam:       naam,
          cv_url:     bestandsnaam,
          type:       'candidate',
          aangemaakt_op: new Date().toISOString()
        })
        .select('developer_id')
        .single();

      if (insertError) throw insertError;
      developerId = nieuw?.developer_id;
    }

    if (!developerId) {
      return res.status(500).json({ ok: false, error: 'Developer row could not be created/found' });
    }

    res.json({ ok: true, developer_id: developerId, cv_url: bestandsnaam });

  } catch (err) {
    console.error('Bulk upload fout:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Dashboard Endpoints ────────────────────────────────────────────────────────

// GET /api/dashboard/cashflow — filterable by period (week, maand, kwartaal, jaar)
app.get('/api/dashboard/cashflow', async (req, res) => {
  try {
    const periode = req.query.periode || 'maand';
    const nu = new Date();
    let startDatum, eindDatum;

    if (periode === 'week') {
      const dag = nu.getDay() || 7;
      startDatum = new Date(nu);
      startDatum.setDate(nu.getDate() - dag + 1);
      eindDatum = new Date(startDatum);
      eindDatum.setDate(startDatum.getDate() + 6);
    } else if (periode === 'maand') {
      startDatum = new Date(nu.getFullYear(), nu.getMonth(), 1);
      eindDatum  = new Date(nu.getFullYear(), nu.getMonth() + 1, 0);
    } else if (periode === 'kwartaal') {
      const kw = Math.floor(nu.getMonth() / 3);
      startDatum = new Date(nu.getFullYear(), kw * 3, 1);
      eindDatum  = new Date(nu.getFullYear(), kw * 3 + 3, 0);
    } else if (periode === 'jaar') {
      startDatum = new Date(nu.getFullYear(), 0, 1);
      eindDatum  = new Date(nu.getFullYear(), 11, 31);
    }

    const pad = (num) => String(num).padStart(2, '0');
    const formatDate = (dateObj) => `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;

    const start = formatDate(startDatum);
    const eind  = formatDate(eindDatum);

    let weeksMultiplier = 4;
    if (periode === 'week') {
      weeksMultiplier = 1;
    } else if (periode === 'maand') {
      weeksMultiplier = 4;
    } else if (periode === 'kwartaal') {
      weeksMultiplier = 12;
    } else if (periode === 'jaar') {
      weeksMultiplier = 52;
    }

    // 1. Verwacht — actieve contracten overlapping met periode, geschaald naar periode
    const { data: contracten } = await supabase
      .from('contract')
      .select('uren_per_week, uurtarief, startdatum, einddatum')
      .eq('status', 'actief')
      .lte('startdatum', eind)
      .or(`einddatum.gte.${start},einddatum.is.null`);
    const verwacht = (contracten || []).reduce((sum, c) =>
      sum + ((c.uren_per_week || 0) * (c.uurtarief || 0) * weeksMultiplier), 0);

    // 2. Geleverd — approved uren in periode
    const { data: urenMtd } = await supabase
      .from('urenregistratie')
      .select('bedrag')
      .eq('status', 'approved')
      .gte('datum', start)
      .lte('datum', eind);
    const geleverd = (urenMtd || []).reduce((sum, u) => sum + parseFloat(u.bedrag || 0), 0);

    // 3. Gefactureerd + Ontvangen — via factuur_regelitem → urenregistratie.datum in periode
    const { data: regelitems } = await supabase
      .from('factuur_regelitem')
      .select('factuur_id, urenregistratie(datum)')
      .gte('urenregistratie.datum', start)
      .lte('urenregistratie.datum', eind);

    // Collect unieke factuur_ids waarvan de uren in deze periode vallen
    const factuurIdsDezePeriode = [...new Set(
      (regelitems || [])
        .filter(r => r.urenregistratie && r.urenregistratie.datum)
        .map(r => r.factuur_id)
    )];

    let gefactureerd = 0;
    let ontvangen    = 0;

    if (factuurIdsDezePeriode.length > 0) {
      const { data: facturenMtd } = await supabase
        .from('factuur')
        .select('totaalbedrag, betalingsstatus')
        .in('factuur_id', factuurIdsDezePeriode);
      (facturenMtd || []).forEach(f => {
        const b = parseFloat(f.totaalbedrag || 0);
        gefactureerd += b;
        if (f.betalingsstatus === 'betaald') ontvangen += b;
      });
    }

    // 4. Cumulatief totaal (periode — sluit testfacturen zonder regelitems uit)
    const { data: regelitemsYtd } = await supabase
      .from('factuur_regelitem')
      .select('factuur_id, urenregistratie(datum)')
      .gte('urenregistratie.datum', start)
      .lte('urenregistratie.datum', eind);

    const factuurIdsYtd = [...new Set(
      (regelitemsYtd || [])
        .filter(r => r.urenregistratie && r.urenregistratie.datum)
        .map(r => r.factuur_id)
    )];

    let ooit_gefactureerd = 0;
    let ooit_ontvangen    = 0;
    let openstaand        = 0;

    if (factuurIdsYtd.length > 0) {
      const { data: facturenYtd } = await supabase
        .from('factuur')
        .select('totaalbedrag, betalingsstatus')
        .in('factuur_id', factuurIdsYtd);
      (facturenYtd || []).forEach(f => {
        const b = parseFloat(f.totaalbedrag || 0);
        ooit_gefactureerd += b;
        if (f.betalingsstatus === 'betaald') ooit_ontvangen += b;
        else openstaand += b;
      });
    }

    const realisatie_percentage = verwacht > 0
      ? parseFloat(((geleverd / verwacht) * 100).toFixed(1))
      : 0;

    function getISOWeekNumber(dObj) {
      const date = new Date(dObj.getTime());
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
      const week1 = new Date(date.getFullYear(), 0, 4);
      return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    }

    let labelText = '';
    if (periode === 'week') {
      labelText = `Week ${getISOWeekNumber(nu)}`;
    } else if (periode === 'maand') {
      labelText = nu.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
    } else if (periode === 'kwartaal') {
      const kw = Math.floor(nu.getMonth() / 3) + 1;
      labelText = `Q${kw} ${nu.getFullYear()}`;
    } else if (periode === 'jaar') {
      labelText = `${nu.getFullYear()}`;
    }

    res.json({
      ok: true,
      data: {
        verwacht,
        geleverd,
        gefactureerd,
        ontvangen,
        realisatie_percentage,
        mtd: { verwacht, geleverd, gefactureerd, ontvangen, maand: labelText },
        totaal: { ooit_gefactureerd, ooit_ontvangen, openstaand }
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

// GET /api/dashboard/omzet-trend — 6 maanden of specifieke jaar/kwartaal trend
app.get('/api/dashboard/omzet-trend', async (req, res) => {
  try {
    const jaar = parseInt(req.query.jaar) || new Date().getFullYear();
    const kwartaal = req.query.kwartaal || 'all';

    let rangeMonths = [];

    if (kwartaal === 'Q1') {
      for (let m = 0; m < 3; m++) rangeMonths.push({ year: jaar, month: m });
    } else if (kwartaal === 'Q2') {
      for (let m = 3; m < 6; m++) rangeMonths.push({ year: jaar, month: m });
    } else if (kwartaal === 'Q3') {
      for (let m = 6; m < 9; m++) rangeMonths.push({ year: jaar, month: m });
    } else if (kwartaal === 'Q4') {
      for (let m = 9; m < 12; m++) rangeMonths.push({ year: jaar, month: m });
    } else if (kwartaal === '6m') {
      const today = new Date();
      // If selected year is current year, show last 6 months up to today's month.
      // Otherwise, show last 6 months of that year (Jul-Dec)
      const referenceDate = (jaar === today.getFullYear()) ? today : new Date(jaar, 11, 31);
      for (let i = 5; i >= 0; i--) {
        const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - i, 1);
        rangeMonths.push({ year: d.getFullYear(), month: d.getMonth() });
      }
    } else {
      // all
      for (let m = 0; m < 12; m++) rangeMonths.push({ year: jaar, month: m });
    }

    const minDate = new Date(rangeMonths[0].year, rangeMonths[0].month, 1);
    const lastItem = rangeMonths[rangeMonths.length - 1];
    const maxDate = new Date(lastItem.year, lastItem.month + 1, 0, 23, 59, 59);

    const startDatum = `${minDate.getFullYear()}-${String(minDate.getMonth() + 1).padStart(2,'0')}-01`;
    const eindDatum = `${maxDate.getFullYear()}-${String(maxDate.getMonth() + 1).padStart(2,'0')}-${String(maxDate.getDate()).padStart(2,'0')}`;

    // Goedgekeurde uren ophalen
    const { data: uren, error: urenError } = await supabase
      .from('urenregistratie')
      .select('datum, bedrag')
      .eq('status', 'approved')
      .gte('datum', startDatum)
      .lte('datum', eindDatum);

    if (urenError) throw urenError;

    // Actieve contracten ophalen voor verwacht (alle actieve contracten of die overlappen met de range)
    const { data: contracten, error: contractenError } = await supabase
      .from('contract')
      .select('uren_per_week, uurtarief, startdatum, einddatum, status')
      .eq('status', 'actief');

    if (contractenError) throw contractenError;

    const labels = [];
    const werkelijk = [];
    const verwacht = [];

    const maandNamen = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];

    for (const item of rangeMonths) {
      labels.push(maandNamen[item.month]);
      
      const maandStr = `${item.year}-${String(item.month + 1).padStart(2, '0')}`;
      
      // Werkelijk
      const w = (uren || [])
        .filter(u => u.datum && u.datum.startsWith(maandStr))
        .reduce((sum, u) => sum + parseFloat(u.bedrag || 0), 0);
      werkelijk.push(Math.round(w));

      // Verwacht
      const v = (contracten || [])
        .filter(c => {
          if (!c.startdatum) return false;
          const start = new Date(c.startdatum);
          const end = c.einddatum ? new Date(c.einddatum) : new Date(2099, 11, 31);
          const startMonth = new Date(item.year, item.month, 1);
          const endMonth = new Date(item.year, item.month + 1, 0);
          return start <= endMonth && end >= startMonth;
        })
        .reduce((sum, c) => {
          const ratePerWeek = parseFloat(c.uren_per_week || 40) * parseFloat(c.uurtarief || 0);
          return sum + ratePerWeek * 4;
        }, 0);
      verwacht.push(Math.round(v));
    }

    res.json({ labels, werkelijk, verwacht });
  } catch(err) {
    console.error('Omzet trend fout:', err);
    res.status(500).json({ error: err.message });
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

// ==========================================
// DATA MANAGEMENT SECTIE 1 (IMPORT) ENDPOINTS
// ==========================================

const dmUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Kolom-herkenning: welke headers horen bij welke tabel
const SCHEMA_SIGNATURES = {
  timesheets: ['developer_naam', 'aantal_uren', 'week_startdatum'],
  facturen:   ['factuurdatum', 'totaalbedrag', 'betalingsstatus'],
  klanten:    ['naam', 'email', 'sector'],
  projecten:  ['projectnaam', 'klant_naam', 'startdatum'],
  developers: ['naam', 'uurtarief', 'weekcapaciteit']
};

// Synoniemen: veel voorkomende kolomnamen → ons schema
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
  return null; // onbekende kolom — wordt genegeerd, niet als fout behandeld
}

function normaliseerRecords(records) {
  // Hernoem alle kolommen van elk record naar het standaard schema
  const origineleHeaders = Object.keys(records[0] || {});
  const mapping = {};
  origineleHeaders.forEach(h => {
    const std = normaliseerHeader(h);
    if (std) mapping[h] = std;
  });

  const genormaliseerd = records.map(r => {
    const nieuw = {};
    for (const [orig, std] of Object.entries(mapping)) {
      nieuw[std] = r[orig];
    }
    return nieuw;
  });

  return { records: genormaliseerd, mapping, onherkend: origineleHeaders.filter(h => !mapping[h]) };
}

function detecteerTabelType(headers) {
  const genormaliseerdeHeaders = headers.map(h => normaliseerHeader(h)).filter(Boolean);
  let besteMatch = null;
  let hoogsteScore = 0;

  for (const [type, signature] of Object.entries(SCHEMA_SIGNATURES)) {
    const score = signature.filter(s => genormaliseerdeHeaders.includes(s)).length / signature.length;
    if (score > hoogsteScore) {
      hoogsteScore = score;
      besteMatch = type;
    }
  }

  return hoogsteScore >= 0.6 ? besteMatch : null; // minimaal 60% van de signature kolommen
}

function parseBestand(file) {
  const naam = file.originalname.toLowerCase();

  if (naam.endsWith('.xlsx') || naam.endsWith('.xls')) {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' });
  }

  // CSV: detecteer scheidingsteken
  const inhoud = file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
  const eersteRegel = inhoud.split('\n')[0];
  const delimiter = (eersteRegel.split(';').length > eersteRegel.split(',').length) ? ';' : ',';

  return parse(inhoud, {
    columns: true,
    delimiter,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true
  });
}

async function checkDuplicaten(tabelType, records) {
  const status = [];
  let nieuw = 0, bestaatAl = 0;

  if (tabelType === 'klanten') {
    const { data } = await supabase.from('klant').select('email, naam');
    const bestaandeEmails = new Set((data || []).map(k => (k.email || '').toLowerCase()));
    const bestaandeNamen  = new Set((data || []).map(k => (k.naam  || '').toLowerCase()));
    records.forEach(r => {
      const dup = (r.email && bestaandeEmails.has((r.email || '').toLowerCase())) ||
                  (r.naam && bestaandeNamen.has((r.naam || '').toLowerCase()));
      status.push(dup ? 'bestaat_al' : 'nieuw');
      dup ? bestaatAl++ : nieuw++;
    });
  } else if (tabelType === 'developers') {
    const { data } = await supabase.from('developer').select('email, naam');
    const bestaand = new Set((data || []).map(d => (d.email || d.naam || '').toLowerCase()));
    records.forEach(r => {
      const dup = (r.email && bestaand.has((r.email || '').toLowerCase())) ||
                  (r.naam && bestaand.has((r.naam || '').toLowerCase()));
      status.push(dup ? 'bestaat_al' : 'nieuw');
      dup ? bestaatAl++ : nieuw++;
    });
  } else if (tabelType === 'projecten') {
    const { data } = await supabase.from('project').select('projectnaam');
    const bestaand = new Set((data || []).map(p => (p.projectnaam || '').toLowerCase()));
    records.forEach(r => {
      const dup = r.projectnaam && bestaand.has((r.projectnaam || '').toLowerCase());
      status.push(dup ? 'bestaat_al' : 'nieuw');
      dup ? bestaatAl++ : nieuw++;
    });
  } else {
    // timesheets en facturen: geen duplicaatcheck op naam, alles als nieuw
    records.forEach(() => { status.push('nieuw'); nieuw++; });
  }

  return { nieuw, bestaatAl, status };
}

// Helper: vind klant of maak aan
async function vindOfMaakKlant(klantNaam, autoAangemaakt) {
  if (!klantNaam) return null;
  const { data: bestaand } = await supabase
    .from('klant').select('klant_id').ilike('naam', klantNaam.trim()).maybeSingle();
  if (bestaand) return bestaand.klant_id;

  const { data: nieuw } = await supabase.from('klant').insert({
    naam: klantNaam.trim(),
    sector: null,
    contactpersoon: null
  }).select('klant_id').single();

  autoAangemaakt.push(`Klant "${klantNaam.trim()}" automatisch aangemaakt`);
  return nieuw?.klant_id;
}

// Helper: vind developer of maak aan
async function vindOfMaakDeveloper(naam, autoAangemaakt) {
  if (!naam) return null;
  const { data: bestaand } = await supabase
    .from('developer').select('developer_id').ilike('naam', naam.trim()).maybeSingle();
  if (bestaand) return bestaand.developer_id;

  const { data: nieuw } = await supabase.from('developer').insert({
    naam: naam.trim(),
    rol: 'Developer',
    status: 'candidate',
    weekcapaciteit: 40,
    uurtarief: 0
  }).select('developer_id').single();

  autoAangemaakt.push(`Developer "${naam.trim()}" automatisch aangemaakt`);
  return nieuw?.developer_id;
}

// Helper: vind project of maak aan (voor timesheets)
async function vindOfMaakProjectForTimesheet(projectNaam, autoAangemaakt) {
  if (!projectNaam) return null;
  const { data: bestaand } = await supabase
    .from('project').select('project_id').ilike('projectnaam', projectNaam.trim()).maybeSingle();
  if (bestaand) return bestaand.project_id;

  // We hebben een klant nodig. Zoek een bestaande klant, of maak een default aan.
  let { data: klant } = await supabase.from('klant').select('klant_id').limit(1).maybeSingle();
  if (!klant) {
    const { data: nieuwKlant } = await supabase.from('klant').insert({
      naam: 'Auto-aangemaakte Klant',
      sector: 'Algemeen'
    }).select('klant_id').single();
    klant = nieuwKlant;
    autoAangemaakt.push(`Klant "Auto-aangemaakte Klant" automatisch aangemaakt`);
  }

  if (!klant) return null;

  const { data: nieuw } = await supabase.from('project').insert({
    projectnaam: projectNaam.trim(),
    klant_id: klant.klant_id,
    status: 'actief',
    type: 'T&M'
  }).select('project_id').single();

  autoAangemaakt.push(`Project "${projectNaam.trim()}" automatisch aangemaakt`);
  return nieuw?.project_id;
}

async function importeerRecords(tabelType, records, overschrijf) {
  let toegevoegd = 0, overgeslagen = 0, fouten = [];
  const autoAangemaakt = [];

  for (const r of records) {
    try {
      if (tabelType === 'klanten') {
        const klantNaam = r.naam || r.klant || r.klant_naam || r.bedrijfsnaam || r.bedrijf;
        if (!klantNaam) { fouten.push('Naam is verplicht'); continue; }
        const { data: bestaand } = await supabase.from('klant')
          .select('klant_id').ilike('naam', klantNaam.trim()).maybeSingle();
        if (bestaand && !overschrijf) { overgeslagen++; continue; }

        await supabase.from('klant').upsert({
          ...(bestaand ? { klant_id: bestaand.klant_id } : {}),
          naam: klantNaam.trim(),
          email: r.email || null,
          telefoonnummer: r.telefoonnummer || null,
          sector: r.sector || null,
          contactpersoon: r.contactpersoon || null
        });
        toegevoegd++;

      } else if (tabelType === 'projecten') {
        const projNaam = r.projectnaam || r.project_naam || r.project;
        const klantNaam = r.klant_naam || r.naam || r.klant || r.bedrijf;
        if (!projNaam) { fouten.push('Projectnaam is verplicht'); continue; }
        if (!klantNaam) { fouten.push(`Project "${projNaam}": klant_naam is verplicht`); continue; }
        
        // Zoek klant op naam, maak aan indien niet gevonden
        const klantId = await vindOfMaakKlant(klantNaam, autoAangemaakt);
        if (!klantId) { fouten.push(`Project "${projNaam}": klant "${klantNaam}" kon niet worden gevonden of aangemaakt`); continue; }

        const { data: bestaand } = await supabase.from('project')
          .select('project_id').ilike('projectnaam', projNaam.trim()).maybeSingle();
        if (bestaand && !overschrijf) { overgeslagen++; continue; }

        if (bestaand) {
          await supabase.from('project').update({
            klant_id: klantId,
            type: r.type || 'T&M',
            startdatum: r.startdatum || null,
            einddatum: r.einddatum || null,
            status: r.status || 'actief'
          }).eq('project_id', bestaand.project_id);
        } else {
          await supabase.from('project').insert({
            projectnaam: projNaam.trim(),
            klant_id: klantId,
            type: r.type || 'T&M',
            startdatum: r.startdatum || null,
            einddatum: r.einddatum || null,
            status: r.status || 'actief'
          });
        }
        toegevoegd++;

      } else if (tabelType === 'developers') {
        const devNaam = r.naam || r.developer_naam || r.developer;
        if (!devNaam) { fouten.push('Naam is verplicht'); continue; }
        const { data: bestaand } = await supabase.from('developer')
          .select('developer_id').ilike('naam', devNaam.trim()).maybeSingle();
        if (bestaand && !overschrijf) { overgeslagen++; continue; }

        await supabase.from('developer').upsert({
          ...(bestaand ? { developer_id: bestaand.developer_id } : {}),
          naam: devNaam.trim(),
          email: r.email || null,
          rol: r.rol || null,
          uurtarief: parseFloat(r.uurtarief) || 0,
          weekcapaciteit: parseInt(r.weekcapaciteit) || 40,
          status: r.status || 'available'
        });
        toegevoegd++;

      } else if (tabelType === 'facturen') {
        const klantNaam = r.klant_naam || r.naam || r.klant || r.bedrijf;
        const factuurDatum = r.factuurdatum || r.datum;
        if (!klantNaam) { fouten.push('klant_naam is verplicht'); continue; }
        if (!factuurDatum) { fouten.push('factuurdatum is verplicht'); continue; }
        
        // Zoek klant op naam, maak aan indien niet gevonden
        const klantId = await vindOfMaakKlant(klantNaam, autoAangemaakt);
        if (!klantId) { fouten.push(`Factuur ${factuurDatum}: klant "${klantNaam}" kon niet worden gevonden of aangemaakt`); continue; }

        await supabase.from('factuur').insert({
          klant_id: klantId,
          factuurdatum: factuurDatum,
          vervaldatum: r.vervaldatum || null,
          totaalbedrag: parseFloat(r.totaalbedrag) || 0,
          betalingsstatus: r.betalingsstatus || 'open',
          betalingsdatum: r.betalingsdatum || null
        });
        toegevoegd++;

      } else if (tabelType === 'timesheets') {
        const devNaam = r.developer_naam || r.naam || r.developer;
        const projNaam = r.project_naam || r.projectnaam || r.project;
        const weekStart = r.week_startdatum || r.week || r.datum;
        if (!devNaam) { fouten.push('developer_naam is verplicht'); continue; }
        if (!projNaam) { fouten.push('project_naam is verplicht'); continue; }
        if (!weekStart) { fouten.push('week_startdatum is verplicht'); continue; }

        const devId = await vindOfMaakDeveloper(devNaam, autoAangemaakt);
        if (!devId) { fouten.push(`Timesheet: developer "${devNaam}" kon niet worden gevonden of aangemaakt`); continue; }

        const projId = await vindOfMaakProjectForTimesheet(projNaam, autoAangemaakt);
        if (!projId) { fouten.push(`Timesheet: project "${projNaam}" kon niet worden gevonden of aangemaakt`); continue; }

        // Contract lookup voor bedrag (zelfde logica als normale timesheet POST)
        const { data: contract } = await supabase.from('contract')
          .select('contract_id, uurtarief')
          .eq('developer_id', devId)
          .eq('project_id', projId)
          .maybeSingle();

        await supabase.from('urenregistratie').insert({
          developer_id: devId,
          project_id: projId,
          contract_id: contract?.contract_id || null,
          datum: weekStart,
          aantal_uren: parseFloat(r.aantal_uren) || 0,
          bedrag: contract ? parseFloat(r.aantal_uren) * parseFloat(contract.uurtarief) : null,
          omschrijving: r.omschrijving || 'Historische import',
          status: r.status || 'approved',
          ingevoerd_op: new Date().toISOString()
        });
        toegevoegd++;
      }
    } catch (err) {
      fouten.push(`Fout bij rij import: ${err.message}`);
    }
  }

  return { toegevoegd, overgeslagen, autoAangemaakt, fouten: fouten.slice(0, 20) };
}

app.get('/api/data-management/template/:type', (req, res) => {
  const templates = {
    timesheets: {
      filename: 'reemo_template_timesheets.csv',
      headers: ['developer_naam', 'project_naam', 'week_startdatum', 'aantal_uren', 'omschrijving', 'status'],
      voorbeeld: ['Alex Rivera', 'SaaS Dashboard', '2026-01-05', '32', 'Sprint werk week 2', 'approved']
    },
    facturen: {
      filename: 'reemo_template_facturen.csv',
      headers: ['klant_naam', 'factuurdatum', 'vervaldatum', 'totaalbedrag', 'betalingsstatus', 'betalingsdatum'],
      voorbeeld: ['Bilal Corp', '2026-02-01', '2026-02-15', '12500.00', 'betaald', '2026-02-10']
    },
    klanten: {
      filename: 'reemo_template_klanten.csv',
      headers: ['naam', 'email', 'telefoonnummer', 'sector', 'contactpersoon'],
      voorbeeld: ['Bilal Corp', 'info@bilalcorp.nl', '0612345678', 'IT', 'Bilal']
    },
    projecten: {
      filename: 'reemo_template_projecten.csv',
      headers: ['projectnaam', 'klant_naam', 'type', 'startdatum', 'einddatum', 'status'],
      voorbeeld: ['SaaS Dashboard', 'Bilal Corp', 'T&M', '2026-01-01', '', 'actief']
    },
    developers: {
      filename: 'reemo_template_developers.csv',
      headers: ['naam', 'email', 'rol', 'uurtarief', 'weekcapaciteit', 'status'],
      voorbeeld: ['Alex Rivera', 'alex@reemo.io', 'Senior Frontend Developer', '85', '40', 'available']
    }
  };

  const t = templates[req.params.type];
  if (!t) return res.status(404).json({ error: 'Onbekend template type' });

  const csv = t.headers.join(';') + '\n' + t.voorbeeld.join(';') + '\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${t.filename}"`);
  res.send('\uFEFF' + csv); // BOM voor Excel compatibiliteit
});

app.post('/api/data-management/preview', dmUpload.array('bestanden', 50), async (req, res) => {
  try {
    const resultaten = [];

    for (const file of req.files) {
      try {
        const ruw = parseBestand(file);
        if (ruw.length === 0) {
          resultaten.push({ bestand: file.originalname, fout: 'Geen data gevonden' });
          continue;
        }

        const { records, mapping, onherkend } = normaliseerRecords(ruw);
        const headers = Object.keys(records[0] || {});
        const tabelType = req.body.type || detecteerTabelType(headers);

        if (!tabelType) {
          resultaten.push({
            bestand: file.originalname,
            fout: 'Kolomkoppen niet herkend. Gebruik een template of kies handmatig het type.',
            gevondenHeaders: Object.keys(ruw[0] || {}),
            kolomMapping: mapping,
            onherkendekolommen: onherkend
          });
          continue;
        }

        // Duplicaat-check tegen bestaande data
        const duplicaatInfo = await checkDuplicaten(tabelType, records);

        resultaten.push({
          bestand: file.originalname,
          tabelType,
          totaal: records.length,
          nieuw: duplicaatInfo.nieuw,
          bestaatAl: duplicaatInfo.bestaatAl,
          records: records.slice(0, 100), // max 100 in preview
          duplicaatStatus: duplicaatInfo.status, // array per record: 'nieuw' | 'bestaat_al'
          kolomMapping: mapping,        // bijv. { "Bedrijfsnaam": "naam", "Tel": "telefoonnummer" }
          onherkendekolommen: onherkend // bijv. ["interne notitie"]
        });
      } catch (err) {
        resultaten.push({ bestand: file.originalname, fout: `Parsefout: ${err.message}` });
      }
    }

    res.json({ resultaten });
  } catch (err) {
    console.error('Preview fout:', err);
    res.status(500).json({ error: err.message });
  }
});

const IMPORT_VOLGORDE = ['klanten', 'developers', 'projecten', 'facturen', 'timesheets'];

app.post('/api/data-management/import', dmUpload.array('bestanden', 50), async (req, res) => {
  try {
    // PIN verificatie EERST
    const pin = req.body.pin;
    const adminPin = await getAdminPin();
    if (!pin || pin !== adminPin) {
      return res.status(403).json({ error: 'Ongeldige beheerderscode' });
    }

    const overschrijfDuplicaten = req.body.overschrijf === 'true';
    const geparsed = [];
    const resultaten = [];

    for (const file of req.files) {
      try {
        const ruw = parseBestand(file);
        if (ruw.length === 0) {
          resultaten.push({ bestand: file.originalname, fout: 'Geen data gevonden' });
          continue;
        }

        const { records } = normaliseerRecords(ruw);
        const headers = Object.keys(records[0] || {});
        const tabelType = req.body.type || detecteerTabelType(headers);

        if (!tabelType) {
          resultaten.push({ bestand: file.originalname, fout: 'Type niet herkend' });
          continue;
        }

        geparsed.push({ bestand: file.originalname, file, tabelType, records });
      } catch (err) {
        resultaten.push({ bestand: file.originalname, fout: `Parsefout: ${err.message}` });
      }
    }

    // Sorteer op afhankelijkheid: klanten eerst, timesheets laatst
    geparsed.sort((a, b) =>
      IMPORT_VOLGORDE.indexOf(a.tabelType) - IMPORT_VOLGORDE.indexOf(b.tabelType)
    );

    // Verwerk in deze volgorde
    for (const item of geparsed) {
      const resultaat = await importeerRecords(item.tabelType, item.records, overschrijfDuplicaten);
      resultaten.push({ bestand: item.bestand, tabelType: item.tabelType, ...resultaat });
    }

    res.json({ resultaten });
  } catch (err) {
    console.error('Import fout:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/data-management/impact-analyse', async (req, res) => {
  try {
    const { scope, van, tot, klant_id } = req.body;

    if (scope === 'uren') {
      if (!van || !tot) return res.status(400).json({ error: 'Selecteer een van- en tot-datum' });

      const { data: uren } = await supabase
        .from('urenregistratie')
        .select('uren_id, bedrag, factuur_id')
        .gte('datum', van)
        .lte('datum', tot);

      const totaalBedrag = (uren || []).reduce((s, u) => s + parseFloat(u.bedrag || 0), 0);
      const gekoppeldAanFactuur = (uren || []).filter(u => u.factuur_id).length;

      return res.json({
        target: 'UREN',
        targetSub: `${van} t/m ${tot}`,
        aantalRecords: uren?.length || 0,
        verlies: totaalBedrag,
        cascade: gekoppeldAanFactuur > 0
          ? `${gekoppeldAanFactuur} van deze uren zijn gekoppeld aan facturen via factuur_regelitem. De regelitems worden mee verwijderd; de facturen zelf blijven bestaan maar verliezen hun onderbouwing.`
          : 'Geen van deze uren is gekoppeld aan een factuur. Geen cascade-impact.'
      });
    }

    if (scope === 'omzet') {
      if (!van || !tot) return res.status(400).json({ error: 'Selecteer een van- en tot-datum' });

      const { data: facturen } = await supabase
        .from('factuur')
        .select('factuur_id, totaalbedrag')
        .gte('factuurdatum', van)
        .lte('factuurdatum', tot);

      const factuurIds = (facturen || []).map(f => f.factuur_id);
      let regelitems = 0;
      if (factuurIds.length > 0) {
        const { count } = await supabase
          .from('factuur_regelitem')
          .select('*', { count: 'exact', head: true })
          .in('factuur_id', factuurIds);
        regelitems = count || 0;
      }

      const totaalBedrag = (facturen || []).reduce((s, f) => s + parseFloat(f.totaalbedrag || 0), 0);

      return res.json({
        target: 'OMZET',
        targetSub: `${van} t/m ${tot}`,
        aantalRecords: facturen?.length || 0,
        verlies: totaalBedrag,
        cascade: regelitems > 0
          ? `${regelitems} factuur-regelitems worden mee verwijderd. De gekoppelde uren krijgen factuur_id = null en worden weer factureerbaar.`
          : 'Geen regelitems gekoppeld. Alleen de factuurrecords worden verwijderd.'
      });
    }

    if (scope === 'klant') {
      if (!klant_id) return res.status(400).json({ error: 'Selecteer eerst een klant' });

      const { data: klant } = await supabase
        .from('klant').select('naam').eq('klant_id', klant_id).single();

      const { data: projecten } = await supabase
        .from('project').select('project_id').eq('klant_id', klant_id);
      const projectIds = (projecten || []).map(p => p.project_id);

      let urenCount = 0, urenBedrag = 0, contractCount = 0;
      if (projectIds.length > 0) {
        const { data: uren } = await supabase
          .from('urenregistratie').select('bedrag').in('project_id', projectIds);
        urenCount = uren?.length || 0;
        urenBedrag = (uren || []).reduce((s, u) => s + parseFloat(u.bedrag || 0), 0);

        const { count: cc } = await supabase
          .from('contract').select('*', { count: 'exact', head: true })
          .in('project_id', projectIds);
        contractCount = cc || 0;
      }

      const { data: facturen } = await supabase
        .from('factuur').select('factuur_id, totaalbedrag').eq('klant_id', klant_id);
      const factuurBedrag = (facturen || []).reduce((s, f) => s + parseFloat(f.totaalbedrag || 0), 0);

      const { count: tfCount } = await supabase
        .from('timesheet_feiten').select('*', { count: 'exact', head: true })
        .eq('klant_id', klant_id);
      const timesheetFeitenCount = tfCount || 0;

      const totaalRecords = 1 + projectIds.length + urenCount + contractCount + (facturen?.length || 0) + timesheetFeitenCount;

      return res.json({
        target: 'KLANT',
        targetSub: klant?.naam || 'Onbekend',
        aantalRecords: totaalRecords,
        verlies: factuurBedrag + urenBedrag,
        cascade: `Cascade verwijdert: ${projectIds.length} project(en), ${contractCount} contract(en), ${timesheetFeitenCount} timesheet-feit(en), ${urenCount} urenregistratie(s), ${facturen?.length || 0} factu(u)r(en) inclusief regelitems, en het klantdossier zelf. Developers blijven bestaan maar verliezen hun koppeling met deze klant.`
      });
    }

    if (scope === 'cvs') {
      let query = supabase.from('developer').select('developer_id, cv_url').not('cv_url', 'is', null);
      if (req.body.cvKeuze !== 'alle') {
        query = query.or('type.eq.candidate,type.is.null');
      }
      const { data: devs } = await query;

      return res.json({
        target: "CV'S",
        targetSub: req.body.cvKeuze === 'alle' ? 'Alle developers' : 'Alleen kandidaten',
        aantalRecords: devs?.length || 0,
        verlies: 0,
        cascade: `${devs?.length || 0} CV-bestanden worden uit de opslag verwijderd. De developer-records zelf blijven volledig bestaan; alleen het cv_url veld wordt leeggemaakt.`
      });
    }

    if (scope === 'reset') {
      return res.status(403).json({ error: 'System Reset is uitgeschakeld door de beheerder' });
    }

    return res.status(400).json({ error: 'Onbekende scope' });
  } catch (err) {
    console.error('Impact analyse fout:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/data-management/vernietig', async (req, res) => {
  try {
    const { scope, van, tot, klant_id, pin, bevestiging } = req.body;

    // Beveiligingschecks — ALTIJD server-side
    const adminPin = await getAdminPin();
    if (!pin || pin !== adminPin) {
      return res.status(403).json({ error: 'Ongeldige beheerderscode' });
    }
    if (bevestiging !== 'VERWIJDER') {
      return res.status(403).json({ error: 'Bevestigingstekst onjuist' });
    }
    if (scope === 'reset') {
      return res.status(403).json({ error: 'System Reset is uitgeschakeld door de beheerder' });
    }

    let verwijderd = {};

    if (scope === 'uren') {
      if (!van || !tot) return res.status(400).json({ error: 'Periode ontbreekt' });

      // Eerst de uren-ids ophalen
      const { data: uren } = await supabase
        .from('urenregistratie').select('uren_id')
        .gte('datum', van).lte('datum', tot);
      const urenIds = (uren || []).map(u => u.uren_id);

      if (urenIds.length > 0) {
        // 1. Regelitems die naar deze uren wijzen
        const { count: ri } = await supabase
          .from('factuur_regelitem')
          .delete({ count: 'exact' })
          .in('uren_id', urenIds);
        // 2. De uren zelf
        const { count: u } = await supabase
          .from('urenregistratie')
          .delete({ count: 'exact' })
          .in('uren_id', urenIds);
        verwijderd = { regelitems: ri || 0, uren: u || 0 };
      } else {
        verwijderd = { regelitems: 0, uren: 0 };
      }
    }

    if (scope === 'omzet') {
      if (!van || !tot) return res.status(400).json({ error: 'Periode ontbreekt' });

      const { data: facturen } = await supabase
        .from('factuur').select('factuur_id')
        .gte('factuurdatum', van).lte('factuurdatum', tot);
      const factuurIds = (facturen || []).map(f => f.factuur_id);

      if (factuurIds.length > 0) {
        // 1. Ontkoppel uren (factuur_id terug naar null → weer factureerbaar)
        await supabase.from('urenregistratie')
          .update({ factuur_id: null })
          .in('factuur_id', factuurIds);
        // 2. Regelitems
        const { count: ri } = await supabase
          .from('factuur_regelitem')
          .delete({ count: 'exact' })
          .in('factuur_id', factuurIds);
        // 3. Facturen
        const { count: f } = await supabase
          .from('factuur')
          .delete({ count: 'exact' })
          .in('factuur_id', factuurIds);
        verwijderd = { regelitems: ri || 0, facturen: f || 0 };
      } else {
        verwijderd = { regelitems: 0, facturen: 0 };
      }
    }

    if (scope === 'klant') {
      if (!klant_id) return res.status(400).json({ error: 'Klant ontbreekt' });

      // Verzamel alle gerelateerde ids
      const { data: projecten } = await supabase
        .from('project').select('project_id').eq('klant_id', klant_id);
      const projectIds = (projecten || []).map(p => p.project_id);

      const { data: facturen } = await supabase
        .from('factuur').select('factuur_id').eq('klant_id', klant_id);
      const factuurIds = (facturen || []).map(f => f.factuur_id);

      let urenIds = [];
      if (projectIds.length > 0) {
        const { data: uren } = await supabase
          .from('urenregistratie').select('uren_id').in('project_id', projectIds);
        urenIds = (uren || []).map(u => u.uren_id);
      }

      let contractIds = [];
      if (projectIds.length > 0) {
        const { data: contracten } = await supabase
          .from('contract').select('contract_id').in('project_id', projectIds);
        contractIds = (contracten || []).map(c => c.contract_id);
      }

      // 1. factuur_regelitem (via factuur_id EN via uren_id)
      if (factuurIds.length > 0) {
        await supabase.from('factuur_regelitem').delete().in('factuur_id', factuurIds);
      }
      if (urenIds.length > 0) {
        await supabase.from('factuur_regelitem').delete().in('uren_id', urenIds);
      }

      // 2. timesheet_feiten (via contract_id van de betrokken contracten, EN via project_id, EN via klant_id)
      if (contractIds.length > 0) {
        await supabase.from('timesheet_feiten').delete().in('contract_id', contractIds);
      }
      if (projectIds.length > 0) {
        await supabase.from('timesheet_feiten').delete().in('project_id', projectIds);
      }
      await supabase.from('timesheet_feiten').delete().eq('klant_id', klant_id);

      // 3. urenregistratie (zet eerst factuur_id op null waar nodig, daarna verwijderen via project_id)
      if (projectIds.length > 0) {
        await supabase.from('urenregistratie').update({ factuur_id: null }).in('project_id', projectIds);
        await supabase.from('urenregistratie').delete().in('project_id', projectIds);
      }

      // 4. factuur (VÓÓR contract)
      if (factuurIds.length > 0) {
        await supabase.from('factuur').delete().in('factuur_id', factuurIds);
      }

      // 5. contract (NA factuur)
      if (contractIds.length > 0) {
        await supabase.from('contract').delete().in('contract_id', contractIds);
      }

      // 6. developer_project (via project_id)
      if (projectIds.length > 0) {
        await supabase.from('developer_project').delete().in('project_id', projectIds);
      }

      // 7. project (via klant_id)
      await supabase.from('project').delete().eq('klant_id', klant_id);

      // 8. dim_project / dim_klant (check eerst of er rijen zijn)
      const { data: dimProjRows } = await supabase.from('dim_project').select('project_id').eq('klant_id', klant_id);
      if (dimProjRows && dimProjRows.length > 0) {
        await supabase.from('dim_project').delete().eq('klant_id', klant_id);
      }
      const { data: dimKlantRows } = await supabase.from('dim_klant').select('klant_id').eq('klant_id', klant_id);
      if (dimKlantRows && dimKlantRows.length > 0) {
        await supabase.from('dim_klant').delete().eq('klant_id', klant_id);
      }

      // 9. Logo uit storage verwijderen indien aanwezig
      const { data: klant } = await supabase
        .from('klant').select('logo_url').eq('klant_id', klant_id).single();
      if (klant?.logo_url) {
        const pad = klant.logo_url.split('/client-logos/')[1];
        if (pad) await supabase.storage.from('client-logos').remove([pad]);
      }

      // 10. klant zelf
      await supabase.from('klant').delete().eq('klant_id', klant_id);

      verwijderd = {
        projecten: projectIds.length,
        uren: urenIds.length,
        facturen: factuurIds.length,
        klant: 1
      };
    }

    if (scope === 'cvs') {
      let query = supabase.from('developer').select('developer_id, cv_url').not('cv_url', 'is', null);
      if (req.body.cvKeuze !== 'alle') {
        query = query.or('type.eq.candidate,type.is.null');
      }
      const { data: devs } = await query;

      let verwijderdeBestanden = 0;
      for (const d of (devs || [])) {
        if (d.cv_url) {
          const pad = d.cv_url.includes('/developer-cvs/') ? d.cv_url.split('/developer-cvs/')[1] : d.cv_url;
          if (pad) {
            await supabase.storage.from('cvs').remove([pad]);
            verwijderdeBestanden++;
          }
        }
      }

      // Zet alle cv_url velden op null
      const ids = (devs || []).map(d => d.developer_id);
      if (ids.length > 0) {
        await supabase.from('developer').update({ cv_url: null }).in('developer_id', ids);
      }

      verwijderd = { cvBestanden: verwijderdeBestanden };
    }

    console.log(`[DATA-MANAGEMENT] Vernietiging uitgevoerd — scope: ${scope}`, verwijderd);
    res.json({ ok: true, verwijderd });

  } catch (err) {
    console.error('Vernietig fout:', err);
    res.status(500).json({ error: err.message });
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
