// ============================================================
//  REEMO – API-backed state
//  All reads/writes go to the Express backend → Supabase.
//  Seed data is only used as a fallback when the API is down.
// ============================================================

// Initialize Supabase Client
const sbClient = supabase.createClient(
    'https://ekldjmogkgucxdbftgmb.supabase.co',
    'sb_publishable_s974HGAthUiBPrPUGS4nDw_xe4yyXd1'
);

function genId(p) { return p + Date.now() + Math.random().toString(36).slice(2,5); }

// ── In-memory cache (populated by load* functions on page load) ───────────────
let clients    = [];
let developers = [];
let timesheets = [];
let cvs        = [];           // CV database still uses localStorage (no DB table yet)
let invoices   = [];
let activeDeveloper = null;

const CV_CONVERTER_ENABLED = false;

// ── CV Upload modal state (var = always hoisted, never causes TDZ errors) ──────
var _cvParsedSkills  = [];
var _cvSavedFilename = null;
var _cvOriginalName  = null;
var _cvFile          = null; // Added to store the actual File object

// ── Seed fallbacks (used when API is unreachable) ─────────────────────────────
const _DEF_CLIENTS = [
    { id:'c1', naam:'Acme Corp',     sector:'E-commerce', contactpersoon:'John Doe',     email:'john@acme.com',     developersCount:4, totalHoursMonth:640, invoiceStatus:'Paid'    },
    { id:'c2', naam:'Globex',        sector:'Fintech',    contactpersoon:'Jane Smith',   email:'jane@globex.com',   developersCount:2, totalHoursMonth:320, invoiceStatus:'Open'    },
    { id:'c3', naam:'Soylent Corp',  sector:'Health',     contactpersoon:'Bob Brown',    email:'bob@soylent.com',   developersCount:3, totalHoursMonth:480, invoiceStatus:'Overdue' },
    { id:'c4', naam:'Initech',       sector:'Software',   contactpersoon:'Bill Lumbergh',email:'bill@initech.com',  developersCount:5, totalHoursMonth:800, invoiceStatus:'Paid'    },
    { id:'c5', naam:'Umbrella Corp', sector:'Biotech',    contactpersoon:'Albert Wesker',email:'albert@umbrella.com',developersCount:1, totalHoursMonth:160, invoiceStatus:'Open'   },
];
const _DEF_DEVS = [
    { id:'d1', naam:'Alex Rivera',   rol:'Senior Frontend',   uurtarief:85,  weekcapaciteit:40, email:'alex@reemo.io'   },
    { id:'d2', naam:'Sarah Chen',    rol:'Fullstack Engineer', uurtarief:95,  weekcapaciteit:40, email:'sarah@reemo.io'  },
    { id:'d3', naam:'Marcus Thorne', rol:'Backend Developer',  uurtarief:75,  weekcapaciteit:40, email:'marcus@reemo.io' },
    { id:'d4', naam:'Elena Vance',   rol:'DevOps Architect',   uurtarief:110, weekcapaciteit:40, email:'elena@reemo.io'  },
    { id:'d5', naam:'Jordan Smith',  rol:'Junior Developer',   uurtarief:65,  weekcapaciteit:40, email:'jordan@reemo.io' },
];
const _DEF_TS = [
    { id:'t1', developerName:'Alex Rivera',   clientName:'Acme Corp',    hoursWorked:40, status:'Approved', date:'2024-03-10', description:'Developed new checkout flow'        },
    { id:'t2', developerName:'Sarah Chen',    clientName:'Globex',       hoursWorked:38, status:'Pending',  date:'2024-03-11', description:'API integration for payment gateway' },
    { id:'t3', developerName:'Marcus Thorne', clientName:'Soylent Corp', hoursWorked:40, status:'Approved', date:'2024-03-12', description:'Database optimization'               },
    { id:'t4', developerName:'Elena Vance',   clientName:'Acme Corp',    hoursWorked:42, status:'Rejected', date:'2024-03-13', description:'Infrastructure setup'               },
];
const _DEF_INV = [
    { id:'i1', clientName:'Acme Corp',    amount:12500, status:'Paid',    dateSent:'2024-02-28', paymentDeadline:'2024-03-15' },
    { id:'i2', clientName:'Globex',       amount:8400,  status:'Open',    dateSent:'2024-03-01', paymentDeadline:'2024-03-15' },
    { id:'i3', clientName:'Soylent Corp', amount:15000, status:'Overdue', dateSent:'2024-02-15', paymentDeadline:'2024-03-01' },
];

// CV database: still localStorage until a cvs table exists
const _DEF_CVS = [
    { id:'cv1', name:'Thomas Anderson', skills:['React','Node.js','TypeScript'], uploadDate:'2024-03-20', status:'ORIGINAL', cv_url: 'uploads/thomas_anderson_cv.pdf' },
    { id:'cv2', name:'Trinity Knight',  skills:['Python','Django','AWS'],        uploadDate:'2024-03-21', status:'REEMO FORMAT', cv_url: 'uploads/trinity_knight_cv.pdf' },
    { id:'cv3', name:'Morpheus Dream',  skills:['Kubernetes','Docker','Go'],     uploadDate:'2024-03-22', status:'ORIGINAL', cv_url: 'uploads/morpheus_dream_cv.pdf' },
    { id:'cv4', name:'Niobe Captain',   skills:['Java','Spring Boot','SQL'],     uploadDate:'2024-03-23', status:'REEMO FORMAT', cv_url: 'uploads/niobe_captain_cv.pdf' },
    { id:'cv5', name:'Cypher Traitor',  skills:['PHP','Laravel','Vue.js'],       uploadDate:'2024-03-24', status:'ORIGINAL', cv_url: 'uploads/cypher_traitor_cv.pdf' },
];
function _ls(k, d) { try { const v=localStorage.getItem(k); return v?JSON.parse(v):JSON.parse(JSON.stringify(d)); } catch{return JSON.parse(JSON.stringify(d));} }
function _lss(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
cvs = _ls('reemo_cvs', _DEF_CVS);
// Ensure all loaded CVs have a cv_url
let _needsSave = false;
cvs.forEach(c => {
    if (!c.cv_url) {
        c.cv_url = 'uploads/' + (c.name || 'cv').toLowerCase().replace(/\s+/g, '_') + '.pdf';
        _needsSave = true;
    }
});
function saveCVs() { _lss('reemo_cvs', cvs); }
if (_needsSave) saveCVs();

// ── Generic API fetch helper ──────────────────────────────────────────────────
// Also translates PostgreSQL errors to Dutch user-friendly messages
const FK_ERRORS = {
    'violates foreign key constraint': 'De gekoppelde record bestaat niet (controleer of de klant/developer/project bestaat).',
    'violates not-null constraint':    'Een verplicht veld ontbreekt. Vul alle velden in.',
    'duplicate key value':             'Er bestaat al een record met deze gegevens.',
};
async function apiFetch(path, options = {}) {
    try {
        const r = await fetch(path, {
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            ...options
        });
        const json = await r.json();
        if (!r.ok || !json.ok) {
            const raw = (json.error || r.statusText || '').toLowerCase();
            const dutch = Object.entries(FK_ERRORS).find(([k]) => raw.includes(k))?.[1]
                || json.error || 'Onbekende fout — probeer het opnieuw.';
            console.warn('[API]', path, json.error);
            throw new Error(dutch);
        }
        return json.data ?? json;
    } catch (e) {
        console.warn('[API]', path, e.message);
        throw e;
    }
}

// Safe wrapper — returns null on failure, no throw
async function apiFetchSafe(path, opts = {}) {
    try { return await apiFetch(path, opts); }
    catch { return null; }
}

// ── Load functions (fetch from DB, fall back to seed) ─────────────────────────
async function loadClients() {
    const data = await apiFetchSafe('/api/klanten');
    clients = data ? data.map(r => ({
        id: r.klant_id, 
        klant_id: r.klant_id,
        naam: r.naam, 
        name: r.naam,
        contactPerson: r.contactpersoon, 
        contactpersoon: r.contactpersoon,
        email: r.email, 
        sector: r.sector, 
        industry: r.sector,
        telefoonnummer: r.telefoonnummer,
        logo_url: r.logo_url,
        project_count: parseInt(r.project_count) || 0,
        developer_count: parseInt(r.developer_count) || 0,
        developersCount: parseInt(r.developer_count) || 0,
        totalHoursMonth: 0, 
        invoiceStatus: 'Open'
    })) : (clients.length ? clients : _DEF_CLIENTS);
}

async function loadDevelopers() {
    const data = await apiFetchSafe('/api/developers');
    developers = data ? data.map(r => {
        let parsedSkills = [];
        try { parsedSkills = r.skills ? (typeof r.skills === 'string' ? JSON.parse(r.skills) : r.skills) : []; } catch(e){}
        return {
            id: r.developer_id, naam: r.naam, name: r.naam,
            email: r.email, role: r.rol, rol: r.rol,
            hourlyRate: parseFloat(r.uurtarief)||0, uurtarief: r.uurtarief,
            weekcapaciteit: r.weekcapaciteit || 40,
            hoursThisWeek: parseFloat(r.uren_week) || 0,
            assignedHours: parseInt(r.assigned_hours) || 0,
            activeProjects: parseInt(r.project_count) || 0,
            firstProjectId: r.first_project_id,
            firstClientId: r.first_klant_id,
            skills: parsedSkills,
            cv_url: r.cv_url
        };
    }) : (developers.length ? developers : _DEF_DEVS);
}

async function loadTimesheets() {
    const data = await apiFetchSafe('/api/timesheets');
    timesheets = data ? data.map(r => ({
        id: r.id, developer_id: r.developer_id, developerName: r.developerName,
        clientName: r.clientName || '—', projectName: r.projectName || '—',
        hoursWorked: parseFloat(r.hoursWorked)||0, bedrag: parseFloat(r.bedrag)||0, status: r.status,
        date: formatDateString(r.date), description: r.description || ''
    })) : (timesheets.length ? timesheets : _DEF_TS);
}

async function loadInvoices() {
    const data = await apiFetchSafe('/api/facturen');
    invoices = data ? data.map(r => ({
        id: (r.factuur_id || r.id || '').toString(),
        clientName: r.klant_naam || r.clientName,
        amount: parseFloat(r.totaalbedrag || r.amount) || 0,
        status: r.betalingsstatus || r.status,
        dateSent: formatDateString(r.factuurdatum || r.dateSent),
        paymentDeadline: formatDateString(r.vervaldatum || r.paymentDeadline)
    })) : (invoices.length ? invoices : _DEF_INV);
    if (typeof updateInvoiceStats === 'function') {
        updateInvoiceStats();
    }
}

// Load projects (for dropdowns)
const _DEF_PROJECTS = [
    { project_id: 'p1', projectnaam: 'Checkout Redesign',  klant_naam: 'Acme Corp'   },
    { project_id: 'p2', projectnaam: 'API Integration',     klant_naam: 'Globex'      },
    { project_id: 'p3', projectnaam: 'Data Platform',       klant_naam: 'Soylent Corp'},
    { project_id: 'p4', projectnaam: 'Internal — R&D',      klant_naam: 'Reemo'       },
];
let projects = [];
async function loadProjects() {
    const data = await apiFetchSafe('/api/projecten');
    projects = (data && data.length > 0) ? data : _DEF_PROJECTS;
}

// ── Write helpers (POST/PATCH to API, then reload) ────────────────────────────
async function saveClients()    { await loadClients();    renderClientsGrid(); }
async function saveDevelopers() { await loadDevelopers(); renderDevelopersGrid(); }
async function saveTimesheets() { await loadTimesheets(); renderTimesheetsTable(); updateTimesheetSummary(); }
async function saveInvoices()   { await loadInvoices();   renderInvoicesTable(); updateInvoiceStats(); }

// ── DOMContentLoaded loads all data including projects ─────────────────────────

// --- Utility Functions ---
function getInitials(name) {
    if (!name || typeof name !== 'string') return '?';
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function getStatusClass(status) {
    if (!status || typeof status !== 'string') return '';
    const s = status.toLowerCase();
    if (s === 'approved' || s === 'paid' || s === 'betaald') return 'status-approved';
    if (s === 'pending' || s === 'open') return 'status-pending';
    if (s === 'rejected' || s === 'overdue' || s === 'te_laat') return 'status-rejected';
    return '';
}

function formatCurrency(amount) {
    return '€ ' + amount.toLocaleString('nl-NL');
}

function formatDateString(d) {
    if (!d) return '—';
    try {
        if (d instanceof Date) {
            return d.toISOString().slice(0, 10);
        }
        if (typeof d === 'string') {
            return d.slice(0, 10);
        }
        if (typeof d.toISOString === 'function') {
            return d.toISOString().slice(0, 10);
        }
        if (typeof d === 'number') {
            return new Date(d).toISOString().slice(0, 10);
        }
        return String(d).slice(0, 10);
    } catch {
        return '—';
    }
}

// --- DOM Elements ---
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout-btn');
const navItems = document.querySelectorAll('.nav-item[data-target]');
const screenContents = document.querySelectorAll('.screen-content');

const loginEmailInput = document.getElementById('login-email');
const loginGlow = document.getElementById('login-glow');
const loginLogoBox = document.getElementById('login-logo-box');
const loginSubmitBtn = document.getElementById('login-submit-btn');

const navAdminItems = document.getElementById('nav-admin-items');
const navDevItems = document.getElementById('nav-dev-items');
const userProfileAvatar = document.getElementById('user-profile-avatar');
const userProfileName = document.getElementById('user-profile-name');


// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Setup Event Listeners
    if (loginForm) loginForm.addEventListener('submit', handleLogin);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    
    // Navigation
    navItems.forEach(item => {
        item.addEventListener('click', () => {
             navigateTo(item.getAttribute('data-target'));
        });
    });

    if (document.getElementById('btn-manage-clients')) {
        document.getElementById('btn-manage-clients').addEventListener('click', () => navigateTo('clients'));
    }

    document.getElementById('timesheet-week')?.addEventListener('change', (e) => {
        const week = e.target.value; // bijv. "2026-W23"
        const weekNr = week.split('W')[1];
        const label = document.getElementById('week-label');
        if (label) label.textContent = `Week ${weekNr} — maximaal 40 uur`;
    });

    // Check if there is an active session
    let session = null;
    try {
        const { data, error } = await sbClient.auth.getSession();
        if (error) throw error;
        session = data.session;
    } catch (err) {
        console.error('Failed to get session:', err);
    }

    // Load all data from Supabase (including projects for dropdowns)
    await Promise.all([loadClients(), loadDevelopers(), loadTimesheets(), loadInvoices(), loadProjects()]);

    // Render everything
    renderDashboardStats();
    renderDashboardTimesheets();
    renderClientsGrid();
    renderDevelopersGrid();
    renderTimesheetsTable();
    renderInvoicesTable();
    renderCVDatabase();
    updateCVStats();
    updateInvoiceStats();
    updateTimesheetSummary();
    if (typeof renderOmzetTrendChart === 'function') renderOmzetTrendChart();

    if (session && session.user) {
        const role = session.user.app_metadata?.role || 'developer';
        setupUserSession(session.user, role);
    }

    // ── HTML Structure Guard ────────────────────────────────────────────────────
    // Detects if any .screen-content is nested inside another .screen-content,
    // which causes ALL pages to appear black. Runs once on startup.
    (function validateScreenStructure() {
        const allScreens = document.querySelectorAll('.screen-content');
        const broken = [];
        allScreens.forEach(el => {
            // Walk up ancestors and check for another .screen-content
            let parent = el.parentElement;
            while (parent && parent.id !== 'main-content' && parent !== document.body) {
                if (parent.classList.contains('screen-content')) {
                    broken.push(`"#${el.id}" is nested inside "#${parent.id}"`);
                    break;
                }
                parent = parent.parentElement;
            }
        });
        if (broken.length > 0) {
            console.error(
                '%c[REEMO] ⚠️ HTML STRUCTURE ERROR: Nested screen-content detected!\n' +
                'This causes ALL pages to appear black. Fix the missing </div> tags:\n' +
                broken.join('\n'),
                'color:#f43f5e;font-weight:bold;font-size:13px;background:#1a0010;padding:8px;border-radius:4px'
            );
        }
    })();
});

// --- Authentication ---
function setupUserSession(user, role) {
    loginScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');

    const email = user?.email || '';
    const appTitle = document.getElementById('app-title');
    const logoBox = document.querySelector('.logo-box-small');

    if (role === 'developer') {
        activeDeveloper = developers.find(d => d.email?.toLowerCase() === email.toLowerCase()) || developers.find(d => d.id === 11) || developers[0] || null;
        
        navAdminItems.classList.add('hidden');
        navDevItems.classList.remove('hidden');
        
        const initials = activeDeveloper?.naam ? activeDeveloper.naam.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'D';
        userProfileAvatar.textContent = initials;
        userProfileAvatar.className = 'w-8 h-8 rounded-full bg-emerald-900 text-emerald-400 font-bold flex items-center justify-center shrink-0';
        userProfileName.innerHTML = `<p class="text-sm font-medium truncate">${activeDeveloper?.naam || 'Developer'}</p><p class="text-[10px] text-emerald-500 truncate">${activeDeveloper?.role || activeDeveloper?.rol || 'Developer'}</p>`;
        
        if (appTitle) appTitle.textContent = 'Reemo Developer';
        // Green logo + green nav for developer portal
        if (logoBox) logoBox.classList.add('dev-mode');
        document.body.classList.add('dev-portal');
        navigateTo('dev-dashboard');
    } else {
        activeDeveloper = null;
        navDevItems.classList.add('hidden');
        navAdminItems.classList.remove('hidden');
        userProfileAvatar.textContent = user?.user_metadata?.naam ? user.user_metadata.naam.slice(0,1).toUpperCase() : 'T';
        userProfileAvatar.className = 'avatar-small';
        userProfileName.innerHTML = `<p class="text-sm font-medium truncate">${user?.user_metadata?.naam || 'Test'}</p><p class="text-[10px] text-white-40 truncate">Admin</p>`;
        if (appTitle) appTitle.textContent = 'Reemo Admin';
        // Blue logo + blue nav for admin portal
        if (logoBox) logoBox.classList.remove('dev-mode');
        document.body.classList.remove('dev-portal');
        navigateTo('dashboard');
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email')?.value?.trim() || '';
    const password = document.getElementById('login-password')?.value || '';
    const loginError = document.getElementById('login-error');

    if (loginError) {
        loginError.style.display = 'none';
        loginError.textContent = '';
    }

    try {
        const { data, error } = await sbClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        const user = data.user;
        const role = user?.app_metadata?.role || 'developer';

        setupUserSession(user, role);
    } catch (err) {
        console.error('Login error:', err);
        if (loginError) {
            loginError.textContent = err.message || 'Inloggen mislukt. Controleer je gegevens.';
            loginError.style.display = 'block';
        }
    }
}


async function handleLogout() {
    try {
        await sbClient.auth.signOut();
    } catch (e) {
        console.error('Failed to sign out:', e);
    }
    appContainer.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    // Reset to dashboard
    navigateTo('dashboard');
}

// --- Navigation ---
function navigateTo(targetScreenId) {
    // Update Sidebar
    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('data-target') === targetScreenId) {
            item.classList.add('active');
        }
    });

    // Update Content
    screenContents.forEach(screen => {
        screen.classList.remove('active');
        if (screen.id === `screen-${targetScreenId}`) {
            screen.classList.add('active');
        }
    });

    // Screen-specific init
    if (targetScreenId === 'clients') {
        loadClients().then(() => {
            renderClientsGrid();
            renderDashboardStats();
        });
    }
    if (targetScreenId === 'developers') {
        // Always reload developers from DB when navigating to this page
        loadDevelopers().then(() => {
            renderDevelopersGrid();
            renderDashboardStats();
        });
    }
    if (targetScreenId === 'timesheets') {
        loadTimesheets().then(() => {
            renderTimesheetsTable(
                document.getElementById('ts-search')?.value || '',
                document.getElementById('ts-status-filter')?.value || ''
            );
            updateTimesheetSummary();
        });
        if (typeof startTimesheetAutoRefresh === 'function') startTimesheetAutoRefresh();
    } else {
        if (typeof stopTimesheetAutoRefresh === 'function') stopTimesheetAutoRefresh();
    }
    
    if (targetScreenId === 'dev-timesheets') {
        if (typeof startDevTimesheetAutoRefresh === 'function') startDevTimesheetAutoRefresh();
    } else {
        if (typeof stopDevTimesheetAutoRefresh === 'function') stopDevTimesheetAutoRefresh();
    }

    if (targetScreenId === 'dev-timesheets') {
        const devId = activeDeveloper?.id || developers[0]?.id;
        
        // Helper to fill the dropdown using CONTRACT data (so we send contract_id to the API)
        function fillContractDropdown(contracts) {
            const sel = document.getElementById('dev-ts-project');
            if (!sel) return;
            if (!contracts || contracts.length === 0) {
                sel.innerHTML = '<option value="">— Geen actieve contracten —</option>';
                return;
            }
            sel.innerHTML = contracts.map(c =>
                `<option value="${c.project_id}">${c.klant_naam || 'Onbekende Klant'} — ${c.projectnaam}</option>`
            ).join('');
        }
        
        // Show/hide warning banner
        const warn = document.getElementById('dev-ts-prereq-warn');
        if (warn) warn.style.display = 'none';
        
        // Load contracts from the dashboard endpoint (which has contract_id)
        if (devId) {
            apiFetchSafe(`/api/developers/${devId}/dashboard`).then(res => {
                const contracts = res?.contracts || [];
                fillContractDropdown(contracts);
                if (contracts.length === 0 && warn) {
                    warn.textContent = '⚠ Neem contact op met de admin om contracten aan te maken.';
                    warn.style.display = 'block';
                }
            });
        }

        // Auto-fill current week
        const weekEl = document.getElementById('timesheet-week');
        if (weekEl && !weekEl.value) {
            weekEl.value = getCurrentISOWeekString();
            const weekNr = weekEl.value.split('W')[1];
            const label = document.getElementById('week-label');
            if (label) label.textContent = `Week ${weekNr} — maximaal 40 uur`;
        }
        // Clear hours to avoid stale values
        const urenEl = document.getElementById('timesheet-uren');
        if (urenEl) urenEl.value = '';
        renderDevTimesheets();
        updateDevTsStats();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    if (targetScreenId === 'dev-dashboard') {
        loadDevDashboard();
    }
    if (targetScreenId === 'dev-documents') {
        renderDevDocuments();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    if (targetScreenId === 'cvs') {
        loadCVDatabase().then(() => {
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
    }
    if (targetScreenId === 'invoices') {
        loadInvoices().then(() => {
            renderInvoicesTable();
            updateInvoiceStats();
            if (typeof loadFactuurAanbeveling === 'function') loadFactuurAanbeveling();
        });
    }
    if (targetScreenId === 'dev-profile') {
        loadDevProfile();
    }
    if (targetScreenId === 'data-management') {
        initDataManagement();
    }
}

async function loadDevDashboard() {
    const devId = activeDeveloper?.id || developers[0]?.id;
    if (!devId) return;

    const container = document.getElementById('screen-dev-dashboard');
    if (!container) return;

    try {
        const res = await apiFetch(`/api/developers/${devId}/dashboard`);
        renderDevDashboard(res);
        if (res.contracts) {
            populateDevContractsDropdown(res.contracts);
        }
    } catch (e) {
        console.error('Failed to load dev dashboard:', e);
    }
}

function renderDevDashboard(data) {
    // Update Welcome Name
    const welcomeName = document.getElementById('dev-welcome-name');
    if (welcomeName) welcomeName.textContent = data.devName;

    // Update capacity stat card
    const capStat = document.getElementById('dev-capacity-stat');
    if (capStat) capStat.innerHTML = `${data.devCapacity}<span class="dev-stat-unit">h</span>`;

    // Update status badge
    updateDevStatusBadge(data.devBeschikbaarheid || 'available');

    // Store devId and capacity in globals for use by modals
    window._devDashboardData = data;

    // Update Stats
    const statsCards = document.querySelectorAll('#screen-dev-dashboard .dev-stat-card');
    if (statsCards.length >= 3) {
        // Hours This Week
        const hoursCard = statsCards[0];
        const capacity = data.devCapacity || 40;
        const urenLabel = document.getElementById('dev-dash-uren');
        const resterendLabel = document.getElementById('dev-dash-resterend');
        if (urenLabel) {
            urenLabel.innerHTML = `${data.stats.hoursThisWeek}<span class="dev-stat-unit">h</span>`;
        }
        if (resterendLabel) {
            const resterend = Math.max(0, capacity - data.stats.hoursThisWeek);
            resterendLabel.textContent = `${resterend} of ${capacity} hours remaining this week`;
        }
        const progressFill = document.getElementById('dev-dash-progress-fill');
        if (progressFill) {
            const pct = Math.min((data.stats.hoursThisWeek / capacity) * 100, 100);
            progressFill.style.width = `${pct}%`;
        }
        
        // Utilization This Month
        const realCard = statsCards[1];
        const realLabel = document.getElementById('dev-dash-realisatie');
        if (realLabel) {
            realLabel.innerHTML = `${data.stats.realisatiePct}<span class="dev-stat-unit">%</span>`;
        }
        
        // Active Projects
        const projCard = statsCards[2];
        const projLabel = document.getElementById('dev-dash-projecten');
        if (projLabel) {
            projLabel.textContent = data.stats.activeProjects;
        }
        projCard.style.cursor = 'pointer';
        projCard.title = 'Click to see assigned projects';
        projCard.onclick = () => document.getElementById('dev-profile-tab')?.click();
        projCard.style.transition = 'border-color 0.2s, box-shadow 0.2s';
        projCard.onmouseover = () => { projCard.style.borderColor = '#fbbf24'; projCard.style.boxShadow = '0 0 0 1px #fbbf2430'; };
        projCard.onmouseout  = () => { projCard.style.borderColor = ''; projCard.style.boxShadow = ''; };
    }

    // Update Assignments / Contracts
    const container = document.getElementById('dev-contracts-container');
    if (container) {
        if (data.contracts && data.contracts.length > 0) {
            container.innerHTML = data.contracts.map(c => {
                const start = new Date(c.start_datum).toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
                const end = c.eind_datum ? new Date(c.eind_datum).toLocaleDateString('en-US', { month: 'short' }).toLowerCase() : 'present';
                return `
                    <div class="dev-assignment-card" style="margin-bottom:0">
                        <div style="display:flex;justify-content:space-between;align-items:center">
                            <div style="display:flex;align-items:center;gap:1rem;flex:1">
                                <div style="width:2.25rem;height:2.25rem;border-radius:0.5rem;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.2);display:flex;align-items:center;justify-content:center;color:#60a5fa;flex-shrink:0">
                                    <i data-lucide="briefcase" style="width:14px;height:14px"></i>
                                </div>
                                <div>
                                    <h3 style="font-size:0.9375rem;font-weight:700;color:var(--white);margin:0 0 0.15rem 0">
                                        ${c.projectnaam} <span style="font-weight:400;color:var(--white-40);font-size:0.8125rem">&bull; ${c.klant_naam}</span>
                                    </h3>
                                    <div style="font-size:0.75rem;color:var(--white-50)">
                                        ${c.rol_op_project || 'Developer'} &bull; &euro;${parseFloat(c.uurtarief).toFixed(0)}/u &bull; ${c.uren_per_week} hrs/wk &bull; ${start}&ndash;${end}
                                    </div>
                                </div>
                            </div>
                            <div style="text-align:right">
                                <span style="background:rgba(16,185,129,0.1);color:#22C55E;font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;padding:0.25rem 0.5rem;border-radius:0.375rem;border:1px solid rgba(16,185,129,0.2);white-space:nowrap;display:inline-block">ACTIVE</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            container.innerHTML = `
                <div class="dev-assignment-card" style="padding:2rem;text-align:center;color:var(--white-30)">
                    <i data-lucide="briefcase" style="width:32px;height:32px;margin-bottom:1rem;opacity:0.2;margin:0 auto 1rem"></i>
                    <div style="font-weight:700;color:var(--white-60)">No active contracts</div>
                    <div style="font-size:0.8125rem">Contact the admin to set up a contract.</div>
                </div>
            `;
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    
    // Render the capacity allocation card
    renderDevCapacityCard(data);
}

function renderDevCapacityCard(data) {
    const container = document.getElementById('dev-capacity-allocation-container');
    if (!container) return;

    const totalCapacity = parseInt(data.devCapacity) || 40;
    const activeContracts = data.contracts || [];
    const allocatedHours = activeContracts.reduce((sum, c) => sum + parseInt(c.uren_per_week || 0), 0);
    const availableHours = Math.max(0, totalCapacity - allocatedHours);
    const isOverAllocated = allocatedHours > totalCapacity;

    const colors = [
        { bg: '#3b82f6', glow: '#3b82f640', light: 'rgba(59,130,246,0.12)' },
        { bg: '#10b981', glow: '#10b98140', light: 'rgba(16,185,129,0.12)' },
        { bg: '#f59e0b', glow: '#f59e0b40', light: 'rgba(245,158,11,0.12)' },
        { bg: '#ec4899', glow: '#ec489940', light: 'rgba(236,72,153,0.12)' },
        { bg: '#8b5cf6', glow: '#8b5cf640', light: 'rgba(139,92,246,0.12)' },
    ];

    // Build capacity rows and progress bars
    let allocationRowsHtml = '';

    if (activeContracts.length === 0) {
        allocationRowsHtml = `<div style="color:var(--white-30);font-size:0.875rem;padding:1rem 0;text-align:center">No active allocations.</div>`;
    } else {
        activeContracts.forEach((c, idx) => {
            const col = colors[idx % colors.length];
            const hrs = parseInt(c.uren_per_week || 0);
            const pct = Math.min((hrs / totalCapacity) * 100, 100);

            allocationRowsHtml += `
                <div style="padding:0.75rem 1rem;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:0.75rem;transition:transform 0.15s" onmouseover="this.style.transform='translateX(2px)'" onmouseout="this.style.transform='translateX(0)'">
                    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.35rem">
                        <div style="width:2.25rem;height:2.25rem;border-radius:0.5rem;background:${col.bg}20;border:1px solid ${col.bg}40;display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            <span style="font-size:0.75rem;font-weight:800;color:${col.bg}">${hrs}h</span>
                        </div>
                        <div style="flex:1;min-width:0">
                            <div style="font-weight:700;color:var(--white);font-size:0.8125rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.projectnaam}</div>
                            <div style="font-size:0.6875rem;color:var(--white-40);margin-top:0.05rem">${c.klant_naam} &bull; ${c.rol_op_project || 'Developer'}</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0">
                            <div style="font-size:0.75rem;font-weight:800;color:${col.bg}">${Math.round((hrs / totalCapacity) * 100)}%</div>
                            <div style="font-size:0.6875rem;color:var(--white-40);margin-top:0.05rem">&euro;${parseFloat(c.uurtarief || 0).toFixed(0)}/u</div>
                        </div>
                    </div>
                    <!-- Small progress bar visualizing project occupancy -->
                    <div style="width:100%;height:0.25rem;background:rgba(255,255,255,0.03);border-radius:0.125rem;overflow:hidden">
                        <div style="width:${Math.round(pct)}%;height:100%;background:${col.bg};border-radius:0.125rem"></div>
                    </div>
                </div>
            `;
        });

        // Available block
        if (availableHours > 0) {
            const availPct = (availableHours / totalCapacity) * 100;
            allocationRowsHtml += `
                <div style="padding:0.75rem 1rem;background:rgba(255,255,255,0.01);border:1px dashed rgba(255,255,255,0.08);border-radius:0.75rem">
                    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.35rem">
                        <div style="width:2.25rem;height:2.25rem;border-radius:0.5rem;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0">
                            <span style="font-size:0.75rem;font-weight:800;color:var(--white-30)">${availableHours}h</span>
                        </div>
                        <div style="flex:1">
                            <div style="font-weight:600;color:var(--white-40);font-size:0.8125rem">Available capacity</div>
                            <div style="font-size:0.6875rem;color:var(--white-30);margin-top:0.05rem">Not yet allocated</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0">
                            <div style="font-size:0.75rem;font-weight:700;color:var(--white-30)">${Math.round(availPct)}%</div>
                        </div>
                    </div>
                    <div style="width:100%;height:0.25rem;background:rgba(255,255,255,0.02);border-radius:0.125rem;overflow:hidden">
                        <div style="width:${Math.round(availPct)}%;height:100%;background:rgba(255,255,255,0.1);border-radius:0.125rem"></div>
                    </div>
                </div>
            `;
        }
    }

    const headerActionHtml = window._isEditingCapacity
        ? `
        <div style="display:flex;align-items:center;gap:0.4rem">
            <span style="font-size:0.8125rem;font-weight:700;color:var(--white)">${allocatedHours} /</span>
            <input type="number" id="inline-capacity-input" value="${totalCapacity}" min="1" max="80" style="width:3.2rem;background:#111;border:1px solid var(--white-20);border-radius:0.375rem;color:var(--white);padding:0.15rem 0.3rem;text-align:center;font-size:0.8125rem;font-weight:700">
            <span style="font-size:0.8125rem;color:var(--white-40);margin-right:0.25rem">h</span>
            <button onclick="saveInlineCapacity()" style="padding:0.25rem 0.5rem;background:#22c55e;border:none;border-radius:0.375rem;color:#000;font-size:0.75rem;font-weight:700;cursor:pointer;transition:background 0.15s" onmouseover="this.style.background='#4ade80'" onmouseout="this.style.background='#22c55e'">Save</button>
            <button onclick="cancelInlineCapacity()" style="padding:0.25rem 0.5rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:0.375rem;color:var(--white-60);font-size:0.75rem;font-weight:600;cursor:pointer" onmouseover="this.style.color='var(--white)'" onmouseout="this.style.color='var(--white-60)'">Cancel</button>
        </div>
        `
        : `
        <div style="display:flex;align-items:center;gap:0.625rem">
            <span style="font-size:0.8125rem;font-weight:700;color:${isOverAllocated ? '#ef4444' : allocatedHours === totalCapacity ? '#22c55e' : '#3b82f6'}">${allocatedHours}/${totalCapacity}h</span>
            <button onclick="openEditCapacityModal()" style="display:flex;align-items:center;gap:0.35rem;padding:0.35rem 0.75rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:0.5rem;cursor:pointer;transition:all 0.2s;font-size:0.75rem;font-weight:600;color:var(--white-60)" onmouseover="this.style.background='rgba(255,255,255,0.1)';this.style.color='var(--white)'" onmouseout="this.style.background='rgba(255,255,255,0.05)';this.style.color='var(--white-60)'">
                <i data-lucide="pencil" style="width:11px;height:11px"></i> Edit
            </button>
        </div>
        `;

    container.innerHTML = `
      <div class="dev-assignment-card" style="margin-bottom:0;background:#0a0a0a;border:1px solid #1e1e1e">
          <!-- Header -->
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
              <div style="display:flex;align-items:center;gap:0.5rem">
                  <div style="width:2rem;height:2rem;border-radius:0.5rem;background:rgba(59,130,246,0.1);display:flex;align-items:center;justify-content:center">
                      <i data-lucide="bar-chart-2" style="width:14px;height:14px;color:#60a5fa"></i>
                  </div>
                  <div>
                      <h3 style="font-size:0.9375rem;font-weight:800;color:var(--white);margin:0">Capacity Overview</h3>
                      <div style="font-size:0.7rem;color:var(--white-40);margin-top:0.1rem">${totalCapacity} hours per week total</div>
                  </div>
              </div>
              ${headerActionHtml}
          </div>

          <!-- Total Occupancy Progress Bar & Over-allocated Alert -->
          <div style="margin-bottom:1.25rem">
              <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--white-40);margin-bottom:0.35rem">
                  <span>Total Occupancy</span>
                  <span style="font-weight:700;color:${isOverAllocated ? '#ef4444' : allocatedHours === totalCapacity ? '#22c55e' : '#3b82f6'}">${Math.round((allocatedHours / totalCapacity) * 100)}%</span>
              </div>
              <div style="width:100%;height:0.5rem;background:rgba(255,255,255,0.05);border-radius:0.25rem;overflow:hidden">
                  <div style="width:${Math.min((allocatedHours / totalCapacity) * 100, 100)}%;height:100%;background:${isOverAllocated ? '#ef4444' : '#22c55e'};border-radius:0.25rem"></div>
              </div>
              ${isOverAllocated ? `
              <div style="display:flex;align-items:center;gap:0.4rem;padding:0.4rem 0.6rem;border-left:3px solid #ef4444;color:#ef4444;font-size:0.75rem;font-weight:600;margin-top:0.5rem">
                  <i data-lucide="alert-triangle" style="width:12px;height:12px"></i>
                  Overbooked &mdash; ${allocatedHours - totalCapacity} hours over capacity
              </div>` : ''}
          </div>

          <!-- Allocation rows -->
          <div style="display:flex;flex-direction:column;gap:0.625rem">
              ${allocationRowsHtml}
          </div>
      </div>
    `;

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Availability helpers ──────────────────────────────────────────────────
const _beschikbaarheidConfig = {
    // English/User-spec values
    'available':        { color: '#22C55E', bg: '#14532D', border: '#22C55E50', label: 'Available' },
    'on_assignment':    { color: '#3B82F6', bg: '#1D3A5F', border: '#3B82F650', label: 'On Assignment' },
    'unavailable':      { color: '#EF4444', bg: '#450A0A', border: '#EF444450', label: 'Unavailable' },
    
    // Dutch fallbacks (for compatibility with existing database rows)
    'beschikbaar':      { color: '#22C55E', bg: '#14532D', border: '#22C55E50', label: 'Available' },
    'gedeeltelijk':     { color: '#3B82F6', bg: '#1D3A5F', border: '#3B82F650', label: 'On Assignment' },
    'niet beschikbaar': { color: '#EF4444', bg: '#450A0A', border: '#EF444450', label: 'Unavailable' },
    'verlof':           { color: '#EF4444', bg: '#450A0A', border: '#EF444450', label: 'Unavailable' },
};

function updateDevStatusBadge(status) {
    const cfg = _beschikbaarheidConfig[status] || _beschikbaarheidConfig['available'] || _beschikbaarheidConfig['beschikbaar'];
    const btn = document.getElementById('dev-status-btn');
    const dot = document.getElementById('dev-status-dot');
    const label = document.getElementById('dev-status-label');
    if (btn) {
        btn.style.color = cfg.color;
        btn.style.background = cfg.bg;
        btn.style.borderColor = cfg.border;
    }
    if (dot) { dot.style.background = cfg.color; dot.style.boxShadow = `0 0 6px ${cfg.color}`; }
    if (label) label.textContent = cfg.label;

    // Sync profile badge/dot if they exist
    const pBtn = document.getElementById('profile-status-btn');
    const pDot = document.getElementById('profile-status-dot');
    const pLabel = document.getElementById('profile-status-label');
    if (pBtn) {
        pBtn.style.color = cfg.color;
        pBtn.style.background = cfg.bg;
        pBtn.style.borderColor = cfg.border;
    }
    if (pDot) { pDot.style.background = cfg.color; pDot.style.boxShadow = `0 0 8px ${cfg.color}`; }
    if (pLabel) pLabel.textContent = cfg.label;

    // Sync profile hero avatar dot if it exists
    const avDot = document.getElementById('profile-avatar-status-dot');
    if (avDot) {
        avDot.style.background = cfg.color;
        avDot.style.boxShadow = `0 0 8px ${cfg.color}`;
    }
}

function toggleDevStatusDropdown(e) {
    e.stopPropagation();
    const dd = document.getElementById('dev-status-dropdown');
    if (!dd) return;
    const isOpen = dd.style.display !== 'none';
    dd.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        const close = () => { dd.style.display = 'none'; document.removeEventListener('click', close); };
        setTimeout(() => document.addEventListener('click', close), 10);
    }
}

async function setDevBeschikbaarheid(status) {
    const dd = document.getElementById('dev-status-dropdown');
    if (dd) dd.style.display = 'none';
    const pdd = document.getElementById('profile-status-dropdown');
    if (pdd) pdd.style.display = 'none';

    const devId = activeDeveloper?.id || window._devDashboardData && window._devDashboardData.devId;
    if (!devId) { showToast('⚠ Developer ID not found'); return; }

    try {
        await apiFetch(`/api/developers/${devId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ beschikbaarheid: status })
        });
        updateDevStatusBadge(status);
        if (window._devDashboardData) window._devDashboardData.devBeschikbaarheid = status;
        // Also refresh the dev in the developers array for admin view
        const devIdx = developers.findIndex(d => d.id == devId || d.developer_id == devId);
        if (devIdx !== -1) developers[devIdx].beschikbaarheid = status;
        showToast(`✓ Status updated: ${_beschikbaarheidConfig[status]?.label || status}`);
    } catch (e) {
        showToast(`Could not update status. Try again.`, 'error');
    }
}

// ── Edit Capacity Modal ──────────────────────────────────────────────────────
function openEditCapacityModal() {
    window._isEditingCapacity = true;
    if (window._devDashboardData) {
        renderDevCapacityCard(window._devDashboardData);
        setTimeout(() => document.getElementById('inline-capacity-input')?.focus(), 50);
    }
}

async function saveInlineCapacity() {
    const devId = activeDeveloper?.id || window._devDashboardData?.devId;
    if (!devId) return;

    const input = document.getElementById('inline-capacity-input');
    if (!input) return;
    const nieuweCapaciteit = parseInt(input.value);

    if (!nieuweCapaciteit || nieuweCapaciteit < 1 || nieuweCapaciteit > 80) {
        showToast('Enter a value between 1 and 80 hours', 'error');
        return;
    }

    try {
        const res = await fetch(`/api/developers/${devId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weekcapaciteit: nieuweCapaciteit })
        });

        if (!res.ok) {
            showToast('Could not save capacity. Try again.', 'error');
            return;
        }

        showToast('Capacity updated', 'success');
        window._isEditingCapacity = false;
        loadDevDashboard(); // Reload so percentages recalculate
    } catch (err) {
        showToast('Could not save capacity. Try again.', 'error');
        console.error('Save capacity error:', err);
    }
}

function cancelInlineCapacity() {
    window._isEditingCapacity = false;
    if (window._devDashboardData) {
        renderDevCapacityCard(window._devDashboardData);
    }
}


// ── Dev Projects Slide-over Panel ───────────────────────────────────────────
function openDevProjectsPanel(data) {
    // Remove existing panel if any
    document.getElementById('dev-projects-panel')?.remove();

    const contracts = data.contracts || [];
    const totalCap  = data.devCapacity || 40;
    const colors = [
        { bg: '#3b82f6', light: 'rgba(59,130,246,0.12)',  border: '#3b82f620' },
        { bg: '#10b981', light: 'rgba(16,185,129,0.12)',  border: '#10b98120' },
        { bg: '#f59e0b', light: 'rgba(245,158,11,0.12)',  border: '#f59e0b20' },
        { bg: '#ec4899', light: 'rgba(236,72,153,0.12)',  border: '#ec489920' },
        { bg: '#8b5cf6', light: 'rgba(139,92,246,0.12)',  border: '#8b5cf620' },
    ];

    const contractsHtml = contracts.length === 0
        ? `<div style="text-align:center;padding:3rem 1rem;color:var(--white-30)">
               <i data-lucide="briefcase" style="width:40px;height:40px;margin:0 auto 1rem;display:block;opacity:0.2"></i>
               <div style="font-weight:700;color:var(--white-40)">Geen actieve contracten</div>
               <div style="font-size:0.8125rem;margin-top:0.375rem">Er zijn nog geen projecten toegewezen.</div>
           </div>`
        : contracts.map((c, i) => {
            const col = colors[i % colors.length];
            const hrs = parseInt(c.uren_per_week || 0);
            const pct = Math.round(Math.min((hrs / totalCap) * 100, 100));
            const start = c.start_datum ? new Date(c.start_datum).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
            const end   = c.eind_datum  ? new Date(c.eind_datum ).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Doorlopend';
            const weekly = (hrs * parseFloat(c.uurtarief || 0)).toFixed(0);
            return `
            <div style="background:${col.light};border:1px solid ${col.border};border-radius:1rem;padding:1.25rem;position:relative;overflow:hidden">
                <!-- Accent line -->
                <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${col.bg};border-radius:1rem 0 0 1rem"></div>
                <div style="padding-left:0.75rem">
                    <!-- Top row: project + badge -->
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.875rem">
                        <div>
                            <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${col.bg};margin-bottom:0.25rem">Actief Contract</div>
                            <div style="font-size:1rem;font-weight:800;color:var(--white);margin-bottom:0.15rem">${c.projectnaam}</div>
                            <div style="font-size:0.8125rem;color:var(--white-40)">${c.klant_naam}</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0">
                            <div style="font-size:1.25rem;font-weight:800;color:${col.bg}">${hrs}u</div>
                            <div style="font-size:0.7rem;color:var(--white-40)">per week</div>
                        </div>
                    </div>

                    <!-- Capacity mini-bar -->
                    <div style="margin-bottom:0.875rem">
                        <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--white-40);margin-bottom:0.3rem">
                            <span>Capaciteitsaandeel</span><span style="color:${col.bg};font-weight:700">${pct}%</span>
                        </div>
                        <div style="width:100%;height:6px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden">
                            <div style="height:100%;width:${pct}%;background:${col.bg};border-radius:3px;box-shadow:0 0 8px ${col.bg}60"></div>
                        </div>
                    </div>

                    <!-- Detail grid -->
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.625rem">
                        <div style="background:rgba(0,0,0,0.2);border-radius:0.625rem;padding:0.625rem 0.75rem">
                            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--white-30);margin-bottom:0.2rem">Rol</div>
                            <div style="font-size:0.8125rem;font-weight:700;color:var(--white)">${c.rol_op_project || 'Developer'}</div>
                        </div>
                        <div style="background:rgba(0,0,0,0.2);border-radius:0.625rem;padding:0.625rem 0.75rem">
                            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--white-30);margin-bottom:0.2rem">Uurtarief</div>
                            <div style="font-size:0.8125rem;font-weight:700;color:#34d399">&euro;${parseFloat(c.uurtarief || 0).toFixed(2)}/u</div>
                        </div>
                        <div style="background:rgba(0,0,0,0.2);border-radius:0.625rem;padding:0.625rem 0.75rem">
                            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--white-30);margin-bottom:0.2rem">Start</div>
                            <div style="font-size:0.8125rem;font-weight:700;color:var(--white)">${start}</div>
                        </div>
                        <div style="background:rgba(0,0,0,0.2);border-radius:0.625rem;padding:0.625rem 0.75rem">
                            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--white-30);margin-bottom:0.2rem">Einde</div>
                            <div style="font-size:0.8125rem;font-weight:700;color:${c.eind_datum ? 'var(--white)' : '#34d399'}">${end}</div>
                        </div>
                    </div>

                    <!-- Weekly earnings -->
                    <div style="margin-top:0.75rem;display:flex;align-items:center;justify-content:space-between;padding:0.625rem 0.75rem;background:rgba(0,0,0,0.2);border-radius:0.625rem">
                        <span style="font-size:0.75rem;color:var(--white-40)">Verwachte weekomzet</span>
                        <span style="font-size:0.875rem;font-weight:800;color:#fbbf24">&euro;${parseInt(weekly).toLocaleString('nl-NL')}</span>
                    </div>
                </div>
            </div>`;
        }).join('');

    const panel = document.createElement('div');
    panel.id = 'dev-projects-panel';
    panel.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;justify-content:flex-end';
    panel.innerHTML = `
        <!-- Backdrop -->
        <div onclick="closeDevProjectsPanel()" style="position:absolute;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px)"></div>
        <!-- Drawer -->
        <div style="position:relative;width:420px;max-width:95vw;height:100%;background:#0d0d0d;border-left:1px solid #1e1e1e;display:flex;flex-direction:column;box-shadow:-20px 0 60px rgba(0,0,0,0.5);animation:slideInRight 0.25s ease">
            <!-- Header -->
            <div style="padding:1.5rem;border-bottom:1px solid #1a1a1a;flex-shrink:0">
                <div style="display:flex;align-items:center;justify-content:space-between">
                    <div style="display:flex;align-items:center;gap:0.75rem">
                        <div style="width:2.25rem;height:2.25rem;border-radius:0.625rem;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);display:flex;align-items:center;justify-content:center">
                            <i data-lucide="briefcase" style="width:16px;height:16px;color:#34d399"></i>
                        </div>
                        <div>
                            <h3 style="font-size:1rem;font-weight:800;color:var(--white);margin:0">Mijn Projecten</h3>
                            <div style="font-size:0.75rem;color:var(--white-40);margin-top:0.1rem">${contracts.length} actief${contracts.length !== 1 ? '' : ''} contract${contracts.length !== 1 ? 'en' : ''}</div>
                        </div>
                    </div>
                    <button onclick="closeDevProjectsPanel()" style="width:2rem;height:2rem;border-radius:0.5rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--white-60);font-size:1.1rem;transition:all 0.15s" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">&times;</button>
                </div>
                <!-- Totaal bar -->
                <div style="margin-top:1rem">
                    <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--white-40);margin-bottom:0.375rem">
                        <span>Totale allocatie</span>
                        <span style="font-weight:700;color:${ contracts.reduce((s,c)=>s+parseInt(c.uren_per_week||0),0) > totalCap ? '#f43f5e' : 'var(--white)'}">${contracts.reduce((s,c)=>s+parseInt(c.uren_per_week||0),0)}/${totalCap}u/wk</span>
                    </div>
                    <div style="width:100%;height:8px;display:flex;gap:2px;border-radius:4px;overflow:hidden">
                        ${contracts.map((c,i) => { const col=colors[i%colors.length]; const pct=Math.min((parseInt(c.uren_per_week||0)/totalCap)*100,100); return `<div style="flex:${pct};background:${col.bg};box-shadow:0 0 8px ${col.bg}50" title="${c.projectnaam}: ${c.uren_per_week}u"></div>`; }).join('')}
                        ${contracts.reduce((s,c)=>s+parseInt(c.uren_per_week||0),0) < totalCap ? `<div style="flex:${((totalCap - contracts.reduce((s,c)=>s+parseInt(c.uren_per_week||0),0))/totalCap)*100};background:rgba(255,255,255,0.07);border:1px dashed rgba(255,255,255,0.15)"></div>` : ''}
                    </div>
                </div>
            </div>
            <!-- Contract list (scrollable) -->
            <div style="flex:1;overflow-y:auto;padding:1.25rem;display:flex;flex-direction:column;gap:1rem">
                ${contractsHtml}
            </div>
        </div>
    `;

    // Add slide-in keyframe if not already added
    if (!document.getElementById('panel-keyframes')) {
        const style = document.createElement('style');
        style.id = 'panel-keyframes';
        style.textContent = '@keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }';
        document.head.appendChild(style);
    }

    document.body.appendChild(panel);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeDevProjectsPanel() {
    const panel = document.getElementById('dev-projects-panel');
    if (panel) panel.remove();
}

function populateDevContractsDropdown(contracts) {
    const select = document.getElementById('dev-ts-project');
    if (!select) return;
    if (!contracts || contracts.length === 0) {
        select.innerHTML = '<option value="">Geen actieve contracten</option>';
        return;
    }
    select.innerHTML = contracts.map(c => 
        `<option value="${c.project_id}">${c.klant_naam} — ${c.projectnaam} (${c.rol_op_project || 'Developer'}, &euro;${parseFloat(c.uurtarief).toFixed(0)}/u)</option>`
    ).join('');
}


// ── Developer Profile loading and rendering ──────────────────────────────────
async function loadDevProfile() {
    // Use the active/logged-in developer or fall back to the first developer
    const devId = activeDeveloper?.id || developers[0]?.id;
    if (!devId) return;
    const container = document.getElementById('dev-profile-dynamic-content');
    if (!container) return;
    container.innerHTML = `
        <div style="padding:3rem;text-align:center;color:var(--white-40)">
            <div class="spinner" style="width:32px;height:32px;border:3px solid rgba(255,255,255,0.1);border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 1rem"></div>
            Laden...
        </div>`;

    try {
        const res = await apiFetch(`/api/developers/${devId}`);
        const { developer, projecten, uren, cv } = res;
        renderDevProfilePage(developer, projecten, uren, cv);
    } catch (e) {
        container.innerHTML = `<div style="padding:2rem;color:#f43f5e">Fout bij laden van profiel: ${e.message}</div>`;
    }
}

function renderDevProfilePage(dev, projecten, uren, cv) {
    const container = document.getElementById('dev-profile-dynamic-content');
    if (!container) return;

    const initials = getInitials(dev.naam || '?');
    const role = dev.rol || 'Developer';
    const rate = parseFloat(dev.uurtarief) || 0;
    const capacity = dev.weekcapaciteit || 40;
    const activeProjectsCount = projecten.length;
    const beschikbaarheid = dev.beschikbaarheid || 'beschikbaar';

    const activeContracts = projecten || [];
    const allocatedHours = activeContracts.reduce((sum, p) => sum + parseInt(p.uren_per_week || 0), 0);
    const isOverAllocated = allocatedHours > capacity;

    const avatarColor = dev.naam?.match(/^[AEIOU]/i) ? '#f472b6' : '#60a5fa';

    // Skills
    let parsedSkills = [];
    try { parsedSkills = dev.skills ? (typeof dev.skills === 'string' ? JSON.parse(dev.skills) : dev.skills) : []; } catch(e){}
    const skillsHtml = parsedSkills.length
        ? parsedSkills.map(s => `
            <span class="profile-skill-chip">
                ${s}
                <button onclick="removeDevSkill('${dev.id || dev.developer_id}', '${s.replace(/'/g, "\\'")}')">
                    <i data-lucide="x" style="width:10px;height:10px"></i>
                </button>
            </span>`).join('')
        : `<span style="font-size:0.75rem;color:var(--white-30);font-style:italic">Nog geen skills toegevoegd.</span>`;

    // Status config
    const statusCfg = _beschikbaarheidConfig[beschikbaarheid] || _beschikbaarheidConfig['beschikbaar'];
    const devId = dev.id || dev.developer_id;

    // Status dropdown options
    const statusOptions = Object.entries(_beschikbaarheidConfig).map(([key, cfg]) => `
        <button class="profile-status-option" onclick="setDevBeschikbaarheid('${key}');updateProfileStatusBadge('${key}')">
            <span class="profile-status-option-dot" style="background:${cfg.color}"></span>
            ${cfg.label}
        </button>`).join('');

    // CV section
    let hasCv = cv || dev.cv_url;
    let cvFilename = cv ? (cv.original_filename || 'CV.pdf') : (dev.cv_url ? dev.cv_url.split('_').slice(1).join('_') || 'CV.pdf' : 'CV.pdf');
    let cvDateText = cv ? `Geüpload op ${new Date(cv.aangemaakt_op || cv.date || Date.now()).toLocaleDateString('nl-NL')}` : (dev.cv_url ? 'Geüpload' : '');

    let cvSectionHtml = '';
    if (hasCv) {
        cvSectionHtml = `
            <div class="profile-cv-row">
                <div style="display:flex;align-items:center;gap:0.875rem;min-width:0;flex:1">
                    <div class="profile-cv-icon">
                        <i data-lucide="file-text" style="width:1rem;height:1rem"></i>
                    </div>
                    <div style="min-width:0">
                        <div style="font-weight:700;font-size:0.875rem;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${cvFilename}">${cvFilename}</div>
                        ${cvDateText ? `<div style="font-size:0.6875rem;color:var(--white-40);margin-top:0.15rem">${cvDateText}</div>` : ''}
                    </div>
                </div>
                <div style="display:flex;gap:0.5rem;flex-shrink:0">
                    <button class="client-card-btn download" title="Download CV" onclick="downloadDeveloperCV('${devId}')">
                        <i data-lucide="download" style="width:13px;height:13px"></i>
                    </button>
                    <button class="client-card-btn view" title="Converteer naar Reemo format" onclick="openCvConverterModal({developer_naam: '${(dev.naam || '').replace(/'/g, "\\'")}', cv_url: '${dev.cv_url || cv?.cv_url || ''}', developer_id: '${devId}'})" style="color:#a78bfa">
                        <i data-lucide="sparkles" style="width:13px;height:13px"></i>
                    </button>
                </div>
            </div>`;
    } else {
        cvSectionHtml = `
            <div class="profile-cv-empty" onclick="navigateTo('dev-documents')">
                <i data-lucide="upload-cloud" style="width:1.75rem;height:1.75rem;color:var(--white-20)"></i>
                <div style="font-weight:700;font-size:0.875rem;color:var(--white-50)">Nog geen CV</div>
                <div style="font-size:0.6875rem;color:var(--white-30)">Klik om naar Documents te gaan</div>
            </div>`;
    }

    // Projects list
    const projectListHtml = activeContracts.length
        ? activeContracts.map(p => {
            const uren = parseInt(p.uren_per_week || 40);
            const pct = Math.round(Math.min((uren / capacity) * 100, 999));
            const pctColor = pct > 100 ? '#f87171' : pct > 75 ? '#fbbf24' : '#34d399';
            return `
            <div class="profile-project-row">
                <div>
                    <div class="profile-project-name">${p.projectnaam}</div>
                    <div class="profile-project-meta">${p.klant_naam || 'Onbekende Klant'} · ${p.rol_op_project || 'Developer'}</div>
                </div>
                <div>
                    <div class="profile-project-hours">${uren}u/wk</div>
                    <div class="profile-project-pct" style="color:${pctColor}">${pct}% van cap.</div>
                </div>
            </div>`;
        }).join('')
        : `<div style="font-size:0.875rem;color:var(--white-40);padding:0.5rem 0">Geen actieve projecten.</div>`;

    container.innerHTML = `
        <div class="profile-page-wrap">

            <!-- Header -->
            <div class="profile-header">
                <div class="profile-header-left">
                    <h2>Mijn Profiel</h2>
                    <p>Beheer je beschikbaarheid, skills en CV.</p>
                </div>
            </div>

            <!-- Hero card -->
            <div class="profile-hero">
                <div style="position:relative;flex-shrink:0">
                    <div class="profile-hero-avatar" style="background:linear-gradient(135deg, ${avatarColor}20, ${avatarColor}05);color:${avatarColor};border:1px solid ${avatarColor}40;box-shadow: 0 8px 24px -4px ${avatarColor}15;position:relative">${initials}</div>
                    <div style="position:absolute;bottom:2px;right:2px;width:1rem;height:1rem;border-radius:50%;background:#0c0c0c;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.05)">
                        <div id="profile-avatar-status-dot" style="width:0.625rem;height:0.625rem;border-radius:50%;background:${statusCfg.color};box-shadow:0 0 8px ${statusCfg.color}"></div>
                    </div>
                </div>
                <div class="profile-hero-info">
                    <div class="profile-hero-name">${dev.naam}</div>
                    <div class="profile-hero-role">${role}</div>
                    <div class="profile-hero-badges">
                        <span style="background:rgba(37,99,235,0.1);color:#60a5fa;border:1px solid rgba(37,99,235,0.2);padding:0.25rem 0.75rem;border-radius:9999px;font-size:0.6875rem;font-weight:700">${dev.type || 'ZZP'}</span>
                        <span style="font-size:0.6875rem;color:var(--white-40);display:flex;align-items:center;gap:0.35rem">
                            <i data-lucide="mail" style="width:11px;height:11px"></i> ${dev.email}
                        </span>

                        <!-- Beschikbaarheid toggle -->
                        <div style="position:relative" id="profile-status-wrap">
                            <button id="profile-status-btn" class="profile-status-btn"
                                style="color:${statusCfg.color};border-color:${statusCfg.border};background:${statusCfg.bg}"
                                onclick="toggleProfileStatusDropdown(event)">
                                <span class="profile-status-dot" id="profile-status-dot" style="background:${statusCfg.color};box-shadow:0 0 5px ${statusCfg.color}"></span>
                                <span id="profile-status-label">${statusCfg.label}</span>
                                <i data-lucide="chevron-down" style="width:11px;height:11px;opacity:0.6"></i>
                            </button>
                            <div class="profile-status-dropdown" id="profile-status-dropdown">
                                ${statusOptions}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="profile-hero-stats">
                    <div class="profile-stat-cell">
                        <div class="profile-stat-val" style="color:${isOverAllocated ? '#f87171' : 'var(--white)'}">${capacity}</div>
                        <div class="profile-stat-label">Uren/Week</div>
                    </div>
                    <div class="profile-stat-cell">
                        <div class="profile-stat-val">${activeProjectsCount}</div>
                        <div class="profile-stat-label">Projecten</div>
                    </div>
                    <div class="profile-stat-cell">
                        <div class="profile-stat-val">€${rate}</div>
                        <div class="profile-stat-label">Tarief/Uur</div>
                    </div>
                </div>
            </div>

            <!-- Over-allocation warning -->
            ${isOverAllocated ? `
            <div class="profile-overalloc-banner">
                <i data-lucide="alert-triangle" style="width:14px;height:14px;flex-shrink:0"></i>
                <span>Je bent overalloceerd: <strong>${allocatedHours}u</strong> ingepland op <strong>${capacity}u</strong> capaciteit (${allocatedHours - capacity}u te veel).</span>
            </div>` : ''}

            <!-- Content grid -->
            <div class="profile-content-grid">

                <!-- LEFT column -->
                <div style="display:flex;flex-direction:column;gap:1.25rem">

                    <!-- Personal info card -->
                    <div class="profile-card">
                        <div class="profile-card-header">
                            <div class="profile-card-title">
                                <i data-lucide="user" style="width:13px;height:13px;color:#60a5fa"></i>
                                Persoonlijke Gegevens
                            </div>
                        </div>
                        <div class="profile-card-body">
                            <div class="profile-info-row">
                                <div style="display:flex;align-items:center;gap:0.75rem">
                                    <div style="width:1.75rem;height:1.75rem;border-radius:0.375rem;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;color:var(--white-40)">
                                        <i data-lucide="user" style="width:14px;height:14px"></i>
                                    </div>
                                    <span class="profile-info-key" style="margin:0;padding:0;color:var(--white-40);text-transform:none;letter-spacing:normal">Volledige naam</span>
                                </div>
                                <span class="profile-info-val">${dev.naam}</span>
                            </div>
                            <div class="profile-info-row">
                                <div style="display:flex;align-items:center;gap:0.75rem">
                                    <div style="width:1.75rem;height:1.75rem;border-radius:0.375rem;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;color:var(--white-40)">
                                        <i data-lucide="briefcase" style="width:14px;height:14px"></i>
                                    </div>
                                    <span class="profile-info-key" style="margin:0;padding:0;color:var(--white-40);text-transform:none;letter-spacing:normal">Rol</span>
                                </div>
                                <span class="profile-info-val">${role}</span>
                            </div>
                            <div class="profile-info-row">
                                <div style="display:flex;align-items:center;gap:0.75rem">
                                    <div style="width:1.75rem;height:1.75rem;border-radius:0.375rem;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;color:var(--white-40)">
                                        <i data-lucide="credit-card" style="width:14px;height:14px"></i>
                                    </div>
                                    <span class="profile-info-key" style="margin:0;padding:0;color:var(--white-40);text-transform:none;letter-spacing:normal">Uurtarief</span>
                                </div>
                                <span class="profile-info-val">€ ${rate.toLocaleString('nl-NL')}/u</span>
                            </div>
                            <div class="profile-info-row">
                                <div style="display:flex;align-items:center;gap:0.75rem">
                                    <div style="width:1.75rem;height:1.75rem;border-radius:0.375rem;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;color:var(--white-40)">
                                        <i data-lucide="clock" style="width:14px;height:14px"></i>
                                    </div>
                                    <span class="profile-info-key" style="margin:0;padding:0;color:var(--white-40);text-transform:none;letter-spacing:normal">Weekcapaciteit</span>
                                </div>
                                <span class="profile-info-val">${capacity} uur</span>
                            </div>
                            <div class="profile-info-row">
                                <div style="display:flex;align-items:center;gap:0.75rem">
                                    <div style="width:1.75rem;height:1.75rem;border-radius:0.375rem;background:rgba(255,255,255,0.03);display:flex;align-items:center;justify-content:center;color:var(--white-40)">
                                        <i data-lucide="mail" style="width:14px;height:14px"></i>
                                    </div>
                                    <span class="profile-info-key" style="margin:0;padding:0;color:var(--white-40);text-transform:none;letter-spacing:normal">E-mailadres</span>
                                </div>
                                <span class="profile-info-val">${dev.email}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Skills card -->
                    <div class="profile-card">
                        <div class="profile-card-header">
                            <div class="profile-card-title">
                                <i data-lucide="zap" style="width:13px;height:13px;color:#818cf8"></i>
                                Vaardigheden
                            </div>
                        </div>
                        <div class="profile-card-body">
                            <div style="display:flex;flex-wrap:wrap;gap:0.5rem" id="dev-skills-container">
                                ${skillsHtml}
                            </div>
                            <div class="profile-skill-add">
                                <input type="text" id="new-dev-skill" class="profile-skill-input" placeholder="Bijv. TypeScript, Docker..."
                                    onkeypress="if(event.key==='Enter') addDevSkill('${devId}')">
                                <button class="btn-blue" style="height:2.25rem;padding:0 1rem;font-size:0.8125rem;white-space:nowrap"
                                    onclick="addDevSkill('${devId}')">
                                    + Toevoegen
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- CV card -->
                    <div class="profile-card">
                        <div class="profile-card-header">
                            <div class="profile-card-title">
                                <i data-lucide="file-text" style="width:13px;height:13px;color:#34d399"></i>
                                CV Beheer
                            </div>
                            <button class="btn-outline" style="height:1.75rem;padding:0 0.75rem;font-size:0.6875rem" onclick="navigateTo('dev-documents')">
                                Naar Documents →
                            </button>
                        </div>
                        <div class="profile-card-body">
                            ${cvSectionHtml}
                        </div>
                    </div>

                </div>

                <!-- RIGHT column -->
                <div style="display:flex;flex-direction:column;gap:1.25rem">

                    <!-- Actieve Projecten -->
                    <div class="profile-card" style="${isOverAllocated ? 'border-color:rgba(239,68,68,0.3)' : ''}">
                        <div class="profile-card-header">
                            <div class="profile-card-title">
                                <i data-lucide="briefcase" style="width:13px;height:13px;color:#60a5fa"></i>
                                Actieve Projecten
                            </div>
                            ${isOverAllocated ? `<span style="font-size:0.625rem;font-weight:700;color:#f87171;text-transform:uppercase;letter-spacing:0.05em">${allocatedHours}u / ${capacity}u</span>` : `<span style="font-size:0.6875rem;color:var(--white-30)">${allocatedHours}u / ${capacity}u</span>`}
                        </div>
                        <div class="profile-card-body">
                            ${projectListHtml}
                        </div>
                    </div>

                    <!-- Capaciteitsoverzicht -->
                    <div class="profile-card">
                        <div class="profile-card-header">
                            <div class="profile-card-title">
                                <i data-lucide="bar-chart-2" style="width:13px;height:13px;color:#fbbf24"></i>
                                Capaciteitsoverzicht
                            </div>
                        </div>
                        <div class="profile-card-body">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.625rem">
                                <span style="font-size:0.75rem;color:var(--white-50)">Ingepland</span>
                                <span style="font-size:0.875rem;font-weight:700;color:${isOverAllocated ? '#f87171' : 'var(--white)'}">${allocatedHours}u / ${capacity}u</span>
                            </div>
                            <div style="height:6px;background:rgba(255,255,255,0.06);border-radius:9999px;overflow:hidden;margin-bottom:1rem">
                                <div style="height:100%;width:${Math.min((allocatedHours/capacity)*100,100)}%;background:${isOverAllocated ? 'linear-gradient(90deg,#f87171,#ef4444)' : 'linear-gradient(90deg,#10b981,#34d399)'};border-radius:9999px;transition:width 0.5s ease"></div>
                            </div>
                            ${activeContracts.map(p => {
                                const h = parseInt(p.uren_per_week || 0);
                                const pct = Math.min((h/capacity)*100,100);
                                return `
                                <div style="margin-bottom:0.75rem">
                                    <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem">
                                        <span style="font-size:0.6875rem;color:var(--white-60);font-weight:600">${p.projectnaam}</span>
                                        <span style="font-size:0.6875rem;color:var(--white-40)">${h}u</span>
                                    </div>
                                    <div style="height:4px;background:rgba(255,255,255,0.05);border-radius:9999px;overflow:hidden">
                                        <div style="height:100%;width:${pct}%;background:#3b82f6;border-radius:9999px"></div>
                                    </div>
                                </div>`;
                            }).join('')}
                            <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #161616;display:flex;justify-content:space-between;align-items:center">
                                <span style="font-size:0.6875rem;color:var(--white-30)">Resterend</span>
                                <span style="font-size:0.875rem;font-weight:700;color:${capacity - allocatedHours < 0 ? '#f87171' : '#34d399'}">${capacity - allocatedHours}u/wk</span>
                            </div>
                        </div>
                    </div>

                    <!-- Support -->
                    <div class="profile-card" style="cursor:pointer;transition:border-color 0.2s"
                         onmouseover="this.style.borderColor='rgba(99,102,241,0.3)'"
                         onmouseout="this.style.borderColor='#1a1a1a'"
                         onclick="showToast('Neem contact op met admin@reemo.io voor ondersteuning.')">
                        <div class="profile-card-body" style="display:flex;align-items:center;gap:1rem">
                            <div style="width:2.5rem;height:2.5rem;border-radius:0.75rem;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);display:flex;align-items:center;justify-content:center;color:#818cf8;flex-shrink:0">
                                <i data-lucide="headphones" style="width:16px;height:16px"></i>
                            </div>
                            <div>
                                <div style="font-weight:700;font-size:0.875rem;color:var(--white)">Hulp nodig?</div>
                                <div style="font-size:0.6875rem;color:var(--white-40);margin-top:0.15rem">Contacteer de administratie</div>
                            </div>
                            <i data-lucide="chevron-right" style="width:14px;height:14px;color:var(--white-20);margin-left:auto"></i>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Profile page availability toggle (mirrors dashboard dropdown)
function toggleProfileStatusDropdown(e) {
    e.stopPropagation();
    const dd = document.getElementById('profile-status-dropdown');
    if (!dd) return;
    const isOpen = dd.style.display === 'block';
    dd.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        const close = () => { dd.style.display = 'none'; document.removeEventListener('click', close); };
        setTimeout(() => document.addEventListener('click', close), 10);
    }
}

function updateProfileStatusBadge(status) {
    const cfg = _beschikbaarheidConfig[status] || _beschikbaarheidConfig['beschikbaar'];
    const btn = document.getElementById('profile-status-btn');
    const dot = document.getElementById('profile-status-dot');
    const label = document.getElementById('profile-status-label');
    if (btn) {
        btn.style.color = cfg.color;
        btn.style.borderColor = cfg.border;
        btn.style.background = cfg.bg;
    }
    if (dot) { dot.style.background = cfg.color; dot.style.boxShadow = `0 0 5px ${cfg.color}`; }
    if (label) label.textContent = cfg.label;
    // Also sync the dashboard badge if visible
    updateDevStatusBadge(status);
}


// --- Renderers ---

async function renderDashboardStats() {
    const statsContainer = document.getElementById('dashboard-stats');
    if (!statsContainer) return;

    // Fetch new dashboard data
    const [cashflowRes, perKlantRes] = await Promise.all([
        apiFetchSafe('/api/dashboard/cashflow'),
        apiFetchSafe('/api/dashboard/per-klant')
    ]);
    const cashflowRaw = cashflowRes || {};
    // Nieuwe API geeft mtd + totaal terug, met legacy flat fields als fallback
    const cashflow = cashflowRaw.mtd || {
        verwacht:     cashflowRaw.verwacht     || 0,
        geleverd:     cashflowRaw.geleverd     || 0,
        gefactureerd: cashflowRaw.gefactureerd || 0,
        ontvangen:    cashflowRaw.ontvangen    || 0,
        maand:        new Date().toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' })
    };
    const cashflowTotaal = cashflowRaw.totaal || { ooit_gefactureerd: 0, ooit_ontvangen: 0, openstaand: 0 };
    const realisatie_percentage = cashflowRaw.realisatie_percentage || 0;
    const perKlant = perKlantRes || [];

    // Dashboard KPI Cards
    const activeClients = clients.length || 0;
    
    // Calculate bezetting (total assignedHours / total weekcapaciteit * 100)
    let totalCap = 0, totalAssigned = 0;
    developers.forEach(d => {
        totalCap += (d.weekcapaciteit || 40);
        totalAssigned += (d.assignedHours || 0);
    });
    const bezettingPct = totalCap > 0 ? ((totalAssigned / totalCap) * 100).toFixed(1) : 0;

    const stats = [
        { label: 'Actieve Klanten', value: activeClients, icon: 'users', accent: '#3b82f6', bg: 'rgba(37,99,235,0.08)', border: 'rgba(37,99,235,0.18)', glow: 'rgba(59,130,246,0.15)', trend: '+2 vs. vorige maand', trendUp: true },
        { label: 'Bezetting', value: bezettingPct + '%', icon: 'briefcase', accent: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.18)', glow: 'rgba(16,185,129,0.15)', trend: `${totalAssigned} / ${totalCap}u`, trendUp: true },
        { label: 'Omzet MTD', value: '€' + (cashflow.geleverd / 1000).toFixed(1) + 'k', icon: 'trending-up', accent: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.18)', glow: 'rgba(245,158,11,0.15)', trend: '+8.4% vs. vorige maand', trendUp: true },
        { label: 'Realisatie', value: realisatie_percentage + '%', icon: 'pie-chart', accent: '#6366f1', bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.18)', glow: 'rgba(99,102,241,0.15)', trend: 'geleverd / verwacht', trendUp: realisatie_percentage >= 80, isRealisatie: true }
    ];

    statsContainer.innerHTML = stats.map((s, i) => `
        <div style="position:relative;overflow:hidden;padding:1.25rem 1.375rem;background:${s.isRealisatie ? 'linear-gradient(135deg, rgba(37,99,235,0.1), rgba(99,102,241,0.2))' : '#0d0d0d'};border:1px solid ${s.border};border-radius:0.875rem;cursor:default;transition:transform 0.2s, box-shadow 0.2s;box-shadow:0 0 0 1px rgba(255,255,255,0.03), 0 4px 24px ${s.glow};animation:fadeIn 0.4s ease-out ${i * 0.08}s both"
             onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 0 0 1px rgba(255,255,255,0.06),0 8px 32px ${s.glow}'"
             onmouseleave="this.style.transform='';this.style.boxShadow='0 0 0 1px rgba(255,255,255,0.03),0 4px 24px ${s.glow}'">
            <div style="position:absolute;top:-30px;right:-20px;width:100px;height:100px;border-radius:50%;background:radial-gradient(circle,${s.glow} 0%,transparent 70%);pointer-events:none"></div>
            <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1rem">
                <div style="width:2.5rem;height:2.5rem;border-radius:0.75rem;background:${s.bg};border:1px solid ${s.border};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                    <i data-lucide="${s.icon}" style="width:16px;height:16px;color:${s.accent}"></i>
                </div>
            </div>
            <div style="margin-bottom:0.375rem">
                <div style="font-size:1.875rem;font-weight:900;color:var(--white);letter-spacing:-0.02em;line-height:1">${s.value}</div>
            </div>
            <div style="font-size:0.75rem;font-weight:600;color:var(--white-50);margin-bottom:0.625rem">${s.label}</div>
            <div style="display:flex;align-items:center;gap:0.3rem">
                <i data-lucide="${s.trendUp ? 'trending-up' : 'alert-circle'}" style="width:11px;height:11px;color:${s.trendUp ? '#34d399' : '#f59e0b'}"></i>
                <span style="font-size:0.625rem;color:${s.trendUp ? '#34d399' : '#f59e0b'};font-weight:600">${s.trend}</span>
            </div>
        </div>
    `).join('');

    // Cashflow Funnel Render (Async via live DB)
    if (typeof renderCashflowFunnel === 'function') {
        await renderCashflowFunnel();
    }



    // Per-klant Table Render
    const perKlantBody = document.getElementById('dashboard-per-klant-body');
    if (perKlantBody) {
        const fmtEuro = v => '€' + Number(v||0).toLocaleString('nl-NL', { maximumFractionDigits: 0 });
        perKlantBody.innerHTML = perKlant.map(k => {
            const pct = k.realisatie_percentage || 0;
            let barColor = '#34d399';
            if (pct < 80) barColor = '#f59e0b';
            else if (pct < 95) barColor = '#60a5fa';

            return `
            <tr>
                <td style="padding:0.75rem 1.25rem;font-size:0.875rem;font-weight:700;color:var(--white);border-bottom:1px solid #1a1a1a">${k.klant}</td>
                <td style="padding:0.75rem 1.25rem;font-size:0.8125rem;color:var(--white);text-align:right;border-bottom:1px solid #1a1a1a">${fmtEuro(k.verwacht)}</td>
                <td style="padding:0.75rem 1.25rem;font-size:0.8125rem;color:#60a5fa;font-weight:600;text-align:right;border-bottom:1px solid #1a1a1a">${fmtEuro(k.geleverd)}</td>
                <td style="padding:0.75rem 1.25rem;font-size:0.8125rem;color:var(--white);text-align:right;border-bottom:1px solid #1a1a1a">${fmtEuro(k.gefactureerd)}</td>
                <td style="padding:0.75rem 1.25rem;text-align:right;border-bottom:1px solid #1a1a1a">
                    <div style="display:flex;align-items:center;justify-content:flex-end;gap:0.5rem">
                        <span style="font-size:0.8125rem;font-weight:700;color:var(--white)">${pct}%</span>
                        <div style="width:40px;height:4px;background:var(--white-10);border-radius:2px;overflow:hidden">
                            <div style="height:100%;width:${Math.min(pct, 100)}%;background:${barColor}"></div>
                        </div>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // Aging Analysis Render
    const agingBody = document.getElementById('dashboard-aging-body');
    if (agingBody) {
        let notDue = 0, d1_30 = 0, d30_plus = 0;
        let mostCriticalClient = null, mostCriticalAmount = 0;

        const now = new Date();
        invoices.forEach(inv => {
            if ((inv.status || '').toLowerCase() === 'open' || (inv.status || '').toLowerCase() === 'overdue' || (inv.status || '').toLowerCase() === 'te_laat') {
                const dueDate = new Date(inv.dueDate || inv.vervaldatum || new Date(inv.date || inv.factuurdatum).getTime() + 14 * 86400000);
                const diffTime = now - dueDate;
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                const amount = parseFloat(inv.amount || inv.totaalbedrag) || 0;
                
                if (diffDays <= 0) notDue += amount;
                else if (diffDays <= 30) d1_30 += amount;
                else {
                    d30_plus += amount;
                    if (amount > mostCriticalAmount) {
                        mostCriticalAmount = amount;
                        mostCriticalClient = (inv.klant_naam || inv.clientName || 'Onbekend');
                    }
                }
            }
        });

        const totalOpen = notDue + d1_30 + d30_plus;
        const fmtEuro = v => '€' + (v/1000).toFixed(1) + 'k';
        const calcPct = v => totalOpen > 0 ? (v / totalOpen) * 100 : 0;

        agingBody.innerHTML = `
            <div style="display:flex;flex-direction:column;gap:0.875rem">
                <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem">
                        <div style="display:flex;align-items:center;gap:0.35rem">
                            <div style="width:6px;height:6px;border-radius:50%;background:#3b82f6"></div>
                            <span style="font-size:0.75rem;color:var(--white)">Niet vervallen</span>
                        </div>
                        <span style="font-size:0.8125rem;font-weight:700;color:var(--white)">${fmtEuro(notDue)}</span>
                    </div>
                    <div style="width:100%;height:4px;background:var(--white-10);border-radius:2px;overflow:hidden">
                        <div style="height:100%;width:${calcPct(notDue)}%;background:#3b82f6"></div>
                    </div>
                </div>
                <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem">
                        <div style="display:flex;align-items:center;gap:0.35rem">
                            <div style="width:6px;height:6px;border-radius:50%;background:#f59e0b"></div>
                            <span style="font-size:0.75rem;color:var(--white)">1 - 30 dagen over tijd</span>
                        </div>
                        <span style="font-size:0.8125rem;font-weight:700;color:var(--white)">${fmtEuro(d1_30)}</span>
                    </div>
                    <div style="width:100%;height:4px;background:var(--white-10);border-radius:2px;overflow:hidden">
                        <div style="height:100%;width:${calcPct(d1_30)}%;background:#f59e0b"></div>
                    </div>
                </div>
                <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem">
                        <div style="display:flex;align-items:center;gap:0.35rem">
                            <div style="width:6px;height:6px;border-radius:50%;background:#f43f5e"></div>
                            <span style="font-size:0.75rem;color:var(--white)">30+ dagen over tijd</span>
                        </div>
                        <span style="font-size:0.8125rem;font-weight:700;color:var(--white)">${fmtEuro(d30_plus)}</span>
                    </div>
                    <div style="width:100%;height:4px;background:var(--white-10);border-radius:2px;overflow:hidden">
                        <div style="height:100%;width:${calcPct(d30_plus)}%;background:#f43f5e"></div>
                    </div>
                </div>
            </div>
            ${d30_plus > 0 ? `
            <div style="margin-top:1.25rem;background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.2);padding:0.75rem;border-radius:0.5rem;display:flex;align-items:center;gap:0.5rem">
                <i data-lucide="alert-circle" style="width:16px;height:16px;color:#f43f5e;flex-shrink:0"></i>
                <span style="font-size:0.75rem;color:var(--white-80)">${mostCriticalClient} heeft ${fmtEuro(mostCriticalAmount)} &gt; 30 dagen open staan.</span>
            </div>` : ''}
        `;

    }

    // Update Bezetting Circular Progress Ring and detail cards
    const circleOuter = document.getElementById('bezetting-progress-circle-outer');
    const circleInner = document.getElementById('bezetting-progress-circle-inner');
    const pctText = document.getElementById('bezetting-circle-pct');
    const hoursText = document.getElementById('bezetting-circle-hours');
    const detailsContainer = document.getElementById('bezetting-details-container');

    const pct = Math.min(100, Math.max(0, parseFloat(bezettingPct) || 0));
    [circleOuter, circleInner].forEach(circle => {
        if (circle) {
            const radius = parseFloat(circle.getAttribute('r')) || 72;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (pct / 100) * circumference;
            circle.style.strokeDasharray = circumference;
            circle.style.strokeDashoffset = offset;
        }
    });
    if (pctText) pctText.textContent = Math.round(parseFloat(bezettingPct) || 0) + '%';
    if (hoursText) hoursText.textContent = `${totalAssigned} / ${totalCap}u`;

    const totalDevs = developers.length || 0;
    const assignedDevs = developers.filter(d => (d.assignedHours || 0) > 0).length;
    const benchDevs = totalDevs - assignedDevs;
    const assignedPct = totalDevs > 0 ? ((assignedDevs / totalDevs) * 100).toFixed(1) : 0;
    const benchPct = totalDevs > 0 ? ((benchDevs / totalDevs) * 100).toFixed(1) : 0;


    if (detailsContainer) {
        detailsContainer.innerHTML = `
            <div class="bezetting-detail-card opdracht" style="background:rgba(59,130,246,0.04); border:1px solid rgba(59,130,246,0.12); border-radius:0.75rem; padding:10px 14px; display:flex; flex-direction:column; gap:4px; transition: all 0.2s ease;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="width:7px; height:7px; border-radius:50%; background:#3b82f6; box-shadow: 0 0 5px #3b82f6;"></span>
                    <span style="font-size:0.75rem; font-weight:700; color:var(--white-80);">Op Opdracht</span>
                </div>
                <div style="font-size:1.125rem; font-weight:800; color:#FFFFFF;">
                    ${assignedDevs} <span style="font-size:0.75rem; font-weight:500; color:var(--white-40);">devs (${assignedPct}%)</span>
                </div>
            </div>
            <div class="bezetting-detail-card bench" style="background:rgba(255,255,255,0.015); border:1px solid rgba(255,255,255,0.04); border-radius:0.75rem; padding:10px 14px; display:flex; flex-direction:column; gap:4px; transition: all 0.2s ease;">
                <div style="display:flex; align-items:center; gap:6px;">
                    <span style="width:7px; height:7px; border-radius:50%; background:#64748b;"></span>
                    <span style="font-size:0.75rem; font-weight:700; color:var(--white-80);">Bench (Vrij)</span>
                </div>
                <div style="font-size:1.125rem; font-weight:800; color:#FFFFFF;">
                    ${benchDevs} <span style="font-size:0.75rem; font-weight:500; color:var(--white-40);">devs (${benchPct}%)</span>
                </div>
            </div>
        `;
    }

    if (typeof renderOmzetTrendChart === 'function') {
        renderOmzetTrendChart();
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

let huidigeFunnelPeriode = 'maand';

function setFunnelPeriode(periode, knop) {
  huidigeFunnelPeriode = periode;

  document.querySelectorAll('.funnel-filter-btn').forEach(b => b.classList.remove('active'));
  if (knop) {
    knop.classList.add('active');
  } else {
    const btnMap = {
      'week': 'Week',
      'maand': 'Maand',
      'kwartaal': 'Kwartaal',
      'jaar': 'Jaar'
    };
    const btns = document.querySelectorAll('.funnel-filter-btn');
    btns.forEach(b => {
      if (b.textContent.trim() === btnMap[periode]) b.classList.add('active');
    });
  }

  const labels = {
    'week':     'Deze week',
    'maand':    'Deze maand (MTD)',
    'kwartaal': 'Dit kwartaal',
    'jaar':     'Dit jaar (YTD)'
  };
  const label = document.getElementById('funnel-periode-label');
  if (label) label.textContent = labels[periode];

  renderCashflowFunnel();
}

async function renderCashflowFunnel() {
  try {
    const res = await fetch(`/api/dashboard/cashflow?periode=${huidigeFunnelPeriode}`);
    if (!res.ok) throw new Error('Cashflow endpoint niet bereikbaar');
    const json = await res.json();
    const data = json.data || json;

    const mtd    = data.mtd    || {};
    const totaal = data.totaal || {};

    // Update maand badge
    const maandLabel = document.getElementById('cashflow-maand-label');
    if (maandLabel) maandLabel.textContent = mtd.maand || '';

    const fmt = (v) => '€' + Math.round(v || 0).toLocaleString('nl-NL');

    const v = mtd.verwacht    || 0;
    const g = mtd.geleverd    || 0;
    const f = mtd.gefactureerd || 0;
    const o = mtd.ontvangen   || 0;

    const gapBench      = Math.max(0, v - g);
    const gapFacturatie = Math.max(0, g - f);
    const gapDebiteuren = Math.max(0, f - o);

    // Progress bars: percentage of verwacht
    const pG = v > 0 ? Math.min(100, (g / v) * 100) : 0;
    const pF = v > 0 ? Math.min(100, (f / v) * 100) : 0;
    const pO = v > 0 ? Math.min(100, (o / v) * 100) : 0;

    const html = `
      <div class="cashflow-funnel">
        <div class="funnel-step verwacht">
          <div class="step-number">Stap 1 / 4</div>
          <div class="step-label">Verwacht</div>
          <div class="step-value">${fmt(v)}</div>
          <div class="step-sub">Op basis van contracten</div>
          <div class="step-bar-wrap"><div class="step-bar" style="width:100%"></div></div>
        </div>

        <div class="funnel-chevron">
          <div class="chev-arrow">›</div>
          <div class="gap-amount ${gapBench > 0 ? 'warning' : 'success'}">${gapBench > 0 ? '-' + fmt(gapBench) : '✓'}</div>
        </div>

        <div class="funnel-step geleverd">
          <div class="step-number">Stap 2 / 4</div>
          <div class="step-label">Geleverd</div>
          <div class="step-value">${fmt(g)}</div>
          <div class="step-sub">Goedgekeurde uren</div>
          <div class="step-bar-wrap"><div class="step-bar" style="width:${pG}%"></div></div>
        </div>

        <div class="funnel-chevron">
          <div class="chev-arrow">›</div>
          <div class="gap-amount ${gapFacturatie > 0 ? 'warning' : 'success'}">${gapFacturatie > 0 ? '-' + fmt(gapFacturatie) : '✓'}</div>
        </div>

        <div class="funnel-step gefact">
          <div class="step-number">Stap 3 / 4</div>
          <div class="step-label">Gefactureerd</div>
          <div class="step-value">${fmt(f)}</div>
          <div class="step-sub">Factuur verstuurd</div>
          <div class="step-bar-wrap"><div class="step-bar" style="width:${pF}%"></div></div>
        </div>

        <div class="funnel-chevron">
          <div class="chev-arrow">›</div>
          <div class="gap-amount ${gapDebiteuren > 0 ? 'warning' : 'success'}">${gapDebiteuren > 0 ? '-' + fmt(gapDebiteuren) : '✓'}</div>
        </div>

        <div class="funnel-step ontvangen">
          <div class="step-number">Stap 4 / 4</div>
          <div class="step-label">Ontvangen</div>
          <div class="step-value">${fmt(o)}</div>
          <div class="step-sub">Betaald op bank</div>
          <div class="step-bar-wrap"><div class="step-bar" style="width:${pO}%"></div></div>
        </div>
      </div>

      <div class="funnel-gap-row">
        <span>${gapBench > 0 ? '-' + fmt(gapBench) : '—'} <small>bench verlies</small></span>
        <span>${gapFacturatie > 0 ? '-' + fmt(gapFacturatie) : '—'} <small>te factureren</small></span>
        <span>${gapDebiteuren > 0 ? '-' + fmt(gapDebiteuren) : '—'} <small>openstaand debiteur</small></span>
      </div>

      <div class="funnel-totaal-row">
        <span>Ooit gefactureerd: <strong style="color:#94A3B8;">${fmt(totaal.ooit_gefactureerd)}</strong></span>
        <span>Ontvangen: <strong style="color:#94A3B8;">${fmt(totaal.ooit_ontvangen)}</strong></span>
        <span>Openstaand: <strong style="color:#F59E0B;">${fmt(totaal.openstaand)}</strong></span>
      </div>
    `;

    const container = document.getElementById('dashboard-cashflow-funnel');
    if (container) container.innerHTML = html;
    else console.error('dashboard-cashflow-funnel container niet gevonden');

  } catch(err) {
    console.error('Funnel laden mislukt:', err);
    const container = document.getElementById('dashboard-cashflow-funnel');
    if (container) container.innerHTML = '<p style="color:#EF4444;font-size:12px;padding:8px 0;">Funnel data kon niet worden geladen.</p>';
  }
}

async function renderOmzetTrendChart() {
  const jaar     = document.getElementById('chart-year-select')?.value    || new Date().getFullYear();
  const kwartaal = document.getElementById('chart-quarter-select')?.value || 'all';

  try {
    const res  = await fetch(`/api/dashboard/omzet-trend?jaar=${jaar}&kwartaal=${kwartaal}`);
    const data = await res.json();

    // Update titel dynamisch
    const periodeLabels = {
      'all':'Volledig jaar','Q1':'Q1 (jan–mrt)','Q2':'Q2 (apr–jun)',
      'Q3':'Q3 (jul–sep)','Q4':'Q4 (okt–dec)','6m':'Laatste 6 maanden'
    };
    const sub = document.getElementById('chart-subtitle');
    if (sub) sub.textContent = `${periodeLabels[kwartaal] || kwartaal} ${jaar} — werkelijk vs verwacht`;

    const ctx = document.getElementById('revenueChart') || document.getElementById('omzetTrendChart');
    if (!ctx) return;

    if (window._omzetChart) {
      window._omzetChart.data.labels = data.labels;
      window._omzetChart.data.datasets[0].data = data.werkelijk;
      window._omzetChart.data.datasets[1].data = data.verwacht;
      window._omzetChart.update();
    } else {
      window._omzetChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.labels,
          datasets: [
            {
              label: 'Werkelijk',
              data: data.werkelijk,
              borderColor: '#3B82F6',
              backgroundColor: 'rgba(59,130,246,0.1)',
              borderWidth: 2.5,
              tension: 0.4,
              fill: true,
              pointBackgroundColor: '#3B82F6',
              pointRadius: 4,
              pointHoverRadius: 7,
            },
            {
              label: 'Verwacht',
              data: data.verwacht,
              borderColor: '#F59E0B',
              borderDash: [6,4],
              borderWidth: 2,
              tension: 0.4,
              fill: false,
              pointBackgroundColor: '#F59E0B',
              pointRadius: 4,
              pointHoverRadius: 7,
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 1000,
            easing: 'easeOutBack'
          },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              align: 'end',
              labels: {
                color: '#94A3B8',
                usePointStyle: true,
                pointStyle: 'circle',
                padding: 16,
                font: { size: 11 }
              }
            },
            tooltip: {
              backgroundColor: '#1E293B',
              borderColor: '#334155',
              borderWidth: 1,
              titleColor: '#CBD5E1',
              bodyColor: '#94A3B8',
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: €${ctx.parsed.y.toLocaleString('nl-NL')}`
              }
            }
          },
          scales: {
            x: {
              ticks: { color: '#94A3B8', font: { size: 11 } },
              grid:  { color: 'rgba(51,65,85,0.4)' }
            },
            y: {
              ticks: {
                color: '#94A3B8',
                font: { size: 11 },
                callback: (v) => '€' + (v >= 1000 ? (v/1000).toFixed(0)+'k' : v)
              },
              grid: { color: 'rgba(51,65,85,0.4)' }
            }
          }
        }
      });
    }

  } catch(err) {
    console.error('Grafiek laden mislukt:', err);
  }
}




function renderDashboardTimesheets() {
    const tbody = document.getElementById('dashboard-timesheets-body');
    tbody.innerHTML = timesheets.slice(0, 4).map(ts => `
        <tr class="group cursor-pointer">
            <td>
                <div class="flex items-center gap-3">
                    <div class="avatar-small font-bold text-[10px]">${getInitials(ts.developerName)}</div>
                    <span class="text-sm font-medium text-white">${ts.developerName}</span>
                </div>
            </td>
            <td class="text-sm text-white-60">${ts.clientName}</td>
            <td class="text-sm font-mono text-white">${ts.hoursWorked}h</td>
            <td>
                <span class="status-badge ${getStatusClass(ts.status)}">${ts.status}</span>
            </td>
        </tr>
    `).join('');
}

// Store logo images per client (in-memory)
const clientLogos = {};
var _editingClientId = null;  // tracks which client is being edited

// ── Render client cards ────────────────────────────────────────────────────────
let activeClientSectorFilter = '';

function filterClientsGrid(searchText, statusFilter) {
    renderClientsGrid();
}

function renderClientsGrid() {
    const grid = document.getElementById('clients-grid');
    if (!grid) return;

    const searchInput = document.getElementById('client-search');
    const statusSelect = document.getElementById('client-status-filter');
    const searchText = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const statusFilter = statusSelect ? statusSelect.value.trim().toLowerCase() : '';

    let displayClients = clients;
    if (activeClientSectorFilter) {
        displayClients = displayClients.filter(c => (c.sector || '').toLowerCase() === activeClientSectorFilter.toLowerCase());
    }

    if (searchText) {
        displayClients = displayClients.filter(c => 
            (c.naam || c.name || '').toLowerCase().includes(searchText) ||
            (c.contactpersoon || c.contactPerson || '').toLowerCase().includes(searchText) ||
            (c.email || '').toLowerCase().includes(searchText)
        );
    }

    if (statusFilter) {
        displayClients = displayClients.filter(c => 
            (c.invoiceStatus || '').toLowerCase() === statusFilter
        );
    }

    // Populate sector dropdown if it exists
    const sectorSelect = document.getElementById('cf-sector');
    if (sectorSelect) {
        const uniqueSectors = [...new Set(clients.map(c => c.sector).filter(Boolean))].sort();
        sectorSelect.innerHTML = '<option value="">Alle sectoren</option>' + 
            uniqueSectors.map(s => `<option value="${s}" ${s.toLowerCase() === activeClientSectorFilter.toLowerCase() ? 'selected' : ''}>${s}</option>`).join('');
    }

    if (displayClients.length === 0) {
        grid.innerHTML = `
        <div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem 2rem;text-align:center">
            <div style="width:3.5rem;height:3.5rem;border-radius:1rem;background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.15);display:flex;align-items:center;justify-content:center;margin-bottom:1rem">
                <i data-lucide="users" style="width:22px;height:22px;color:#60a5fa"></i>
            </div>
            <div style="font-size:0.9375rem;font-weight:700;color:var(--white);margin-bottom:0.375rem">Geen klanten gevonden</div>
            <div style="font-size:0.8125rem;color:var(--white-40);margin-bottom:1.25rem">Klik op 'Add Client' om de eerste klant toe te voegen.</div>
            <button class="btn-blue" onclick="openAddClientModal()" style="font-size:0.8125rem">
                <i data-lucide="plus" style="width:14px;height:14px"></i> Add Client
            </button>
        </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    grid.innerHTML = displayClients.map((c, i) => {
        const initials = getInitials(c.naam || c.name || '?');
        const sector   = c.sector    || '—';
        const contact  = c.contactpersoon || c.contactPerson || '—';
        const id       = c.klant_id  || c.id;
        return `
        <div class="client-card" id="client-card-${id}" style="animation:fadeIn 0.25s ease-out ${i*0.06}s both" onclick="openClientDetails('${id}')">
            <div class="client-card-actions">
                <span class="status-badge status-approved" style="font-size:0.5rem">${sector}</span>
                <button onclick="event.stopPropagation(); openContractenModal('${id}', '${(c.naam||c.name||'').replace(/'/g,"\\'")}')" 
                         title="Bekijk contracten" class="btn-contract">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block">
                    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                    <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
                    <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/>
                    <line x1="9" y1="9" x2="10" y2="9"/>
                    <line x1="9" y1="13" x2="15" y2="13"/>
                    <line x1="9" y1="17" x2="15" y2="17"/>
                  </svg>
                </button>
                <button class="client-card-btn" title="Bewerken" onclick="event.stopPropagation();openEditClientModal('${id}')">
                    <i data-lucide="pencil" style="width:12px;height:12px"></i>
                </button>
                <button class="client-card-btn" title="Verwijderen" style="color:#f43f5e" onclick="event.stopPropagation();verwijderKlant('${id}','${(c.naam||'').replace(/'/g,"\\'")}')">
                    <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                </button>
            </div>
            <div class="client-card-header">
                <div class="client-logo-container" style="position:relative;">
                    <div class="client-avatar" onclick="event.stopPropagation(); uploadClientLogo('${id}')" title="Upload logo">
                      ${c.logo_url
                        ? `<img src="${c.logo_url}" alt="${c.naam || c.name}" style="width:100%; height:100%; object-fit:cover;" />`
                        : `<span>${initials}</span>`
                      }
                      <div class="avatar-overlay">
                        <i class="ti ti-camera"></i>
                      </div>
                    </div>
                </div>
                <div style="min-width:0;flex:1">
                    <div class="client-card-name">${c.naam || c.name}</div>
                    <div class="client-card-meta">${sector} • ${contact}</div>
                </div>
            </div>
            <div class="client-stat-grid">
                <div class="client-stat-box">
                    <div class="client-stat-label"><i data-lucide="mail" style="width:10px;height:10px;color:#60a5fa"></i> E-mail</div>
                    <div class="client-stat-value" style="font-size:0.6875rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${c.email || '—'}">${c.email || '—'}</div>
                </div>
                <div class="client-stat-box">
                    <div class="client-stat-label"><i data-lucide="phone" style="width:10px;height:10px;color:#34d399"></i> Telefoon</div>
                    <div class="client-stat-value" style="font-size:0.6875rem;font-weight:600">${c.telefoonnummer || '—'}</div>
                </div>
                <div class="client-stat-box">
                    <div class="client-stat-label"><i data-lucide="folder" style="width:10px;height:10px;color:#fbbf24"></i> Projecten</div>
                    <div class="client-stat-value" style="font-size:0.75rem;font-weight:700;color:var(--white)">${c.project_count || 0} actief</div>
                </div>
                <div class="client-stat-box">
                    <div class="client-stat-label"><i data-lucide="users" style="width:10px;height:10px;color:#a78bfa"></i> Developers</div>
                    <div class="client-stat-value" style="font-size:0.75rem;font-weight:700;color:var(--white)">${c.developer_count || 0} actief</div>
                </div>
            </div>
        </div>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Add Client ─────────────────────────────────────────────────────────────────
function openAddClientModal() {
    _editingClientId = null;
    document.getElementById('client-modal-title').textContent = 'Klant Toevoegen';
    ['client-f-naam','client-f-email','client-f-tel','client-f-sector','client-f-contact'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    openModal('modal-client-form');
}

function openEditClientModal(id) {
    const c = clients.find(x => (x.klant_id || x.id) == id);
    if (!c) return;
    _editingClientId = id;
    document.getElementById('client-modal-title').textContent = 'Klant Bewerken';
    document.getElementById('client-f-naam').value    = c.naam    || '';
    document.getElementById('client-f-email').value   = c.email   || '';
    document.getElementById('client-f-tel').value     = c.telefoonnummer || '';
    document.getElementById('client-f-sector').value  = c.sector  || '';
    document.getElementById('client-f-contact').value = c.contactpersoon || '';
    openModal('modal-client-form');
}

async function submitClientForm(btnElement) {
    const payload = {
        naam:           document.getElementById('client-f-naam').value.trim(),
        email:          document.getElementById('client-f-email').value.trim(),
        telefoonnummer: document.getElementById('client-f-tel').value.trim(),
        sector:         document.getElementById('client-f-sector').value.trim(),
        contactpersoon: document.getElementById('client-f-contact').value.trim(),
    };
    if (!payload.naam) { showToast('⚠ Naam is verplicht.'); return; }

    if (btnElement) {
        btnElement.disabled = true;
        btnElement.innerHTML = '<div class="spinner" style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;vertical-align:middle;margin-right:8px"></div> Opslaan...';
    }

    const isEdit   = !!_editingClientId;
    const url      = isEdit ? `/api/klanten/${_editingClientId}` : '/api/klanten';
    const method   = isEdit ? 'PUT' : 'POST';

    try {
        await apiFetch(url, { method, body: JSON.stringify(payload) });
        await loadClients();
        renderClientsGrid();
        if (typeof renderDashboardStats === 'function') renderDashboardStats();
        closeModal('modal-client-form');
        showToast(isEdit ? `✓ Klant bijgewerkt.` : `✓ ${payload.naam} toegevoegd!`);
    } catch (e) { 
        showToast(`⚠ ${e.message}`); 
    } finally {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = '<i data-lucide="save" style="width:14px;height:14px"></i> Opslaan';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

let _verwijderKlantId = null;

async function verwijderKlant(klantId, naam) {
  _verwijderKlantId = klantId;

  const res = await fetch(`/api/clients/${klantId}/check-actief`);
  const data = await res.json();

  document.getElementById('vk-naam').textContent =
    `Weet je zeker dat je ${naam} wilt verwijderen?`;

  const impact = document.getElementById('vk-impact');
  if (data.actief) {
    document.getElementById('vk-stat-projecten').textContent = data.projecten.length;
    document.getElementById('vk-stat-facturen').textContent = data.aantalFacturen;
    document.getElementById('vk-stat-waarde').textContent =
      '€' + Math.round(data.totaleWaarde).toLocaleString('nl-NL');

    document.getElementById('vk-projecten-lijst').innerHTML = data.projecten
      .map(p => `<li>${p.naam} <span style="color:#64748B;">(${p.status})</span></li>`).join('');

    const extra = [];
    if (data.aantalUren > 0) extra.push(`${data.aantalUren} urenregistraties`);
    if (data.openFacturen > 0) extra.push(`${data.openFacturen} openstaande factu(u)r(en)`);
    if (data.gekoppeldeDevelopers.length > 0)
      extra.push(`Contracten van: ${data.gekoppeldeDevelopers.join(', ')} (developers zelf blijven bestaan)`);
    document.getElementById('vk-extra-info').textContent = extra.join(' • ');

    impact.style.display = 'block';
  } else {
    impact.style.display = 'none';
  }

  // Reset PIN
  ['vk-pin-1','vk-pin-2','vk-pin-3','vk-pin-4'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  updateVKKnop();

  document.getElementById('modal-verwijder-klant').style.display = 'flex';
  document.getElementById('vk-pin-1')?.focus();
}

function movePinFocusVK(current, nextId) {
  if (current.value.length === 1 && nextId) document.getElementById(nextId)?.focus();
  updateVKKnop();
}

function updateVKKnop() {
  const pin = ['vk-pin-1','vk-pin-2','vk-pin-3','vk-pin-4']
    .map(id => document.getElementById(id)?.value || '').join('');
  const btn = document.getElementById('vk-bevestig-btn');
  btn.disabled = pin.length !== 4;
  btn.classList.toggle('active', pin.length === 4);
}

function sluitVerwijderKlantModal() {
  document.getElementById('modal-verwijder-klant').style.display = 'none';
  _verwijderKlantId = null;
}

async function bevestigVerwijderKlant() {
  if (!_verwijderKlantId) return;

  const pin = ['vk-pin-1','vk-pin-2','vk-pin-3','vk-pin-4']
    .map(id => document.getElementById(id)?.value || '').join('');

  const btn = document.getElementById('vk-bevestig-btn');
  btn.disabled = true;
  btn.textContent = 'Bezig met verwijderen...';

  const res = await fetch(`/api/clients/${_verwijderKlantId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': pin }
  });
  const data = await res.json();

  btn.textContent = 'Permanent verwijderen 🗑️';

  if (!res.ok) {
    showToast(`Verwijderen mislukt: ${data.error || 'onbekende fout'}`, 'error');
    btn.disabled = false;
    return;
  }

  sluitVerwijderKlantModal();
  const v = data.verwijderd;
  showToast(`Klant verwijderd (${v.projecten} projecten, ${v.facturen} facturen, ${v.uren} uren)`, 'success');
  await loadClients();
  renderClientsGrid();
  if (typeof renderDashboardStats === 'function') renderDashboardStats();
}

function applyClientFilter() {
    const sector = document.getElementById('cf-sector')?.value || '';
    activeClientSectorFilter = sector;
    renderClientsGrid();
    closeModal('modal-client-filter');
}

function resetClientFilter() {
    activeClientSectorFilter = '';
    const sel = document.getElementById('cf-sector');
    if (sel) sel.value = '';
    renderClientsGrid();
    closeModal('modal-client-filter');
}

// ── Client Detail ──────────────────────────────────────────────────────────────
var _currentClientId = null;
var _clientDetailData = null;
var _clientEditMode   = false;

async function openClientDetails(id) {
    _currentClientId = id;
    _clientEditMode  = false;
    screenContents.forEach(s => s.classList.remove('active'));
    document.getElementById('screen-client-details').classList.add('active');
    document.getElementById('client-detail-content').innerHTML =
        '<div style="padding:3rem;text-align:center;color:var(--white-40)"><div class="spinner" style="width:32px;height:32px;border:3px solid rgba(255,255,255,0.1);border-top-color:#3b82f6;border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 1rem"></div>Laden...</div>';

    try {
        const res = await apiFetch(`/api/klanten/${id}`);
        _clientDetailData = res;
        const { klant, projecten, developers: devs, uren, facturen } = res;
        _renderClientHero(klant, devs, uren, facturen);
        _renderClientDetailContent(klant, projecten, devs, uren, facturen);
    } catch (e) {
        document.getElementById('client-detail-content').innerHTML =
            `<div style="padding:2rem;color:#f43f5e">Fout: ${e.message}</div>`;
    }
}

function _renderClientHero(k, devs, uren, facturen) {
    const initials = getInitials(k.naam);
    const logoEl = document.getElementById('detail-client-logo');
    if (logoEl) {
        logoEl.innerHTML = `
            ${k.logo_url
                ? `<img src="${k.logo_url}" alt="${k.naam}" style="width:100%; height:100%; object-fit:cover;" />`
                : `<span>${initials}</span>`
            }
            <div class="avatar-overlay">
                <i class="ti ti-camera"></i>
            </div>
        `;
        logoEl.className = `client-detail-logo client-avatar ${k.logo_url ? 'has-image' : ''}`;
    }
    document.getElementById('detail-client-name').textContent = k.naam;
    document.getElementById('detail-client-industry').textContent =
        `${k.sector || '—'} • Contactpersoon: ${k.contactpersoon || '—'}`;
    const totUren   = parseFloat(uren?.totaal_uren   || 0);
    const totBilled = parseFloat(uren?.totaal_bedrag  || 0);
    const openCount = facturen.filter(f => (f.betalingsstatus||'').toLowerCase() === 'open').length;
    const fmt = n => n >= 1000 ? '€' + (n/1000).toFixed(1) + 'k' : '€' + n.toFixed(0);
    document.getElementById('detail-stat-hours').textContent   = totUren.toFixed(0) + 'h';
    document.getElementById('detail-stat-billed').textContent  = fmt(totBilled);
    document.getElementById('detail-stat-pending').textContent = openCount;
    document.getElementById('detail-stat-devs').textContent    = devs.length;
}

function _renderClientDetailContent(k, projecten, devs, uren, facturen) {
    const id  = k.klant_id;
    const fmt = n => n >= 1000 ? '€' + (n/1000).toFixed(1) + 'k' : '€' + n.toFixed(0);
    const totUren   = parseFloat(uren?.totaal_uren   || 0);
    const totBilled = parseFloat(uren?.totaal_bedrag  || 0);

    // ── BLOK 1: Klantgegevens ──────────────────────────────────────────────
    const blok1 = `<div class="profile-section-card" id="blok-klantgegevens">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <div class="profile-section-header" style="margin-bottom:0"><i data-lucide="building-2" style="width:14px;height:14px;color:#60a5fa"></i> Klantgegevens</div>
        <div style="display:flex;gap:0.5rem">
          <button id="btn-save-klant" class="btn-blue" style="display:none;font-size:0.75rem;padding:0.3rem 0.75rem" onclick="saveClientDetail(this)"><i data-lucide="save" style="width:12px;height:12px"></i> Opslaan</button>
          <button id="btn-cancel-klant" class="btn-outline" style="display:none;font-size:0.75rem;padding:0.3rem 0.75rem" onclick="cancelClientDetailEdit()">Annuleren</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        ${_ef('kd-naam','Naam',k.naam)}
        ${_ef('kd-sector','Sector',k.sector)}
        ${_ef('kd-email','E-mail',k.email,'email')}
        ${_ef('kd-tel','Telefoonnummer',k.telefoonnummer,'tel')}
        ${_ef('kd-contact','Contactpersoon',k.contactpersoon)}
      </div>
    </div>`;

    // ── BLOK 2: Developers ────────────────────────────────────────────────
    const devRows = devs.length === 0
      ? '<div style="color:var(--white-30);font-size:0.8125rem;padding:1rem 0">Nog geen developers gekoppeld.</div>'
      : devs.map(d => {
          const isFem = ['Sarah','Elena','Niobe','Trinity'].some(n => d.naam.includes(n));
          const projs = (d.projecten || []).map(p => p.projectnaam).join(', ') || '—';
          const devNaamEsc = (d.naam||'').replace(/'/g, "\\'");
          return `<div class="client-dev-row" style="align-items:center">
            <div style="display:flex;align-items:center;gap:0.75rem;flex:1">
              <div class="dev-avatar ${isFem?'female':'male'}">${getInitials(d.naam)}</div>
              <div>
                <div style="font-weight:700;font-size:0.8125rem;color:var(--white)">${d.naam}</div>
                <div style="font-size:0.6875rem;color:var(--white-40)">${d.rol||'—'}</div>
                <div style="font-size:0.625rem;color:var(--white-30);margin-top:0.1rem">${projs}</div>
              </div>
            </div>
            <div style="font-family:monospace;font-size:0.8125rem;color:#34d399;flex-shrink:0;margin-right:0.5rem">€${d.uurtarief||'—'}/h</div>
            <button class="ts-action-btn reject" title="Ontkoppelen" style="flex-shrink:0" onclick="unlinkDeveloper('${id}','${d.developer_id}','${devNaamEsc}',this)">
              <i data-lucide="unlink" style="width:12px;height:12px"></i>
            </button>
          </div>`;
      }).join('');

    const blok2 = `<div class="profile-section-card" id="blok-developers">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="profile-section-header" style="margin-bottom:0"><i data-lucide="users" style="width:14px;height:14px;color:#34d399"></i> Developers (${devs.length})</div>
        <button class="btn-blue" style="font-size:0.6875rem;padding:0.3rem 0.75rem" onclick="openAddDevToClientModal('${id}')">
          <i data-lucide="user-plus" style="width:11px;height:11px"></i> Developer toevoegen
        </button>
      </div>
      <div style="display:flex;flex-direction:column;gap:0.5rem;margin-top:0.75rem">${devRows}</div>
    </div>`;

    // ── BLOK 3: Projecten ──────────────────────────────────────────────────
    const stC = s => { s=(s||'actief').toLowerCase(); return s==='actief'?'#34d399':s==='afgerond'?'#60a5fa':'#fbbf24'; };
    const projRows = projecten.length === 0
      ? '<div style="color:var(--white-30);font-size:0.8125rem;padding:1rem 0">Nog geen projecten gevonden.</div>'
      : projecten.map(p => `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid rgba(255,255,255,0.05)">
          <div>
            <div style="font-weight:700;font-size:0.8125rem;color:var(--white)">${p.projectnaam}</div>
            <div style="font-size:0.6875rem;color:var(--white-40)">${p.type||'—'} • ${p.developer_count || 0} dev(s) • ${formatDateString(p.startdatum)} → ${formatDateString(p.einddatum)}</div>
          </div>
          <span style="font-size:0.5625rem;font-weight:700;text-transform:uppercase;padding:0.2rem 0.5rem;border-radius:0.375rem;background:rgba(16,185,129,0.08);color:${stC(p.status)};border:1px solid rgba(16,185,129,0.2)">${p.status||'Actief'}</span>
        </div>`).join('');

    const blok3 = `<div class="profile-section-card" id="blok-projecten">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="profile-section-header" style="margin-bottom:0"><i data-lucide="folder" style="width:14px;height:14px;color:#60a5fa"></i> Projecten (${projecten.length})</div>
        <button class="btn-blue" style="font-size:0.6875rem;padding:0.3rem 0.75rem" onclick="openAddProjectModal('${id}')">
          <i data-lucide="plus" style="width:11px;height:11px"></i> Project
        </button>
      </div>
      <div style="margin-top:0.5rem">${projRows}</div>
    </div>`;

    // ── BLOK 4: Uren & Omzet ──────────────────────────────────────────────
    const blok4 = `<div class="profile-section-card" id="blok-uren" style="background:linear-gradient(135deg,rgba(16,185,129,0.04),transparent)">
      <div class="profile-section-header"><i data-lucide="clock" style="width:14px;height:14px;color:#fbbf24"></i> Uren &amp; Omzet <span style="font-size:0.625rem;color:var(--white-30)">(alleen goedgekeurd)</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:0.75rem">
        <div style="text-align:center">
          <div style="font-size:2.25rem;font-weight:900;color:var(--white);line-height:1">${totUren.toFixed(0)}<span style="font-size:1rem;color:var(--white-40)">h</span></div>
          <div style="font-size:0.6875rem;color:var(--white-40);margin-top:0.375rem">Totaal goedgekeurde uren</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:2.25rem;font-weight:900;color:#34d399;line-height:1">${fmt(totBilled)}</div>
          <div style="font-size:0.6875rem;color:var(--white-40);margin-top:0.375rem">Totale omzet</div>
        </div>
      </div>
    </div>`;

    // ── BLOK 5: Facturen ──────────────────────────────────────────────────
    const stBadge = st => {
        st = (st||'open').toLowerCase();
        const cfg = { betaald:['rgba(16,185,129,0.12)','#34d399','Betaald'], open:['rgba(245,158,11,0.1)','#fbbf24','Open'], te_laat:['rgba(244,63,94,0.1)','#f43f5e','Te laat'] };
        const [bg,c,label] = cfg[st] || cfg.open;
        return `<span style="font-size:0.5625rem;font-weight:700;text-transform:uppercase;padding:0.2rem 0.5rem;border-radius:0.375rem;background:${bg};color:${c};border:1px solid ${c}55">${label}</span>`;
    };
    const factRows = facturen.length === 0
      ? '<div style="color:var(--white-30);font-size:0.8125rem;padding:1rem 0">Nog geen facturen gevonden.</div>'
      : facturen.map(f => `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.6rem 0;border-bottom:1px solid rgba(255,255,255,0.05)">
          <div>
            <div style="font-weight:700;font-size:0.8125rem;color:var(--white)">${formatDateString(f.factuurdatum)}</div>
            <div style="font-size:0.6875rem;color:var(--white-40)">Vervalt: ${formatDateString(f.vervaldatum)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.625rem">
            <div style="font-weight:700;font-family:monospace;color:var(--white)">€${parseFloat(f.totaalbedrag||0).toLocaleString('nl-NL')}</div>
            ${stBadge(f.betalingsstatus)}
          </div>
        </div>`).join('');

    const blok5 = `<div class="profile-section-card" id="blok-facturen">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="profile-section-header" style="margin-bottom:0"><i data-lucide="receipt" style="width:14px;height:14px;color:#a78bfa"></i> Facturen (${facturen.length})</div>
        <button class="btn-blue" style="font-size:0.6875rem;padding:0.3rem 0.75rem" onclick="openAddFactuurModal('${id}')">
          <i data-lucide="plus" style="width:11px;height:11px"></i> Genereer factuur
        </button>
      </div>
      <div style="margin-top:0.5rem">${factRows}</div>
    </div>`;

    document.getElementById('client-detail-content').innerHTML =
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1.25rem">${blok1}${blok2}${blok3}${blok4}${blok5}</div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Helper: editable field rendering
function _ef(fieldId, label, value, type = 'text') {
    const val = (value || '').replace(/"/g, '&quot;');
    const display = value || '—';
    return `<div>
      <div style="font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--white-40);margin-bottom:0.35rem">${label}</div>
      <div id="${fieldId}-view" style="font-size:0.875rem;font-weight:600;color:var(--white);min-height:1.25rem">${display}</div>
      <input id="${fieldId}-input" type="${type}" value="${val}" class="filter-input" style="display:none;width:100%;font-size:0.875rem;margin-top:0.1rem">
    </div>`;
}

function toggleClientDetailEdit() {
    _clientEditMode = !_clientEditMode;
    const editBtn = document.getElementById('btn-edit-client-detail');
    const saveBtn = document.getElementById('btn-save-klant');
    const cxlBtn  = document.getElementById('btn-cancel-klant');
    ['kd-naam','kd-sector','kd-email','kd-tel','kd-contact'].forEach(id => {
        const view  = document.getElementById(`${id}-view`);
        const input = document.getElementById(`${id}-input`);
        if (view)  view.style.display  = _clientEditMode ? 'none' : 'block';
        if (input) input.style.display = _clientEditMode ? 'block': 'none';
    });
    if (editBtn) editBtn.style.display = _clientEditMode ? 'none' : '';
    if (saveBtn) saveBtn.style.display = _clientEditMode ? '' : 'none';
    if (cxlBtn)  cxlBtn.style.display  = _clientEditMode ? '' : 'none';
}

function cancelClientDetailEdit() {
    _clientEditMode = true;
    toggleClientDetailEdit();
}

async function saveClientDetail(btnElement) {
    const g = id => document.getElementById(id)?.value.trim() || '';
    const payload = {
        naam:           g('kd-naam-input'),
        sector:         g('kd-sector-input'),
        email:          g('kd-email-input'),
        telefoonnummer: g('kd-tel-input'),
        contactpersoon: g('kd-contact-input'),
    };
    if (!payload.naam) { showToast('⚠ Naam is verplicht.'); return; }
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.innerHTML = '<div class="spinner" style="width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;vertical-align:middle;margin-right:6px"></div> Opslaan...';
    }
    try {
        await apiFetch(`/api/clients/${_currentClientId}`, { method: 'PATCH', body: JSON.stringify(payload) });
        showToast('✓ Klantgegevens opgeslagen!');
        await openClientDetails(_currentClientId);
        await loadClients(); renderClientsGrid();
    } catch (e) {
        showToast(`⚠ ${e.message}`);
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = '<i data-lucide="save" style="width:12px;height:12px"></i> Opslaan';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

// ── Developer toevoegen aan klant ─────────────────────────────────────────────
async function openAddDevToClientModal(clientId) {
    const devList  = (await apiFetchSafe(`/api/clients/${clientId}/available-developers`)) || [];
    const projList = _clientDetailData?.projecten || [];

    const devSel  = document.getElementById('add-dev-select');
    const projSel = document.getElementById('add-dev-project-select');

    devSel.innerHTML = devList.length === 0
        ? '<option value="">Alle developers al gekoppeld</option>'
        : '<option value="">— Selecteer developer —</option>' +
          devList.map(d => `<option value="${d.developer_id}">${d.naam} (${d.rol||'Developer'} • €${d.uurtarief||'?'}/h)</option>`).join('');

    projSel.innerHTML = projList.length === 0
        ? '<option value="">Maak eerst een project aan</option>'
        : '<option value="">— Selecteer project —</option>' +
          projList.map(p => `<option value="${p.project_id}">${p.projectnaam}</option>`).join('');

    document.getElementById('modal-add-dev-to-client').dataset.clientId = clientId;
    openModal('modal-add-dev-to-client');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function submitAddDevToClient(btnElement) {
    const clientId    = document.getElementById('modal-add-dev-to-client').dataset.clientId;
    const developerId = document.getElementById('add-dev-select').value;
    const projectId   = document.getElementById('add-dev-project-select').value;
    if (!developerId) { showToast('⚠ Selecteer een developer.'); return; }
    if (!projectId)   { showToast('⚠ Selecteer een project.'); return; }
    if (btnElement) btnElement.disabled = true;
    try {
        await apiFetch(`/api/clients/${clientId}/developers`, {
            method: 'POST',
            body: JSON.stringify({ developer_id: developerId, project_id: projectId })
        });
        closeModal('modal-add-dev-to-client');
        showToast('✓ Developer gekoppeld!');
        await openClientDetails(clientId);
        await loadDevelopers(); renderDevelopersGrid();
    } catch (e) {
        showToast(`⚠ ${e.message}`);
    } finally {
        if (btnElement) btnElement.disabled = false;
    }
}

async function unlinkDeveloper(clientId, developerId, devNaam, btnElement) {
    if (!confirm(`Weet je zeker dat je "${devNaam}" wilt ontkoppelen van alle projecten van deze klant?`)) return;
    if (btnElement) btnElement.disabled = true;
    try {
        await apiFetch(`/api/clients/${clientId}/developers/${developerId}`, { method: 'DELETE' });
        showToast(`✓ ${devNaam} ontkoppeld.`);
        await openClientDetails(clientId);
        await loadDevelopers(); renderDevelopersGrid();
    } catch (e) {
        showToast(`⚠ ${e.message}`);
        if (btnElement) btnElement.disabled = false;
    }
}


// ── Developer Detail ───────────────────────────────────────────────────────────
var _currentDevId = null;

async function openDeveloperDetails(id) {
    _currentDevId = id;
    screenContents.forEach(s => s.classList.remove('active'));
    document.getElementById('screen-developer-details').classList.add('active');
    document.getElementById('developer-detail-content').innerHTML =
        '<div style="padding:3rem;text-align:center;color:var(--white-40)">Laden...</div>';

    try {
        const res = await apiFetch(`/api/developers/${id}`);
        const { developer, projecten, uren, cv } = res;
        renderDeveloperDetailView(developer, projecten, uren, cv);
    } catch (e) {
        document.getElementById('developer-detail-content').innerHTML =
            `<div style="padding:2rem;color:#f43f5e">Fout: ${e.message}</div>`;
    }
}

function renderDeveloperDetailView(dev, projecten, uren, cv) {
    const d = document.getElementById('developer-detail-content');
    if (!d) return;

    const uurtarief = parseFloat(dev.uurtarief) || 0;
    const name = dev.naam || dev.name || 'Developer';
    const isMale = !['Aisha','Elena','Nadia','Sarah'].includes(name.split(' ')[0]);
    const genderColor = isMale ? '#60a5fa' : '#f472b6'; // Blue or Pink theme based on initial setup

    // Calculate totals from uren
    const totalHours = uren.reduce((sum, u) => sum + parseFloat(u.aantal_uren || 0), 0);
    const activeProjects = new Set(uren.map(u => u.project_id)).size || projecten.length;

    // Build recent timesheets list
    const tsHtml = uren.slice(0, 5).map(u => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 0;border-bottom:1px solid rgba(255,255,255,0.05)">
          <div>
              <div style="font-weight:700;color:var(--white);font-size:0.875rem">${u.projectnaam}</div>
              <div style="font-size:0.75rem;color:var(--white-40);margin-top:0.25rem">${u.klant_naam || 'Onbekende Klant'}${u.omschrijving ? ` • ${u.omschrijving}` : ''}</div>
          </div>
          <div style="text-align:right">
              <div style="font-family:monospace;color:var(--white);font-weight:700">${parseFloat(u.aantal_uren)}h</div>
              <div style="font-size:0.75rem;color:var(--white-40);margin-top:0.25rem">${formatDateString(u.datum)}</div>
          </div>
      </div>
    `).join('') || '<div style="color:var(--white-40);font-size:0.875rem;padding:1rem 0">Geen urenregistraties gevonden.</div>';

    // Calculate allocations & capacity breakdown
    const activeContracts = projecten || [];
    const totalCapacity = parseInt(dev.weekcapaciteit) || 40;
    const allocatedHours = activeContracts.reduce((sum, c) => sum + parseInt(c.uren_per_week || 0), 0);
    const availableHours = Math.max(0, totalCapacity - allocatedHours);
    const isOverAllocated = allocatedHours > totalCapacity;
    const colPalette = [
        { bg: '#3b82f6', glow: '#3b82f640', light: 'rgba(59,130,246,0.10)', border: '#3b82f620' },
        { bg: '#10b981', glow: '#10b98140', light: 'rgba(16,185,129,0.10)', border: '#10b98120' },
        { bg: '#f59e0b', glow: '#f59e0b40', light: 'rgba(245,158,11,0.10)', border: '#f59e0b20' },
        { bg: '#ec4899', glow: '#ec489940', light: 'rgba(236,72,153,0.10)', border: '#ec489920' },
        { bg: '#8b5cf6', glow: '#8b5cf640', light: 'rgba(139,92,246,0.10)', border: '#8b5cf620' },
    ];

    // Segmented bar
    let barHtml = activeContracts.length === 0
        ? `<div style="width:100%;height:100%;background:rgba(255,255,255,0.04);border-radius:0.5rem;display:flex;align-items:center;justify-content:center"><span style="font-size:0.75rem;color:var(--white-30)">Geen allocaties</span></div>`
        : activeContracts.map((c, i) => {
            const col = colPalette[i % colPalette.length];
            const hrs = parseInt(c.uren_per_week || 0);
            const pct = Math.min((hrs / totalCapacity) * 100, 100);
            return `<div style="width:${pct}%;height:100%;background:${col.bg};display:flex;align-items:center;justify-content:center;gap:0.3rem;padding:0 0.5rem;overflow:hidden;box-shadow:inset 0 0 10px rgba(0,0,0,0.2)" title="${c.projectnaam}: ${hrs}u/wk"><span style="font-size:0.6875rem;font-weight:800;color:rgba(255,255,255,0.95);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.projectnaam}</span><span style="font-size:0.625rem;color:rgba(255,255,255,0.7);white-space:nowrap">${Math.round(pct)}%</span></div>`;
          }).join('') + (availableHours > 0 ? `<div style="width:${(availableHours/totalCapacity)*100}%;background:rgba(255,255,255,0.05);border-left:1px dashed rgba(255,255,255,0.12);height:100%;display:flex;align-items:center;justify-content:center"><span style="font-size:0.625rem;color:var(--white-20)">Vrij ${availableHours}u</span></div>` : '');

    // Contract cards
    let contractCardsHtml = activeContracts.length === 0
        ? `<div style="grid-column:1/-1;padding:2rem;text-align:center;color:var(--white-30);font-size:0.875rem">Geen actieve contracten.</div>`
        : activeContracts.map((c, i) => {
            const col = colPalette[i % colPalette.length];
            const hrs = parseInt(c.uren_per_week || 0);
            const pct = Math.round(Math.min((hrs / totalCapacity) * 100, 100));
            const start = c.startdatum ? new Date(c.startdatum).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
            const end   = c.einddatum  ? new Date(c.einddatum ).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Doorlopend';
            const weekly = (hrs * parseFloat(c.uurtarief || 0)).toFixed(0);
            return `
            <div style="position:relative;background:${col.light};border:1px solid ${col.border};border-radius:1rem;padding:1.25rem;overflow:hidden;transition:transform 0.15s" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='translateY(0)'">
                <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${col.bg};border-radius:1rem 0 0 1rem"></div>
                <div style="padding-left:0.875rem">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem">
                        <div>
                            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:${col.bg};margin-bottom:0.25rem">Contract</div>
                            <div style="font-size:1rem;font-weight:800;color:var(--white);margin-bottom:0.15rem">${c.projectnaam}</div>
                            <div style="font-size:0.8125rem;color:var(--white-40)">${c.klant_naam}</div>
                        </div>
                        <div style="text-align:right">
                            <div style="font-size:1.5rem;font-weight:800;color:${col.bg}">${hrs}u</div>
                            <div style="font-size:0.7rem;color:var(--white-40)">per week &bull; ${pct}%</div>
                        </div>
                    </div>
                    <div style="width:100%;height:5px;background:rgba(255,255,255,0.07);border-radius:3px;overflow:hidden;margin-bottom:1rem">
                        <div style="height:100%;width:${pct}%;background:${col.bg};border-radius:3px;box-shadow:0 0 6px ${col.bg}60"></div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.625rem">
                        <div style="background:rgba(0,0,0,0.15);border-radius:0.625rem;padding:0.625rem">
                            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--white-30);margin-bottom:0.2rem">Rol</div>
                            <div style="font-size:0.75rem;font-weight:700;color:var(--white)">${c.rol_op_project || 'Developer'}</div>
                        </div>
                        <div style="background:rgba(0,0,0,0.15);border-radius:0.625rem;padding:0.625rem">
                            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--white-30);margin-bottom:0.2rem">Tarief</div>
                            <div style="font-size:0.75rem;font-weight:700;color:#34d399">&euro;${parseFloat(c.uurtarief||0).toFixed(0)}/u</div>
                        </div>
                        <div style="background:rgba(0,0,0,0.15);border-radius:0.625rem;padding:0.625rem">
                            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--white-30);margin-bottom:0.2rem">Week €</div>
                            <div style="font-size:0.75rem;font-weight:700;color:#fbbf24">&euro;${parseInt(weekly).toLocaleString('nl-NL')}</div>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.625rem;margin-top:0.625rem">
                        <div style="background:rgba(0,0,0,0.15);border-radius:0.625rem;padding:0.625rem">
                            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--white-30);margin-bottom:0.2rem">Start</div>
                            <div style="font-size:0.75rem;font-weight:700;color:var(--white)">${start}</div>
                        </div>
                        <div style="background:rgba(0,0,0,0.15);border-radius:0.625rem;padding:0.625rem">
                            <div style="font-size:0.6rem;font-weight:700;text-transform:uppercase;color:var(--white-30);margin-bottom:0.2rem">Einde</div>
                            <div style="font-size:0.75rem;font-weight:700;color:${c.einddatum ? 'var(--white)' : '#34d399'}">${end}</div>
                        </div>
                    </div>
                </div>
            </div>`;
          }).join('')
        + (availableHours > 0 ? `
            <div style="background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);border-radius:1rem;padding:1.25rem;display:flex;align-items:center;justify-content:space-between;grid-column:1/-1">
                <div style="display:flex;align-items:center;gap:0.75rem">
                    <div style="width:2.5rem;height:2.5rem;border-radius:0.625rem;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center">
                        <span style="font-size:0.8125rem;font-weight:800;color:var(--white-30)">${availableHours}u</span>
                    </div>
                    <div><div style="font-weight:600;color:var(--white-40)">Beschikbare capaciteit</div><div style="font-size:0.75rem;color:var(--white-30)">Nog niet gealloceerd</div></div>
                </div>
                <div style="font-size:0.75rem;font-weight:700;color:var(--white-30)">${Math.round((availableHours/totalCapacity)*100)}%</div>
            </div>` : '');

    const allocationsHtml = `
      <div style="background:#111;border:1px solid #1e1e1e;border-radius:1rem;padding:1.5rem;margin-bottom:2rem">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
              <div style="display:flex;align-items:center;gap:0.625rem">
                  <div style="width:2rem;height:2rem;border-radius:0.5rem;background:rgba(59,130,246,0.1);display:flex;align-items:center;justify-content:center">
                      <i data-lucide="bar-chart-2" style="width:14px;height:14px;color:#60a5fa"></i>
                  </div>
                  <div>
                      <h3 style="font-size:0.9375rem;font-weight:800;color:var(--white);margin:0">Contracten & Capaciteit</h3>
                      <div style="font-size:0.7rem;color:var(--white-40);margin-top:0.1rem">${activeContracts.length} actief contract${activeContracts.length !== 1 ? 'en' : ''} &bull; ${totalCapacity}u/wk totaal</div>
                  </div>
              </div>
              <span style="font-size:0.875rem;font-weight:700;color:${isOverAllocated ? '#f43f5e' : allocatedHours === totalCapacity ? '#10b981' : '#fbbf24'}">${allocatedHours}/${totalCapacity}u</span>
          </div>
          ${isOverAllocated ? `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.75rem 1rem;background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.2);border-radius:0.75rem;margin-bottom:1rem;color:#f43f5e;font-size:0.8125rem;font-weight:600"><i data-lucide="alert-triangle" style="width:14px;height:14px"></i> Overgealloceerd! ${allocatedHours - totalCapacity}u boven capaciteit.</div>` : ''}
          <div style="width:100%;height:2rem;display:flex;border-radius:0.5rem;overflow:hidden;margin-bottom:1.5rem;border:1px solid rgba(255,255,255,0.05)">${barHtml}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));gap:1rem">${contractCardsHtml}</div>
      </div>
    `;

    let cvHtml = '';
    if (cv) {
        let skills = [];
        if (typeof cv.skills === 'string') {
            try {
                skills = JSON.parse(cv.skills);
            } catch(e) {
                skills = cv.skills.split(',').map(s => s.trim()).filter(Boolean);
            }
        } else if (Array.isArray(cv.skills)) {
            skills = cv.skills;
        }
        cvHtml = `
            <div style="background:#111;border:1px solid #1e1e1e;border-radius:1rem;padding:1.5rem;margin-bottom:2rem">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
                    <h3 style="font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.5rem;color:var(--white)">
                        <i data-lucide="file-text" style="width:16px;height:16px;color:#34d399"></i> CV Informatie
                    </h3>
                    <a href="/api/cv/file/${encodeURIComponent(cv.savedFilename || cv.cv_url || '')}" target="_blank" class="btn-outline" style="font-size:0.75rem;padding:0.4rem 0.8rem;text-decoration:none">
                        <i data-lucide="download" style="width:12px;height:12px"></i> CV Downloaden
                    </a>
                </div>
                ${skills.length > 0 ? `
                <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1.5rem">
                    ${skills.map(s => `<span style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:0.25rem 0.6rem;border-radius:1rem;font-size:0.6875rem;color:var(--white-60)">${s}</span>`).join('')}
                </div>` : ''}
                ${cv.experience || cv.summary ? `
                <div style="margin-bottom:1rem">
                    <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;color:var(--white-40);margin-bottom:0.5rem">Samenvatting / Ervaring</div>
                    <div style="font-size:0.875rem;color:var(--white-60);line-height:1.6">${(cv.experience || cv.summary).substring(0, 400)}${(cv.experience || cv.summary).length > 400 ? '...' : ''}</div>
                </div>` : ''}
            </div>
        `;
    } else if (dev.cv_url) {
        cvHtml = `
            <div style="background:#111;border:1px solid #1e1e1e;border-radius:1rem;padding:1.5rem;margin-bottom:2rem">
                <div style="display:flex;align-items:center;justify-content:space-between">
                    <h3 style="font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.5rem;color:var(--white)">
                        <i data-lucide="file-text" style="width:16px;height:16px;color:#34d399"></i> CV Informatie
                    </h3>
                    <a href="/api/storage/file/${encodeURIComponent(dev.cv_url)}" target="_blank" class="btn-outline" style="font-size:0.75rem;padding:0.4rem 0.8rem;text-decoration:none">
                        <i data-lucide="download" style="width:12px;height:12px"></i> CV Downloaden
                    </a>
                </div>
            </div>
        `;
    }

    d.innerHTML = `
      <div style="display:grid;grid-template-columns:300px 1fr;gap:2rem">
          <!-- Sidebar -->
          <div>
              <div style="background:#111;border:1px solid #1e1e1e;border-radius:1.25rem;padding:2rem;text-align:center;position:relative">
                  <div style="position:absolute;top:1rem;right:1rem">
                      <span class="status-badge status-approved">${dev.type || 'ZZP'}</span>
                  </div>
                  <div style="width:5rem;height:5rem;border-radius:1rem;background:${genderColor}20;color:${genderColor};display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:800;margin:0 auto 1.25rem">
                      ${getInitials(dev.naam)}
                  </div>
                  <h2 style="font-size:1.25rem;font-weight:800;margin-bottom:0.25rem;color:var(--white)">${dev.naam}</h2>
                  <div style="color:var(--white-40);font-size:0.875rem;margin-bottom:1.5rem">${dev.rol || 'Developer'}</div>
                  
                  <div style="display:grid;grid-template-columns:1fr;gap:1.25rem;text-align:left;margin-top:2rem;padding-top:1.5rem;border-top:1px solid rgba(255,255,255,0.05)">
                      <div>
                          <div style="font-size:0.625rem;text-transform:uppercase;font-weight:700;color:var(--white-40);letter-spacing:0.1em;margin-bottom:0.25rem">Email</div>
                          <div style="font-size:0.75rem;font-weight:600;color:var(--white);word-break:break-word">${dev.email || '—'}</div>
                      </div>
                      <div>
                          <div style="font-size:0.625rem;text-transform:uppercase;font-weight:700;color:var(--white-40);letter-spacing:0.1em;margin-bottom:0.25rem">Uurtarief</div>
                          <div style="font-size:0.8125rem;font-weight:600;color:var(--white)">€${uurtarief.toFixed(2)}</div>
                      </div>
                  </div>
              </div>
          </div>
          
          <!-- Main Content -->
          <div>
              <!-- Stats Row -->
              <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:1rem;margin-bottom:2rem">
                  <div style="background:#111;border:1px solid #1e1e1e;border-radius:1rem;padding:1.5rem">
                      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">
                          <div style="width:2rem;height:2rem;border-radius:0.5rem;background:rgba(59,130,246,0.1);display:flex;align-items:center;justify-content:center">
                              <i data-lucide="clock" style="width:14px;height:14px;color:#60a5fa"></i>
                          </div>
                          <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--white-40)">Totaal Uren</div>
                      </div>
                      <div style="font-size:1.75rem;font-weight:800;color:var(--white)">${totalHours}</div>
                  </div>
                  <div style="background:#111;border:1px solid #1e1e1e;border-radius:1rem;padding:1.5rem">
                      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">
                          <div style="width:2rem;height:2rem;border-radius:0.5rem;background:rgba(16,185,129,0.1);display:flex;align-items:center;justify-content:center">
                              <i data-lucide="folder" style="width:14px;height:14px;color:#34d399"></i>
                          </div>
                          <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--white-40)">Active Projects</div>
                      </div>
                      <div style="font-size:1.75rem;font-weight:800;color:var(--white)">${activeProjects}</div>
                  </div>
                  <div style="background:#111;border:1px solid #1e1e1e;border-radius:1rem;padding:1.5rem">
                      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">
                          <div style="width:2rem;height:2rem;border-radius:0.5rem;background:rgba(244,114,182,0.1);display:flex;align-items:center;justify-content:center">
                              <i data-lucide="calendar" style="width:14px;height:14px;color:#f472b6"></i>
                          </div>
                          <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--white-40)">Capaciteit</div>
                      </div>
                      <div style="font-size:1.75rem;font-weight:800;color:var(--white)">${dev.weekcapaciteit || 40}u <span style="font-size:1rem;color:var(--white-40)">/wk</span></div>
                  </div>
              </div>
              
              ${allocationsHtml}
              ${cvHtml}

              <!-- Recent Timesheets -->
              <div style="background:#111;border:1px solid #1e1e1e;border-radius:1rem;padding:1.5rem">
                  <div style="font-size:1rem;font-weight:800;color:var(--white);margin-bottom:1rem">Recente Urenregistraties</div>
                  ${tsHtml}
              </div>
          </div>
      </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ===== ASSIGN PROJECT MODAL =====
function openAssignProjectModal(devId) {
    document.getElementById('assign-dev-id').value = devId;
    document.getElementById('assign-project-role').value = 'Developer';
    document.getElementById('assign-project-start').value = new Date().toISOString().split('T')[0];
    document.getElementById('assign-project-end').value = '';

    const sel = document.getElementById('assign-project-id');
    if (projects.length === 0) {
        sel.innerHTML = '<option value="">— Geen projecten beschikbaar —</option>';
    } else {
        sel.innerHTML = projects.map(p => 
            `<option value="${p.project_id}">${p.klant_naam} — ${p.projectnaam}</option>`
        ).join('');
    }

    openModal('modal-assign-project');
}

async function submitAssignProject() {
    const devId = document.getElementById('assign-dev-id').value;
    const projectId = document.getElementById('assign-project-id').value;
    const role = document.getElementById('assign-project-role').value;
    const hours = parseInt(document.getElementById('assign-project-hours').value) || 40;
    const start = document.getElementById('assign-project-start').value;
    const end = document.getElementById('assign-project-end').value;

    if (!projectId || !start) {
        showToast('⚠ Project en Start Datum zijn verplicht.');
        return;
    }

    try {
        await apiFetch('/api/developer-projects', {
            method: 'POST',
            body: JSON.stringify({
                developer_id: devId,
                project_id: projectId,
                rol_op_project: role,
                uren_per_week: hours,
                startdatum: start,
                einddatum: end || null
            })
        });
        
        closeModal('modal-assign-project');
        showToast('✓ Developer succesvol toegewezen!');
        
        // Refresh developers to update 'activeProjects' count
        await loadDevelopers();
        renderDevelopersGrid();
    } catch (e) {
        showToast(`⚠ Fout bij toewijzen: ${e.message}`);
    }
}

// ── Add Project modal ─────────────────────────────────────────────────────────
function openAddProjectModal(klantId) {
    document.getElementById('proj-f-klant-id').value = klantId;
    ['proj-f-naam','proj-f-type','proj-f-start','proj-f-eind'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    openModal('modal-project-form');
}

async function submitProjectForm(btnElement) {
    const payload = {
        klant_id:    document.getElementById('proj-f-klant-id').value,
        projectnaam: document.getElementById('proj-f-naam').value.trim(),
        type:        document.getElementById('proj-f-type').value,
        status:      document.getElementById('proj-f-status').value || 'Actief',
        startdatum:  document.getElementById('proj-f-start').value || null,
        einddatum:   document.getElementById('proj-f-eind').value  || null,
    };

    if (!payload.projectnaam) { showToast('⚠ Projectnaam is verplicht.'); return; }
    if (!payload.startdatum)  { showToast('⚠ Startdatum is verplicht.'); return; }

    if (btnElement) {
        btnElement.disabled = true;
        btnElement.innerHTML = '<div class="spinner" style="width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;vertical-align:middle;margin-right:6px"></div> Aanmaken...';
    }

    try {
        await apiFetch('/api/projecten', { method: 'POST', body: JSON.stringify(payload) });
        closeModal('modal-project-form');
        await openClientDetails(payload.klant_id);
        showToast(`✓ Project "${payload.projectnaam}" aangemaakt!`);
    } catch (e) { 
        showToast(`⚠ ${e.message}`); 
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = '<i data-lucide="check" style="width:14px;height:14px"></i> Project Aanmaken';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

// ── Add Factuur modal ─────────────────────────────────────────────────────────
function openAddFactuurModal(klantId) {
    document.getElementById('fact-f-klant-id').value = klantId;
    ['fact-f-datum','fact-f-verval','fact-f-bedrag'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('fact-f-datum').value = new Date().toISOString().slice(0,10);
    openModal('modal-factuur-form');
}

async function submitFactuurForm() {
    const payload = {
        klant_id:     document.getElementById('fact-f-klant-id').value,
        factuurdatum: document.getElementById('fact-f-datum').value,
        vervaldatum:  document.getElementById('fact-f-verval').value || null,
        totaalbedrag: parseFloat(document.getElementById('fact-f-bedrag').value) || null,
    };
    if (!payload.factuurdatum || !payload.totaalbedrag) { showToast('⚠ Datum en bedrag zijn verplicht.'); return; }
    try {
        await apiFetch('/api/facturen', { method: 'POST', body: JSON.stringify(payload) });
        closeModal('modal-factuur-form');
        await openClientDetails(payload.klant_id);
        showToast(`✓ Factuur aangemaakt!`);
    } catch (e) { showToast(`⚠ ${e.message}`); }
}

function uploadClientLogo(clientId) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => { clientLogos[clientId] = ev.target.result; renderClientsGrid(); };
        reader.readAsDataURL(file);
    };
    input.click();
}

function downloadContract(clientId, clientName) {
    const text = `SERVICE AGREEMENT\n\nClient: ${clientName}\nDatum: ${new Date().toLocaleDateString('nl-NL')}\n\nDit dienstverleningsovereenkomst is afgesloten tussen Reemo B.V. en ${clientName}.\n\nBETALINGSVOORWAARDEN\nBetaling binnen 30 dagen na factuurdatum.\n\nHandtekening: ____________________`;
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Contract_${clientName.replace(/\s+/g,'_')}.txt`;
    a.click();
}

// Add back button listener
document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('btn-back-to-clients');
    if (b) b.addEventListener('click', () => navigateTo('clients'));
});




function getStringColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 70%, 60%)`;
}

function renderDevelopersGrid() {
    const container = document.getElementById('developers-grid');
    if (!container) return;

    if (developers.length === 0) {
        container.innerHTML = `
        <div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem 2rem;text-align:center;background:var(--surface);border:1px solid var(--white-5);border-radius:1rem;backdrop-filter:blur(8px)">
            <div style="width:3.5rem;height:3.5rem;border-radius:1rem;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.15);display:flex;align-items:center;justify-content:center;margin-bottom:1rem">
                <i data-lucide="user-plus" style="width:22px;height:22px;color:#34d399"></i>
            </div>
            <div style="font-size:0.9375rem;font-weight:700;color:var(--white);margin-bottom:0.375rem">Geen developers gevonden</div>
            <div style="font-size:0.8125rem;color:var(--white-40);margin-bottom:1.25rem">Klik op 'Onboard Developer' om de eerste developer toe te voegen.</div>
            <button class="btn-emerald" onclick="openOnboardModal()" style="font-size:0.8125rem">
                <i data-lucide="plus" style="width:14px;height:14px"></i> Onboard Developer
            </button>
        </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }
    
    container.innerHTML = developers.map((dev, i) => {
        const devName = dev.name || dev.naam || '?';
        const devRole = dev.role || dev.rol || '—';
        const devRate = dev.hourlyRate || parseFloat(dev.uurtarief) || 0;
        
        // Capacity logic
        const maxHours = dev.weekcapaciteit || 40;
        const assignedHours = dev.assignedHours || 0;
        const capacityPct = Math.min((assignedHours / maxHours) * 100, 100);
        const capacityColor = assignedHours >= maxHours ? '#f43f5e' : (assignedHours >= maxHours * 0.8 ? '#f59e0b' : '#3b82f6');
        
        const devProjects = dev.activeProjects || 0;
        const isBooked = assignedHours > 0;
        
        // Avatar Hash logic
        const avatarColor = getStringColor(devName);
        const avatarBg = `background-color: ${avatarColor}20; color: ${avatarColor}; border: 1px solid ${avatarColor}40;`;

        // Skills logic (max 3 tags)
        const allSkills = dev.skills || [];
        const showSkills = allSkills.slice(0, 3);
        const extraSkills = allSkills.length > 3 ? allSkills.length - 3 : 0;
        const skillsHtml = showSkills.length > 0 
            ? showSkills.map(s => `<span style="background:var(--white-5);border:1px solid var(--white-10);padding:0.15rem 0.4rem;border-radius:0.25rem;font-size:0.6rem;color:var(--white-60)">${s}</span>`).join('') + (extraSkills > 0 ? `<span style="font-size:0.6rem;color:var(--white-40)">+${extraSkills} meer</span>` : '')
            : `<span style="font-size:0.6rem;color:var(--white-30)">Geen skills</span>`;

        return `
        <div class="dev-card" style="animation: fadeIn 0.3s ease-out ${i * 0.1}s both; background: var(--surface); border: 1px solid var(--white-5); border-radius: 1rem; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; backdrop-filter: blur(12px); box-shadow: 0 4px 20px rgba(0,0,0,0.2);">
            
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div style="display:flex;align-items:center;gap:0.75rem;min-width:0;flex:1">
                    <div style="width:2.75rem;height:2.75rem;border-radius:0.75rem;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:800;flex-shrink:0;${avatarBg}">${getInitials(devName)}</div>
                    <div style="min-width:0;flex:1">
                        <div style="font-weight:700;font-size:1rem;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${devName}</div>
                        <div style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--white-40);margin-top:0.15rem">${devRole}</div>
                    </div>
                </div>
                <div style="display:flex;gap:0.35rem;align-items:center;">
                    <button class="btn-outline" style="padding:0.35rem;width:auto;height:auto;border-radius:0.375rem" title="Assign to Project" onclick="openAssignProjectModal('${dev.id}')">
                        <i data-lucide="link" style="width:13px;height:13px;color:#60a5fa"></i>
                    </button>
                    ${dev.cv_url ? `
                    <button class="btn-outline" style="padding:0.35rem;width:auto;height:auto;border-radius:0.375rem" title="Bekijk CV" onclick="viewDeveloperCV('${dev.id}')">
                        <i data-lucide="file-text" style="width:13px;height:13px;color:#34d399"></i>
                    </button>` : ''}
                    <button onclick="verwijderDeveloper('${dev.id}', '${devName}')" 
                             title="Verwijder developer"
                             style="background:transparent; border:none; color:#EF4444; cursor:pointer; padding:4px; display:flex; align-items:center;">
                      <i class="ti ti-trash" style="font-size:16px;"></i>
                    </button>
                </div>
            </div>

            <div style="display:flex;gap:0.3rem;flex-wrap:wrap;align-items:center;min-height:1.25rem">
                ${skillsHtml}
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
                <div style="background:var(--base);border:1px solid var(--white-5);border-radius:0.75rem;padding:0.75rem;cursor:pointer;transition:border-color 0.2s" onmouseover="this.style.borderColor='var(--white-20)'" onmouseout="this.style.borderColor='var(--white-5)'" onclick="event.stopPropagation(); if(${dev.firstClientId}){ openClientDetails('${dev.firstClientId}') } else { showToast('Nog niet gekoppeld aan een klant') }">
                    <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.625rem;font-weight:700;text-transform:uppercase;color:var(--white-40);margin-bottom:0.25rem">
                        <span>Projecten</span>
                        <i data-lucide="layout-grid" style="width:10px;height:10px"></i>
                    </div>
                    <div style="font-weight:700;font-size:1rem;color:var(--white)">${devProjects} <span style="font-size:0.6875rem;color:var(--white-40);font-weight:500">actief</span></div>
                </div>
                <div style="background:var(--base);border:1px solid var(--white-5);border-radius:0.75rem;padding:0.75rem">
                    <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.625rem;font-weight:700;text-transform:uppercase;color:var(--white-40);margin-bottom:0.25rem">
                        <span>Tarief</span>
                        <i data-lucide="dollar-sign" style="width:10px;height:10px"></i>
                    </div>
                    <div style="font-weight:700;font-size:1rem;color:var(--white)">€${devRate}<span style="font-size:0.6875rem;color:var(--white-40);font-weight:500">/u</span></div>
                </div>
            </div>

            <div style="margin-top:auto">
                <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:0.4rem">
                    <div style="display:flex;align-items:center;gap:0.35rem">
                        ${(() => {
                            const b = dev.beschikbaarheid || 'beschikbaar';
                            const cfgMap = {
                                'beschikbaar':      { color: '#34d399', label: 'Beschikbaar' },
                                'gedeeltelijk':     { color: '#fbbf24', label: 'Gedeeltelijk' },
                                'niet beschikbaar': { color: '#f43f5e', label: 'Niet beschikbaar' },
                                'verlof':           { color: '#818cf8', label: 'Verlof' },
                            };
                            const cfg = cfgMap[b] || cfgMap['beschikbaar'];
                            return `<div style="width:6px;height:6px;border-radius:50%;background:${cfg.color};box-shadow:0 0 5px ${cfg.color}"></div>
                                    <span style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${cfg.color}">${cfg.label}</span>`;
                        })()} 
                    </div>
                    <span style="font-size:0.7rem;font-weight:700;color:${capacityColor}">${assignedHours} <span style="color:var(--white-30)">/ ${maxHours}u</span></span>
                </div>
                <div style="width:100%;height:4px;background:var(--white-10);border-radius:2px;overflow:hidden">
                    <div style="height:100%;width:${capacityPct}%;background-color:${capacityColor};box-shadow:0 0 8px ${capacityColor}88;border-radius:2px;transition:width 0.4s ease"></div>
                </div>
            </div>

            <button class="btn-outline" style="width:100%;justify-content:center;margin-top:0.5rem" onclick="openDeveloperDetails('${dev.id}')">View Profile</button>
        </div>
        `;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

let _verwijderDevId = null;

async function verwijderDeveloper(devId, naam) {
  _verwijderDevId = devId;

  // Haal actief-status op
  const res = await fetch(`/api/developers/${devId}/check-actief`);
  const data = await res.json();

  // Vul de modal
  document.getElementById('vd-naam').textContent =
    `Weet je zeker dat je ${naam} wilt verwijderen?`;

  const waarschuwing = document.getElementById('vd-waarschuwing');
  if (data.actief) {
    document.getElementById('vd-aantal').textContent = data.aantalProjecten;
    document.getElementById('vd-projecten').innerHTML = data.projecten
      .map(p => `<li>${p.projectnaam} <span style="color:#64748B;">(${p.klantnaam})</span></li>`)
      .join('');
    waarschuwing.style.display = 'block';
  } else {
    waarschuwing.style.display = 'none';
  }

  document.getElementById('modal-verwijder-developer').style.display = 'flex';
}

function sluitVerwijderDevModal() {
  document.getElementById('modal-verwijder-developer').style.display = 'none';
  _verwijderDevId = null;
}

async function bevestigVerwijderDeveloper() {
  if (!_verwijderDevId) return;

  const btn = document.getElementById('vd-bevestig-btn');
  btn.disabled = true;
  btn.textContent = 'Bezig...';

  const res = await fetch(`/api/developers/${_verwijderDevId}`, { method: 'DELETE' });
  const data = await res.json();

  btn.disabled = false;
  btn.textContent = 'Permanent verwijderen';

  if (!res.ok) {
    showToast(`Verwijderen mislukt: ${data.error || 'onbekende fout'}`, 'error');
    return;
  }

  sluitVerwijderDevModal();
  showToast('Developer is verwijderd', 'success');
  await loadDevelopers();
  if (typeof renderDevelopersGrid === 'function') renderDevelopersGrid();
  if (typeof renderDashboardStats === 'function') renderDashboardStats();
}

// Per-session status overrides
const timesheetStatuses = {};

function renderTimesheetsTable(filterText = '', filterStatus = '') {
    const tbody = document.getElementById('timesheets-body');
    if (!tbody) return;

    const filtered = timesheets.filter(ts => {
        const status = timesheetStatuses[ts.id] || ts.status;
        const matchText = !filterText ||
            (ts.developerName || '').toLowerCase().includes(filterText.toLowerCase()) ||
            (ts.clientName || '').toLowerCase().includes(filterText.toLowerCase()) ||
            (ts.description || '').toLowerCase().includes(filterText.toLowerCase());
        const matchStatus = !filterStatus || filterStatus === 'All Statuses' || (status || '').toLowerCase() === filterStatus.toLowerCase();
        return matchText && matchStatus;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:3rem;text-align:center;color:var(--white-30);font-size:0.875rem">No timesheets found</td></tr>`;
        return;
    }

    const isFemale = name => {
        if (!name || typeof name !== 'string') return false;
        return ['Sarah', 'Elena', 'Niobe', 'Trinity'].some(n => name.includes(n));
    };

    tbody.innerHTML = filtered.map(ts => {
        const status = timesheetStatuses[ts.id] || ts.status;
        const statusClass = getStatusClass(status);
        const initials = getInitials(ts.developerName);
        const avatarBg = isFemale(ts.developerName)
            ? 'background:rgba(236,72,153,0.12);border:1px solid rgba(236,72,153,0.25);color:#f9a8d4'
            : 'background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.25);color:#60a5fa';
        const canApprove = status !== 'Approved';
        const canReject  = status !== 'Rejected';

        return `
        <tr class="ts-row" id="ts-row-${ts.id}">
            <td style="padding:0.875rem 1rem">
                <div style="display:flex;align-items:center;gap:0.625rem">
                    <div style="width:2.25rem;height:2.25rem;border-radius:50%;${avatarBg};display:flex;align-items:center;justify-content:center;font-size:0.625rem;font-weight:800;flex-shrink:0">${initials}</div>
                    <div>
                        <div style="font-weight:700;color:var(--white);font-size:0.875rem">${ts.developerName}</div>
                    </div>
                </div>
            </td>
            <td style="padding:0.875rem 1rem;color:var(--white-60);font-size:0.875rem;font-weight:500">${ts.clientName}</td>
            <td style="padding:0.875rem 1rem;color:var(--white-40);font-size:0.8125rem;font-family:monospace;white-space:nowrap">${ts.date}</td>
            <td style="padding:0.875rem 1rem;color:var(--white-50);font-size:0.8125rem;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${ts.description}">${ts.description}</td>
            <td style="padding:0.875rem 1rem;font-weight:800;font-family:monospace;color:var(--white);white-space:nowrap">${ts.hoursWorked}h</td>
            <td style="padding:0.875rem 1rem">
                <span class="status-badge ${statusClass}">${status}</span>
            </td>
            <td style="padding:0.875rem 1rem;text-align:right">
                <div style="display:flex;justify-content:flex-end;gap:0.375rem">
                    ${canApprove ? `<button class="ts-action-btn approve" title="Goedkeuren" onclick="approveTimesheet('${ts.id}', this)">
                        <i data-lucide="check" style="width:13px;height:13px"></i>
                    </button>` : ''}
                    ${canReject ? `<button class="ts-action-btn reject" title="Afkeuren" onclick="rejectTimesheet('${ts.id}', this)">
                        <i data-lucide="x" style="width:13px;height:13px"></i>
                    </button>` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
    updateTimesheetSummary();
}

async function approveTimesheet(id, btnElement) {
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.innerHTML = '<div class="spinner" style="width:13px;height:13px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite"></div>';
    }
    try {
        await apiFetch(`/api/timesheets/${id}`, {
            method: 'PATCH', body: JSON.stringify({ status: 'approved' })
        });
        await refreshTimesheetsSilent();
        showToast('✓ Timesheet goedgekeurd');
        // Refresh dashboard live data
        if (typeof renderCashflowFunnel === 'function') renderCashflowFunnel();
        if (typeof renderOmzetTrendChart === 'function') renderOmzetTrendChart();
    } catch (e) {
        showToast(`⚠ Fout bij goedkeuren: ${e.message}`);
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = '<i data-lucide="check" style="width:13px;height:13px"></i>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

async function rejectTimesheet(id, btnElement) {
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.innerHTML = '<div class="spinner" style="width:13px;height:13px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite"></div>';
    }
    try {
        await apiFetch(`/api/timesheets/${id}`, {
            method: 'PATCH', body: JSON.stringify({ status: 'rejected' })
        });
        await refreshTimesheetsSilent();
        showToast('✓ Timesheet afgekeurd');
    } catch (e) {
        showToast(`⚠ Fout bij afkeuren: ${e.message}`);
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = '<i data-lucide="x" style="width:13px;height:13px"></i>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

async function approveAllTimesheets(btnElement) {
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.innerHTML = '<div class="spinner" style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;vertical-align:middle;margin-right:8px"></div> Goedkeuren...';
    }
    try {
        await apiFetch('/api/timesheets', { method: 'PATCH' });
        await refreshTimesheetsSilent();
        showToast('✓ Alle openstaande timesheets goedgekeurd');
        // Refresh dashboard live data
        if (typeof renderCashflowFunnel === 'function') renderCashflowFunnel();
        if (typeof renderOmzetTrendChart === 'function') renderOmzetTrendChart();
    } catch (e) {
        showToast(`⚠ Fout bij alles goedkeuren: ${e.message}`);
    } finally {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = '<i data-lucide="check-circle" style="width:14px;height:14px"></i> Approve All';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}

function updateTimesheetSummary() {
    const pending  = timesheets.filter(ts => (ts.status || '').toLowerCase() === 'pending').length;
    const approved = timesheets.filter(ts => (ts.status || '').toLowerCase() === 'approved').length;
    const rejected = timesheets.filter(ts => (ts.status || '').toLowerCase() === 'rejected').length;
    const totalHrs = timesheets.reduce((s, ts) => s + (parseFloat(ts.hoursWorked)||0), 0);
    const el = id => document.getElementById(id);
    if (el('ts-stat-pending'))  el('ts-stat-pending').textContent  = pending;
    if (el('ts-stat-approved')) el('ts-stat-approved').textContent = approved;
    if (el('ts-stat-rejected')) el('ts-stat-rejected').textContent = rejected;
    if (el('ts-stat-hours'))    el('ts-stat-hours').textContent    = totalHrs + 'h';
}

let timesheetAutoRefreshInterval = null;

function startTimesheetAutoRefresh() {
    if (timesheetAutoRefreshInterval) clearInterval(timesheetAutoRefreshInterval);
    timesheetAutoRefreshInterval = setInterval(() => {
        const screen = document.getElementById('screen-timesheets');
        if (screen && screen.classList.contains('active')) {
            refreshTimesheetsSilent();
        }
    }, 30000);
}

function stopTimesheetAutoRefresh() {
    if (timesheetAutoRefreshInterval) {
        clearInterval(timesheetAutoRefreshInterval);
        timesheetAutoRefreshInterval = null;
    }
}

async function refreshTimesheetsSilent(btnElement = null) {
    const originalContent = btnElement ? btnElement.innerHTML : null;
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.innerHTML = '<div class="spinner" style="width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 1s linear infinite;display:inline-block;vertical-align:middle;margin-right:8px"></div> Vernieuwen...';
    }
    try {
        const oldJSON = JSON.stringify(timesheets);
        await loadTimesheets();
        const newJSON = JSON.stringify(timesheets);
        
        if (oldJSON !== newJSON || btnElement) {
            renderTimesheetsTable(
                document.getElementById('ts-search')?.value || '',
                document.getElementById('ts-status-filter')?.value || ''
            );
            updateTimesheetSummary();
            if (typeof renderDashboardStats === 'function') renderDashboardStats();
            if (typeof renderOmzetTrendChart === 'function') renderOmzetTrendChart();
        }
    } catch(e) {
        console.warn('Auto-refresh mislukt:', e);
    } finally {
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = originalContent;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
}



function renderCVDatabase(data) {
    const tbody = document.getElementById('cvs-body');
    if (!tbody) return;
    const rows = data || cvs;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:3rem;text-align:center;color:var(--white-30);font-size:0.875rem">
            <div style="margin-bottom:0.75rem"><i data-lucide="file-x" style="width:28px;height:28px;opacity:0.3"></i></div>
            Nog geen CVs gevonden — upload een CV via de knop hierboven.
        </td></tr>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }

    const isFemale = name => {
        if (!name || typeof name !== 'string') return false;
        return ['Trinity','Niobe','Sarah','Elena'].some(n => name.includes(n));
    };

    tbody.innerHTML = rows.map((cv, i) => {
        const isInactive = cv.status === 'candidate';
        const avatarBg  = isFemale(cv.naam || cv.name)
            ? 'background:rgba(236,72,153,0.12);border:1px solid rgba(236,72,153,0.25);color:#f9a8d4'
            : 'background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.25);color:#60a5fa';

        const statusHtml = cv.cv_url 
            ? `<span class="status-badge status-approved">Reemo Format</span>`
            : `<span class="status-badge" style="background:rgba(255,255,255,0.05);color:var(--white-30);border:1px solid rgba(255,255,255,0.08)">Geen CV geüpload</span>`;

        const skills = typeof cv.skills === 'string' ? cv.skills.split(',').map(s => s.trim()) : (cv.skills || []);
        const skillsHtml = skills.slice(0,4).map(s =>
            `<span style="padding:0.2rem 0.45rem;border-radius:0.375rem;background:rgba(255,255,255,0.05);color:var(--white-50);font-size:0.5625rem;font-weight:700;border:1px solid rgba(255,255,255,0.07);white-space:nowrap">${s}</span>`
        ).join('') + (skills.length > 4 ? `<span style="padding:0.2rem 0.45rem;border-radius:0.375rem;background:rgba(255,255,255,0.03);color:var(--white-30);font-size:0.5625rem;border:1px solid rgba(255,255,255,0.05)">+${skills.length-4}</span>` : '');

        return `
        <tr class="ts-row" style="animation:fadeIn 0.2s ease-out ${i*0.05}s both">
            <td style="padding:0.875rem 1.25rem">
                <div style="display:flex;align-items:center;gap:0.75rem">
                    <div style="width:2.25rem;height:2.25rem;border-radius:0.625rem;${avatarBg};display:flex;align-items:center;justify-content:center;font-size:0.625rem;font-weight:800;flex-shrink:0">${getInitials(cv.naam || cv.name)}</div>
                    <div>
                        <div style="font-weight:700;color:var(--white);font-size:0.875rem">${cv.naam || cv.name}</div>
                    </div>
                </div>
            </td>
            <td style="padding:0.875rem 1.25rem;font-size:0.8125rem;color:var(--white-80);font-weight:600">${cv.rol || cv.role || '—'}</td>
            <td style="padding:0.875rem 1.25rem">
                <div style="display:flex;flex-wrap:wrap;gap:0.25rem">${skillsHtml || '<span style="color:var(--white-30);font-size:0.75rem">—</span>'}</div>
            </td>
            <td style="padding:0.875rem 1.25rem;color:var(--white-30);font-family:monospace;font-size:0.8125rem">${formatDateString(cv.aangemaakt_op || cv.uploadDate)}</td>
            <td style="padding:0.875rem 1.25rem">${statusHtml}</td>
            <td style="padding:0.875rem 1.25rem;text-align:right">
                <div style="display:flex;justify-content:flex-end;gap:0.5rem;align-items:center">
                    ${isInactive ? `<button class="login-ws-btn active" style="font-size:0.625rem;padding:0.25rem 0.5rem;height:auto;flex:none" onclick="activateCVasDeveloper('${cv.developer_id || cv.id}')">ACTIEF</button>` : ''}
                    ${cv.cv_url ? `
                    <button class="ts-action-btn view" title="View CV">
                        <i data-lucide="eye" style="width:13px;height:13px"></i>
                    </button>
                    <button class="ts-action-btn view" title="Download CV" onclick="downloadCV('${cv.developer_id || cv.id}')">
                        <i data-lucide="download" style="width:13px;height:13px"></i>
                    </button>
                    <button class="ts-action-btn view" title="Convert to Reemo format" onclick="openCvConverterModal({developer_naam: '${(cv.naam || cv.name || '').replace(/'/g, "\\'")}', cv_url: '${cv.cv_url || ''}', developer_id: '${cv.developer_id || cv.id}'})" style="color:#a78bfa">
                        <i class="ti ti-sparkles" style="font-size:13px"></i>
                    </button>` : ''}
                    <button onclick="verwijderCV('${cv.developer_id || cv.id}', '${(cv.naam || cv.name || '').replace(/'/g, "\\'")}', ${cv.cv_url ? 'true' : 'false'})" 
                             title="${cv.cv_url ? 'Verwijder CV' : 'Verwijder kandidaat'}" 
                             style="background:transparent; border:none; color:#EF4444; cursor:pointer; padding:4px; display:inline-flex; align-items:center; justify-content:center;">
                        <i class="ti ti-trash" style="font-size:14px"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function filterCVDatabase(searchText) {
    const statusFilter = document.getElementById('cv-status-filter')?.value || '';
    const filtered = cvs.filter(cv => {
        const matchText = !searchText ||
            cv.name.toLowerCase().includes(searchText.toLowerCase()) ||
            cv.skills.some(s => s.toLowerCase().includes(searchText.toLowerCase()));
        const matchStatus = !statusFilter || cv.status === statusFilter;
        return matchText && matchStatus;
    });
    renderCVDatabase(filtered);
}

function uploadCVFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.doc,.docx';
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const name = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g,' ');
        cvs.push({ id: genId('cv'), name, skills: ['To be reviewed'], uploadDate: new Date().toISOString().slice(0,10), status: 'ORIGINAL', cv_url: 'uploads/' + file.name });
        saveCVs();
        renderCVDatabase();
        updateCVStats();
        showToast(`✓ CV "${name}" uploaded successfully!`);
    };
    input.click();
}

function updateCVStats() {
    const total    = developers.length;
    const withCV   = developers.filter(c => !!c.cv_url).length;
    const noCV     = total - withCV;
    const el = id => document.getElementById(id);
    if (el('cv-stat-total'))    el('cv-stat-total').textContent    = total;
    if (el('cv-stat-original')) el('cv-stat-original').textContent = noCV;
    if (el('cv-stat-reemo'))    el('cv-stat-reemo').textContent    = withCV;
    if (el('cv-stat-week')) {
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        el('cv-stat-week').textContent = developers.filter(c => {
            const d = c.aangemaakt_op ? new Date(c.aangemaakt_op) : new Date();
            return d > oneWeekAgo;
        }).length;
    }
}

function downloadCV(cvId) {
    // Look up CV entry to find the server-saved filename
    const cv = cvs.find(c => c.id === cvId);
    if (cv && cv.savedFilename) {
        // Download the original uploaded file from the server
        const a = document.createElement('a');
        a.href = `/api/cv/file/${encodeURIComponent(cv.savedFilename)}`;
        a.download = cv.originalName || cv.savedFilename;
        a.click();
    } else {
        // Fallback: no original file stored, generate simple text
        const name = cv?.name || cvId;
        const text = `CURRICULUM VITAE\n\nNaam: ${name}\nBeheerd door: Reemo B.V.\nDatum: ${new Date().toLocaleDateString('nl-NL')}\n\n[Origineel bestand niet beschikbaar — upload het CV opnieuw via de Upload knop]`;
        const blob = new Blob([text], { type: 'text/plain' });
        const url  = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `CV_${name.replace(/\s+/g,'_')}.txt`;
        a.click(); URL.revokeObjectURL(url);
        showToast('⚠ Origineel bestand niet gevonden — download als tijdelijk .txt bestand.');
    }
}

async function viewDeveloperCV(devId) {
    try {
        const data = await apiFetch(`/api/developers/${devId}/cv-url`);
        if (data && data.url) {
            window.open(data.url, '_blank');
        } else {
            showToast('⚠ CV niet beschikbaar');
        }
    } catch (e) {
        console.error('Fout bij ophalen CV:', e);
        showToast('⚠ CV niet beschikbaar');
    }
}

function convertToReemo(id) {
    const cv = cvs.find(c => c.id === id);
    if (cv) { cv.status = 'REEMO FORMAT'; saveCVs(); renderCVDatabase(); updateCVStats(); }
}

// ===== INVOICE STATS =====
function updateInvoiceStats() {
    const outstanding = invoices.filter(i => ['open','verzonden'].includes((i.status || '').toLowerCase())).reduce((s,i) => s + (i.amount||0), 0);
    const overdue     = invoices.filter(i => {
        const st = (i.status || '').toLowerCase();
        if (st === 'overdue' || st === 'te_laat') return true;
        if (st === 'open' || st === 'verzonden') {
            const dd = new Date(i.paymentDeadline || i.vervaldatum);
            return !isNaN(dd) && dd < new Date();
        }
        return false;
    }).reduce((s,i) => s + (i.amount||0), 0);
    const paid        = invoices.filter(i => ['paid','betaald'].includes((i.status || '').toLowerCase())).reduce((s,i) => s + (i.amount||0), 0);
    const total       = invoices.reduce((s,i) => s + (i.amount||0), 0);
    const fmt = v => {
        if (v >= 1000000) return '\u20ac' + (v/1000000).toFixed(1) + 'm';
        if (v >= 1000)    return '\u20ac' + (v/1000).toFixed(1) + 'k';
        return '\u20ac' + v.toFixed(0);
    };
    const el = id => document.getElementById(id);
    if (el('inv-stat-total'))       el('inv-stat-total').textContent       = fmt(total);
    if (el('inv-stat-outstanding')) el('inv-stat-outstanding').textContent = fmt(outstanding);
    if (el('inv-stat-overdue'))     el('inv-stat-overdue').textContent     = fmt(overdue);
    if (el('inv-stat-paid'))        el('inv-stat-paid').textContent        = fmt(paid);
}

// ===== MARKEER ALS BETAALD =====
function openMarkeerBetaaldModal(invId, clientName, amount) {
    // Verwijder een eventuele bestaande modal
    const existing = document.getElementById('modal-markeer-betaald');
    if (existing) existing.remove();

    const vandaag = new Date().toISOString().split('T')[0];
    const fmt = v => '\u20ac' + Number(v||0).toLocaleString('nl-NL', { maximumFractionDigits: 0 });

    const modal = document.createElement('div');
    modal.id = 'modal-markeer-betaald';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
        <div style="background:#0d0d0d;border:1px solid rgba(255,255,255,0.1);border-radius:1rem;padding:2rem;width:min(420px,92vw);box-shadow:0 24px 64px rgba(0,0,0,0.7)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem">
                <div>
                    <div style="font-size:1rem;font-weight:800;color:var(--white,#fff)">Factuur #${invId} markeren als betaald</div>
                    <div style="font-size:0.75rem;color:rgba(255,255,255,0.4);margin-top:0.2rem">Dit kan niet ongedaan worden gemaakt</div>
                </div>
                <button onclick="document.getElementById('modal-markeer-betaald').remove()" style="width:2rem;height:2rem;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.6);cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center">✕</button>
            </div>

            <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.2);border-radius:0.75rem;padding:1rem 1.25rem;margin-bottom:1.5rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
                    <span style="font-size:0.75rem;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.08em">Klant</span>
                    <span style="font-size:0.875rem;font-weight:700;color:var(--white,#fff)">${clientName}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:0.75rem;font-weight:600;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.08em">Bedrag</span>
                    <span style="font-size:1.25rem;font-weight:900;color:#34d399">${fmt(amount)}</span>
                </div>
            </div>

            <div style="margin-bottom:1.5rem">
                <label style="display:block;font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.4);margin-bottom:0.5rem">Betalingsdatum</label>
                <input id="markeer-betaald-datum" type="date" value="${vandaag}"
                    style="width:100%;padding:0.625rem 0.875rem;background:#1a1a1a;border:1px solid rgba(255,255,255,0.12);border-radius:0.5rem;color:var(--white,#fff);font-size:0.875rem;font-family:inherit;box-sizing:border-box" />
            </div>

            <div style="display:flex;gap:0.75rem;justify-content:flex-end">
                <button onclick="document.getElementById('modal-markeer-betaald').remove()"
                    style="padding:0.625rem 1.25rem;background:transparent;border:1px solid rgba(255,255,255,0.12);border-radius:0.5rem;color:rgba(255,255,255,0.6);cursor:pointer;font-size:0.8125rem;font-weight:600">Annuleer</button>
                <button onclick="confirmMarkeerBetaald('${invId}')"
                    style="padding:0.625rem 1.25rem;background:linear-gradient(135deg,#059669,#10b981);border:none;border-radius:0.5rem;color:#fff;cursor:pointer;font-size:0.8125rem;font-weight:700;display:flex;align-items:center;gap:0.375rem">
                    ✓ Bevestig betaling
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    // Sluit op achtergrond-klik
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function confirmMarkeerBetaald(invId) {
    const datumEl = document.getElementById('markeer-betaald-datum');
    const datum = datumEl ? datumEl.value : new Date().toISOString().split('T')[0];
    const modal = document.getElementById('modal-markeer-betaald');
    if (modal) modal.remove();

    try {
        const resp = await fetch(`${API_BASE}/api/facturen/${invId}/markeer-betaald`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ betalingsdatum: datum })
        });
        const json = await resp.json();
        if (!resp.ok || !json.ok) throw new Error(json.error || 'Onbekende fout');

        showToast(`✓ Factuur #${invId} gemarkeerd als betaald`, 'success');

        // Refresh invoices + stats + dashboard funnel
        await loadInvoices();
        renderInvoicesTable();
        updateInvoiceStats();
        renderDashboardStats();
        // Refresh dashboard live data
        if (typeof renderCashflowFunnel === 'function') renderCashflowFunnel();
        if (typeof renderOmzetTrendChart === 'function') renderOmzetTrendChart();
    } catch (e) {
        showToast('Fout: ' + e.message, 'error');
    }
}


// ===== ADD CLIENT — forwarded to unified modal (see renderClientsGrid section) =====
// openAddClientModal() and submitClientForm() defined above near renderClientsGrid


// ===== CREATE INVOICE =====
async function updateInvoiceStatus(id, newStatus) {
    try {
        await apiFetch(`/api/facturen/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ betalingsstatus: newStatus })
        });
        showToast(`✓ Factuur status geüpdatet`);
        await loadInvoices();
        renderInvoicesTable();
        updateInvoiceStats();
        renderDashboardStats();
    } catch (e) {
        showToast(`⚠ Fout bij updaten status: ${e.message}`);
        renderInvoicesTable();
    }
}

async function openCreateInvoiceModal() {
    // Always re-fetch clients from DB to get the latest
    await loadClients();

    if (clients.length === 0) {
        showToast('⚠ Voeg eerst een klant toe via de Clients pagina.');
        return;
    }

    const sel = document.getElementById('new-inv-client');
    if (sel) sel.innerHTML = clients.map(c =>
        `<option value="${c.id}" data-name="${c.naam||c.name}">${c.naam||c.name}</option>`
    ).join('');
    ['new-inv-amount','new-inv-deadline'].forEach(id => { const e = document.getElementById(id); if(e) e.value=''; });
    openModal('modal-create-invoice');
}
async function submitCreateInvoice() {
    const selEl    = document.getElementById('new-inv-client');
    const klant_id = selEl?.value;
    const clientName = selEl?.options[selEl.selectedIndex]?.dataset.name || '';
    const amount   = parseFloat(document.getElementById('new-inv-amount')?.value);
    const deadline = document.getElementById('new-inv-deadline')?.value;
    if (!klant_id || !amount || amount < 1 || !deadline) { showToast('⚠ Vul alle velden in.'); return; }
    const today = new Date().toISOString().slice(0,10);
    try {
        await apiFetch('/api/facturen', {
            method: 'POST',
            body: JSON.stringify({ klant_id, factuurdatum: today, vervaldatum: deadline, totaalbedrag: amount })
        });
        closeModal('modal-create-invoice');
        await loadInvoices();
        renderInvoicesTable();
        updateInvoiceStats();
        showToast(`✓ Factuur voor ${clientName} aangemaakt!`);
    } catch (e) {
        showToast(`⚠ ${e.message}`);
    }
}

// ===== SLIMME FACTUUR GENERATIE =====
async function loadFactuurAanbeveling() {
    try {
        const res = await fetch('/api/facturen/klaar-om-te-genereren');
        const data = await res.json();
        const maanden = data.maanden;

        const btn = document.getElementById('btn-genereer-facturen');
        const label = document.getElementById('btn-genereer-label');
        const badge = document.getElementById('genereer-badge');
        const dropdown = document.getElementById('maand-dropdown');

        if (!btn) return;

        if (!maanden || maanden.length === 0) {
            // Geen uren klaar
            if (label) label.textContent = 'Genereer facturen';
            btn.disabled = true;
            btn.title = 'Geen goedgekeurde uren gevonden die nog gefactureerd moeten worden';
            if (badge) badge.style.display = 'none';
            if (dropdown) dropdown.style.display = 'none';
            return;
        }

        // Aanbeveling: de meest recente maand met openstaande uren
        const aanbeveling = maanden[0];
        const maandLabel = formatMaand(aanbeveling.maand); // bijv. "juni 2026"

        if (label) label.textContent = `Genereer facturen ${maandLabel}`;
        btn.disabled = false;
        btn.title = '';
        btn.dataset.maand = aanbeveling.maand;

        // Badge met aantal uren
        if (badge) {
            badge.textContent = `${aanbeveling.aantalUren} uren klaar`;
            badge.style.display = 'inline';
        }

        // Als er meerdere maanden zijn: toon dropdown
        if (maanden.length > 1) {
            toonMaandDropdown(maanden);
        } else {
            if (dropdown) dropdown.style.display = 'none';
        }
    } catch (err) {
        console.error('Laden van factuur aanbeveling mislukt:', err);
    }
}

function formatMaand(maandString) {
    const [jaar, maand] = maandString.split('-');
    const namen = ['januari','februari','maart','april','mei','juni',
                   'juli','augustus','september','oktober','november','december'];
    return `${namen[parseInt(maand) - 1]} ${jaar}`;
}

function toonMaandDropdown(maanden) {
    const dropdown = document.getElementById('maand-dropdown');
    if (!dropdown) return;

    dropdown.innerHTML = maanden.map(m =>
        `<option value="${m.maand}">${formatMaand(m.maand)} (${m.aantalUren} uren)</option>`
    ).join('');
    dropdown.style.display = 'block';

    // Set the selected value to the recommendation (first one)
    const btn = document.getElementById('btn-genereer-facturen');
    if (btn && btn.dataset.maand) {
        dropdown.value = btn.dataset.maand;
    }

    // Remove existing listener before adding a new one to avoid double binding
    dropdown.removeEventListener('change', handleDropdownChange);
    dropdown.addEventListener('change', handleDropdownChange);
}

function handleDropdownChange(e) {
    if (!e.target.value) return;
    const btn = document.getElementById('btn-genereer-facturen');
    const label = document.getElementById('btn-genereer-label');
    btn.dataset.maand = e.target.value;
    if (label) label.textContent = `Genereer facturen ${formatMaand(e.target.value)}`;
}

async function genereerFacturen() {
    const btn = document.getElementById('btn-genereer-facturen');
    const label = document.getElementById('btn-genereer-label');
    const maand = btn?.dataset.maand;

    if (!maand) {
        showToast('⚠ Geen maand geselecteerd', 'error');
        return;
    }

    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Bezig met genereren...';

    try {
        const res = await fetch('/api/facturen/genereer-maand', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maand })
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
            showToast(`⚠ Fout: ${data.error || 'Onbekende fout'}`, 'error');
            if (btn) btn.disabled = false;
            if (label) label.textContent = `Genereer facturen ${formatMaand(maand)}`;
            return;
        }

        const resultaten = data.data?.resultaten || data.resultaten || [];
        const aantalNieuw = resultaten.length || 0;

        if (aantalNieuw === 0) {
            showToast('⚠ Geen nieuwe facturen aangemaakt — zijn alle uren al gefactureerd?', 'warning');
        } else {
            showToast(`✓ ${aantalNieuw} factuur${aantalNieuw > 1 ? 'en' : ''} aangemaakt voor ${formatMaand(maand)}`, 'success');
        }

        // Refresh alles
        await loadInvoices();
        renderInvoicesTable();
        updateInvoiceStats();
        if (typeof renderDashboardStats === 'function') renderDashboardStats();
        // Refresh dashboard live data
        if (typeof renderCashflowFunnel === 'function') renderCashflowFunnel();
        if (typeof renderOmzetTrendChart === 'function') renderOmzetTrendChart();
        await loadFactuurAanbeveling(); // Knop update naar volgende openstaande maand
    } catch (err) {
        showToast(`⚠ Fout bij genereren: ${err.message}`, 'error');
        if (btn) btn.disabled = false;
        if (label) label.textContent = `Genereer facturen ${formatMaand(maand)}`;
    }
}

// Helper: simple toast (re-use existing or create minimal)
function showToast(msg, type = 'success') {
    const colors = { success: '#10b981', error: '#ef4444', info: '#6366f1' };
    const borderColor = colors[type] || colors.success;
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:1.5rem;right:1.5rem;z-index:99999;padding:0.875rem 1.25rem;
        background:#111;border:1px solid ${borderColor};border-radius:0.75rem;
        color:var(--white,#fff);font-size:0.8125rem;font-weight:600;max-width:22rem;
        box-shadow:0 8px 32px rgba(0,0,0,0.5);transition:opacity 0.3s ease-out;opacity:1;animation:fadeIn 0.2s ease`;
    document.body.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        setTimeout(() => t.remove(), 300);
    }, 3000);
}

// ===== EXPORT INVOICES =====
function exportInvoices() {
    const lines = ['Invoice ID,Client,Amount,Status,Sent,Deadline'];
    invoices.forEach(i => lines.push(`${i.id},"${i.clientName}",${i.amount},${i.status},${i.dateSent},${i.paymentDeadline}`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'Facturen_Export.csv'; a.click(); URL.revokeObjectURL(url);
    showToast('✓ Facturen geëxporteerd!');
}

function renderInvoicesTable(data) {
    const tbody = document.getElementById('invoices-body');
    if (!tbody) return;
    const rows = data || invoices;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:3rem;text-align:center;color:var(--white-30);font-size:0.875rem">No invoices found</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(inv => {
        const status = inv.status || 'open';
        const isOverdue = status.toLowerCase() === 'overdue' || status.toLowerCase() === 'te_laat';
        const deadlineColor = isOverdue ? '#fb7185' : 'var(--white-40)';
        const clientName = inv.clientName || 'Onbekende Klant';
        const amount = inv.amount || 0;
        return `
        <tr class="ts-row">
            <td style="padding:0.875rem 1.25rem">
                <span style="font-family:monospace;font-weight:700;font-size:0.8125rem;color:#60a5fa">#${(inv.id || '').toUpperCase()}</span>
            </td>
            <td style="padding:0.875rem 1.25rem">
                <div style="display:flex;align-items:center;gap:0.625rem">
                    <div style="width:1.75rem;height:1.75rem;border-radius:0.375rem;background:rgba(37,99,235,0.1);border:1px solid rgba(37,99,235,0.2);display:flex;align-items:center;justify-content:center;font-size:0.5625rem;font-weight:800;color:#60a5fa;flex-shrink:0">${getInitials(clientName)}</div>
                    <span style="font-weight:700;color:var(--white);font-size:0.875rem">${clientName}</span>
                </div>
            </td>
            <td style="padding:0.875rem 1.25rem">
                <span style="font-weight:800;font-size:1rem;color:var(--white)">${formatCurrency(amount)}</span>
            </td>
            <td style="padding:0.875rem 1.25rem;color:var(--white-40);font-size:0.8125rem;font-family:monospace;white-space:nowrap">${inv.dateSent || '—'}</td>
            <td style="padding:0.875rem 1.25rem;font-family:monospace;font-size:0.8125rem;white-space:nowrap;color:${deadlineColor};font-weight:${isOverdue ? '700' : '400'}">
                ${isOverdue ? '<span style="display:inline-flex;align-items:center;gap:0.25rem">⚠ ' : ''}${inv.paymentDeadline || '—'}${isOverdue ? '</span>' : ''}
            </td>
            <td style="padding:0.875rem 1.25rem">
                <select class="status-badge ${getStatusClass(status)}" 
                        style="appearance:none; cursor:pointer; font-family:inherit; font-size:inherit; font-weight:inherit; text-transform:uppercase; border:none; outline:none; text-align:center; padding-right:1rem;" 
                        onchange="updateInvoiceStatus('${inv.id}', this.value)">
                    <option value="open" ${status.toLowerCase() === 'open' ? 'selected' : ''}>OPEN</option>
                    <option value="betaald" ${status.toLowerCase() === 'betaald' || status.toLowerCase() === 'paid' ? 'selected' : ''}>PAID</option>
                    <option value="te_laat" ${status.toLowerCase() === 'te_laat' || status.toLowerCase() === 'overdue' ? 'selected' : ''}>OVERDUE</option>
                </select>
            </td>
            <td style="padding:0.875rem 1.25rem;text-align:right">
                <div style="display:flex;justify-content:flex-end;gap:0.375rem">
                    <button class="ts-action-btn view" title="View Invoice">
                        <i data-lucide="eye" style="width:13px;height:13px"></i>
                    </button>
                    <button class="ts-action-btn view" title="Download PDF" onclick="downloadInvoicePdf('${inv.id}','${clientName}',${amount})">
                        <i data-lucide="download" style="width:13px;height:13px"></i>
                    </button>
                    ${['open','verzonden'].includes(status.toLowerCase()) ? `
                    <button class="ts-action-btn remind" title="Send Reminder">
                        <i data-lucide="bell" style="width:13px;height:13px"></i>
                    </button>
                    <button title="Markeer als betaald" onclick="openMarkeerBetaaldModal('${inv.id}','${clientName}',${amount})"
                        style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.3125rem 0.625rem;border-radius:0.375rem;border:1px solid rgba(16,185,129,0.35);background:rgba(16,185,129,0.08);color:#34d399;cursor:pointer;font-size:0.6875rem;font-weight:700;white-space:nowrap;transition:background 0.15s"
                        onmouseenter="this.style.background='rgba(16,185,129,0.18)'" onmouseleave="this.style.background='rgba(16,185,129,0.08)'">
                        <i data-lucide="check-circle" style="width:11px;height:11px"></i> Betaald
                    </button>` : ''}
                </div>
            </td>
        </tr>
        `;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function filterInvoicesTable(searchText, statusFilter) {
    const filtered = invoices.filter(inv => {
        const matchText = !searchText ||
            (inv.clientName || '').toLowerCase().includes(searchText.toLowerCase()) ||
            (inv.id || '').toLowerCase().includes(searchText.toLowerCase());
        const matchStatus = !statusFilter || statusFilter === 'All Statuses' ||
            (inv.status || '').toLowerCase() === statusFilter.toLowerCase();
        return matchText && matchStatus;
    });
    renderInvoicesTable(filtered);
}

function downloadInvoicePdf(id, clientName, amount) {
    const text = `INVOICE ${id.toUpperCase()}\n\nClient: ${clientName}\nAmount: € ${amount.toLocaleString('nl-NL')}\nIssued by: Reemo B.V.\nDate: ${new Date().toLocaleDateString('nl-NL')}\n\nPayment due within 30 days of invoice date.\n\nThank you for your business.`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Invoice_${id.toUpperCase()}_${clientName.replace(/\s+/g,'_')}.txt`;
    a.click(); URL.revokeObjectURL(url);
}
// --- Charts Setup ---
// ─────────────────────────────────────────────────────────────────────────────
// API base: when served via the Node/Express backend the charts fetch live data
// from Supabase. When served via the Python server (or offline) they fall back
// to the mock data below – nothing breaks either way.
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = ''; // same-origin; empty string works for both servers

/*
async function apiFetch(path) {
    try {
        const res = await fetch(API_BASE + path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'API error');
        return json.data;
    } catch (e) {
        console.warn(`[API] ${path} unavailable, using mock data. (${e.message})`);
        return null;
    }
}
*/
// Multi-year monthly revenue mock data (fallback)
// ── Revenue chart state ────────────────────────────────────────────────────────
// _kwartaalRows: { jaar, kwartaal, geleverd, verwacht }  from /api/revenue-per-kwartaal
// _maandRows:   { jaar, maand, totaal_bedrag, totaal_uren } from /api/revenue-per-maand
let _kwartaalRows     = [];
let _maandRows        = [];
let revenueChart      = null;
let _activeRevenueYear    = new Date().getFullYear();
let _activeRevenueKwartaal = null;   // null = show all Q1-Q4, 1-4 = drill into that quarter

// Maand names per quarter index
const _MAAND_NL = ['Jan','Feb','Mrt','Apr','Mei','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
const _Q_MAANDEN = { 1:[0,1,2], 2:[3,4,5], 3:[6,7,8], 4:[9,10,11] };

// ── Year strip ────────────────────────────────────────────────────────────────
function _changeYear(val) {
    _activeRevenueYear = parseInt(val);
    updateRevenueChart();
}

function _changeQuarter(val) {
    _activeRevenueKwartaal = val === 'null' ? null : parseInt(val);
    updateRevenueChart();
}

function populateYearSelect() {
    const select = document.getElementById('chart-year-select');
    if (!select) return;
    const kwJaren  = _kwartaalRows.map(r => r.jaar);
    const maandJaren = _maandRows.map(r => r.jaar);
    const years = [...new Set([...kwJaren, ...maandJaren])].sort((a,b) => b - a);
    if (years.length === 0) years.push(new Date().getFullYear());
    
    select.innerHTML = years.map(yr => 
        `<option value="${yr}" ${yr === _activeRevenueYear ? 'selected' : ''}>FY${yr}</option>`
    ).join('');
}


// ── Draw / update chart ───────────────────────────────────────────────────────
function _drawRevenueChart(labels, geleverdData, verwachtData) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;
    const revCtx = ctx.getContext('2d');
    const gradG  = revCtx.createLinearGradient(0, 0, 0, 250);
    gradG.addColorStop(0, 'rgba(37,99,235,0.22)');
    gradG.addColorStop(1, 'rgba(37,99,235,0.01)');

    if (revenueChart) {
        revenueChart.data.labels           = labels;
        revenueChart.data.datasets[0].data = geleverdData;
        revenueChart.data.datasets[1].data = verwachtData;
        revenueChart.update('active');
        return;
    }

    revenueChart = new Chart(revCtx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Geleverd (werkelijk)',
                    data: geleverdData,
                    borderColor: '#3b82f6',
                    borderWidth: 2.5,
                    backgroundColor: gradG,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 5,
                    pointBackgroundColor: '#3b82f6',
                    pointBorderColor: '#050505',
                    pointBorderWidth: 2,
                    pointHoverRadius: 8,
                    order: 2
                },
                {
                    label: 'Verwacht (contract)',
                    data: verwachtData,
                    borderColor: '#f59e0b',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#f59e0b',
                    pointBorderColor: '#050505',
                    pointBorderWidth: 2,
                    pointHoverRadius: 7,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            animation: { duration: 350, easing: 'easeInOutQuart' },
            onClick: (evt, elements) => {
                if (elements && elements.length > 0) {
                    const idx = elements[0].index;
                    if (_activeRevenueKwartaal === null) {
                        _activeRevenueKwartaal = idx + 1;
                    } else {
                        _activeRevenueKwartaal = null;
                    }
                    updateRevenueChart();
                }
            },
            plugins: {
                legend: { display: false },   // we have our own HTML legend
                tooltip: {
                    backgroundColor: '#111827',
                    titleColor: '#fff',
                    bodyColor: 'rgba(255,255,255,0.65)',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    padding: 14,
                    callbacks: {
                        label: c => ` ${c.dataset.label}: €${Number(c.parsed.y).toLocaleString('nl-NL', {maximumFractionDigits:0})}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { color: 'rgba(255,255,255,0.4)', font: { size: 11, weight: '700' } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)', borderDash: [3,3] },
                    border: { display: false },
                    ticks: {
                        color: 'rgba(255,255,255,0.3)',
                        font: { size: 11 },
                        callback: v => '€' + (v >= 1000000 ? (v/1000000).toFixed(1)+'M' : (v/1000).toFixed(0)+'k')
                    }
                }
            }
        }
    });
}

// ── Main update: decides quarterly vs monthly view ────────────────────────────
function updateRevenueChart() {
    const yr = _activeRevenueYear;
    const kw = _activeRevenueKwartaal;

    // Sync dropdowns if they exist
    const yrSelect = document.getElementById('chart-year-select');
    if (yrSelect && yrSelect.value !== String(yr)) {
        yrSelect.value = String(yr);
    }
    const qwSelect = document.getElementById('chart-quarter-select');
    if (qwSelect && qwSelect.value !== (kw === null ? 'null' : String(kw))) {
        qwSelect.value = kw === null ? 'null' : String(kw);
    }

    // Update dynamic title
    const titleEl = document.getElementById('revenue-chart-title');
    if (titleEl) {
        titleEl.textContent = kw === null ? `Jaaromzet ${yr}` : `Kwartaalomzet Q${kw} ${yr}`;
    }

    // Update subtitle
    const sub = document.getElementById('chart-subtitle');
    if (sub) {
        if (kw === null) {
            sub.textContent = `Alle kwartalen ${yr} — klik een kwartaal om in te zoomen`;
        } else {
            const maandNamen = _Q_MAANDEN[kw].map(i => _MAAND_NL[i]);
            sub.textContent  = `Q${kw} ${yr} (${maandNamen.join(' / ')}) — klik nogmaals om terug te gaan`;
        }
    }

    if (kw === null) {
        // ── Quarterly overview ───────────────────────────────────────────────
        const labels = ['Q1', 'Q2', 'Q3', 'Q4'];

        // Build geleverd: prefer kwartaal rows, fallback to aggregated maand data
        const kwRows = _kwartaalRows.filter(r => r.jaar === yr);
        const geleverdData = [1,2,3,4].map(q => {
            const r = kwRows.find(x => x.kwartaal === q);
            if (r && r.geleverd > 0) return r.geleverd;
            // Fallback: aggregate monthly data into this quarter
            const maanden = _Q_MAANDEN[q];
            return _maandRows
                .filter(m => m.jaar === yr && maanden.includes(m.maand - 1))
                .reduce((s, m) => s + (m.totaal_bedrag || 0), 0);
        });

        const verwachtData = [1,2,3,4].map(q => {
            const r = kwRows.find(x => x.kwartaal === q);
            return r ? (r.verwacht || 0) : 0;
        });

        _drawRevenueChart(labels, geleverdData, verwachtData);
    } else {
        // ── Monthly drill-down into selected quarter ──────────────────────────
        const maandIdxs = _Q_MAANDEN[kw];   // e.g. [0,1,2] for Q1
        const labels    = maandIdxs.map(i => _MAAND_NL[i]);
        const geleverdData = maandIdxs.map(i => {
            const row = _maandRows.find(r => r.jaar === yr && (r.maand - 1) === i);
            return row ? parseFloat(row.totaal_bedrag || 0) : 0;
        });
        // Expected per month = quarterly expected / 3
        const qRow = _kwartaalRows.find(r => r.jaar === yr && r.kwartaal === kw);
        const verwachtPerMaand = qRow ? Math.round((qRow.verwacht || 0) / 3) : 0;
        const verwachtData = maandIdxs.map(() => verwachtPerMaand);
        _drawRevenueChart(labels, geleverdData, verwachtData);
    }
}

// Legacy alias
const buildRevenueDataFromDB = () => {};


// Draw the Hours-per-Client chart with the given labels & data arrays
let hoursChart = null;
function _drawHoursChart(labels, data) {
    const hoursCtx = document.getElementById('hoursChart');
    if (!hoursCtx) return;
    const colors = ['#2563eb','#3b82f6','#60a5fa','#93c5fd','#bfdbfe','#dbeafe'];

    if (hoursChart) {
        hoursChart.data.labels = labels;
        hoursChart.data.datasets[0].data = data;
        hoursChart.data.datasets[0].backgroundColor = labels.map((_, i) => colors[i % colors.length]);
        hoursChart.update();
        return;
    }

    hoursChart = new Chart(hoursCtx.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Hours',
                data,
                backgroundColor: labels.map((_, i) => colors[i % colors.length]),
                borderRadius: 5,
                barPercentage: 0.55,
                categoryPercentage: 1.0
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#111',
                    titleColor: '#fff',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false
                }
            },
            scales: {
                x: { display: false, grid: { display: false } },
                y: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { color: 'rgba(255,255,255,0.5)', font: { size: 11 }, autoSkip: false }
                }
            }
        }
    });
}

async function initCharts() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = 'rgba(255,255,255,0.4)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    // NOTE: Revenue/omzet chart is driven by renderOmzetTrendChart() via live Supabase data.
    // The legacy populateYearSelect / updateRevenueChart code is NOT called here to avoid conflict.

    // ── Hours per Client ───────────────────────────────────────────────────────
    const hoursRows = await apiFetchSafe('/api/uren-per-klant');
    if (hoursRows && hoursRows.length > 0) {
        const first    = hoursRows[0];
        const nameKey  = Object.keys(first).find(k => /klant|client|naam|name/i.test(k)) || Object.keys(first)[0];
        const hoursKey = Object.keys(first).find(k => /uren|hours|uur/i.test(k))  || Object.keys(first)[1];
        _drawHoursChart(hoursRows.map(r => r[nameKey]), hoursRows.map(r => parseFloat(r[hoursKey]) || 0));
        console.log('[Charts] Hours-per-client loaded \u2713');
    } else {
        _drawHoursChart(['Geen data'], [0]);
    }
}

// ===== MODAL HELPERS =====
function openModal(id) {
    const m = document.getElementById(id);
    if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}
function closeModal(id) {
    const m = document.getElementById(id);
    if (m) { m.style.display = 'none'; document.body.style.overflow = ''; }
}
// Close on overlay click (all modals)
document.addEventListener('click', e => {
    [
        'modal-onboard','modal-adv-filter','modal-add-client','modal-create-invoice',
        'modal-client-form','modal-project-form','modal-factuur-form','modal-client-contracts'
    ].forEach(id => {
        const m = document.getElementById(id);
        if (m && e.target === m) closeModal(id);
    });
});

// ===== ONBOARD DEVELOPER =====
function openOnboardModal() {
    // Reset form
    ['ob-firstname','ob-lastname','ob-email','ob-rate','ob-skills','ob-startdate','ob-link'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    openModal('modal-onboard');
}

async function submitOnboard() {
    const first = document.getElementById('ob-firstname')?.value.trim();
    const last  = document.getElementById('ob-lastname')?.value.trim();
    const email = document.getElementById('ob-email')?.value.trim();
    const rol   = document.getElementById('ob-role')?.value;
    const rate  = parseInt(document.getElementById('ob-rate')?.value) || 70;
    const skillsInput = document.getElementById('ob-skills')?.value || '';
    const skillsArray = skillsInput.split(',').map(s => s.trim()).filter(s => s);

    if (!first || !last || !email) {
        showToast('⚠ Vul Naam en E-mail in.');
        return;
    }

    try {
        await apiFetch('/api/developers', {
            method: 'POST',
            body: JSON.stringify({
                naam: `${first} ${last}`,
                email, rol, type: 'ZZP',
                uurtarief: rate, weekcapaciteit: 40,
                status: 'active',
                skills: JSON.stringify(skillsArray)
            })
        });
        closeModal('modal-onboard');
        await loadDevelopers();
        renderDevelopersGrid();
        renderDashboardStats();
        showToast(`✓ ${first} ${last} is toegevoegd!`);
    } catch (e) {
        showToast(`⚠ ${e.message}`);
    }
}

// ===== ADVANCED FILTER =====
function openAdvancedFilter() {
    openModal('modal-adv-filter');
}

function applyAdvancedFilter() {
    const role    = document.getElementById('af-role')?.value || '';
    const minRate = parseInt(document.getElementById('af-min-rate')?.value) || 0;
    const maxRate = parseInt(document.getElementById('af-max-rate')?.value) || 9999;
    const status  = document.getElementById('af-status')?.value || '';
    const sort    = document.getElementById('af-sort')?.value || 'name';

    let filtered = [...developers].filter(d => {
        const matchRole   = !role || d.role === role;
        const matchRate   = d.hourlyRate >= minRate && d.hourlyRate <= maxRate;
        const isBooked    = (d.hoursThisWeek || 0) >= 38;
        const matchStatus = !status || (status === 'booked' ? isBooked : !isBooked);
        return matchRole && matchRate && matchStatus;
    });

    if (sort === 'rate-desc') filtered.sort((a,b) => b.hourlyRate - a.hourlyRate);
    else if (sort === 'rate-asc') filtered.sort((a,b) => a.hourlyRate - b.hourlyRate);
    else if (sort === 'hours')    filtered.sort((a,b) => (b.hoursThisWeek||0) - (a.hoursThisWeek||0));
    else filtered.sort((a,b) => a.name.localeCompare(b.name));

    closeModal('modal-adv-filter');
    renderDevelopersByData(filtered);
}

function resetAdvancedFilter() {
    ['af-role','af-status','af-sort'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    ['af-min-rate','af-max-rate'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    closeModal('modal-adv-filter');
    renderDevelopersGrid();
}

// ===== DEVELOPER SEARCH & SEGMENT =====
let activeDevFilter = 'all';

function setDevFilter(filter, btn) {
    activeDevFilter = filter;
    document.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const search = document.getElementById('dev-search')?.value || '';
    filterDevelopers(search, filter);
}

function filterDevelopers(searchText, statusFilter) {
    let filtered = developers.filter(d => {
        const name = d.name || d.naam || '';
        const matchText = !searchText ||
            name.toLowerCase().includes(searchText.toLowerCase()) ||
            (d.role || d.rol || '').toLowerCase().includes(searchText.toLowerCase());
        const isBooked = (d.hoursThisWeek || 0) >= 38;
        const matchStatus = !statusFilter || statusFilter === 'all' ||
            (statusFilter === 'booked' ? isBooked : !isBooked);
        return matchText && matchStatus;
    });
    renderDevelopersByData(filtered);
}

function renderDevelopersByData(data) {
    const grid = document.getElementById('developers-grid');
    if (!grid) return;
    if (data.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--white-30);font-size:0.875rem">No developers match your filter.</div>`;
        return;
    }
    const _backup = developers;
    developers = data;
    renderDevelopersGrid();
    developers = _backup;
}
// Alias used by older call-sites
const renderDeveloperCards = renderDevelopersGrid;

// ===== TOAST NOTIFICATION REDIRECTED TO UNIFIED HELPER =====

// ===== DEVELOPER TIMESHEETS =====

function renderDevTimesheets(data) {
    const tbody = document.getElementById('dev-ts-body');
    if (!tbody) return;
    
    const currentDevId = developers[0]?.id; // Mock logged-in dev
    const searchText = document.getElementById('dev-ts-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('dev-ts-filter')?.value || '';

    let rows = timesheets.filter(t => t.developer_id === currentDevId);

    if (searchText || statusFilter) {
        rows = rows.filter(e => {
            const matchText = !searchText ||
                (e.projectName || '').toLowerCase().includes(searchText) ||
                (e.description || '').toLowerCase().includes(searchText);
            const matchStatus = !statusFilter || (e.status || '') === statusFilter;
            return matchText && matchStatus;
        });
    }

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:2.5rem;text-align:center;color:var(--white-30);font-size:0.875rem">No entries found</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(entry => {
        const isPending  = (entry.status || '').toLowerCase() === 'pending';
        const isApproved = (entry.status || '').toLowerCase() === 'approved';
        const statusStyle = isPending
            ? 'background:rgba(245,158,11,0.1);color:#fbbf24;border:1px solid rgba(245,158,11,0.2)'
            : isApproved
            ? 'background:rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2)'
            : 'background:rgba(244,63,94,0.1);color:#fb7185;border:1px solid rgba(244,63,94,0.2)';
        
        const desc = entry.description || '';
        const isOvertime = desc.includes('[OVERTIME]');
        const typeStr = isOvertime ? 'Overtime' : 'Regular';
        const typeColor = isOvertime ? '#fbbf24' : 'var(--white-50)';
        const dateStr = entry.date || '—';

        return `
        <tr class="ts-row" title="${desc.replace('[OVERTIME] ', '')}">
            <td style="padding:0.875rem 1.25rem;color:var(--white-50);font-size:0.8125rem">${dateStr}</td>
            <td style="padding:0.875rem 1.25rem;font-weight:600;color:#60a5fa;font-size:0.875rem">${entry.projectName}</td>
            <td style="padding:0.875rem 1.25rem;color:var(--white-80);font-size:0.8125rem">${entry.hoursWorked}h</td>
            <td style="padding:0.875rem 1.25rem;color:${typeColor};font-size:0.8125rem">${typeStr}</td>
            <td style="padding:0.875rem 1.25rem"><span class="status-badge" style="${statusStyle}">${entry.status}</span></td>
            <td style="padding:0.875rem 1.25rem;text-align:right">
                ${isPending ? `<button class="ts-action-btn reject" title="Delete entry" onclick="deleteDevTimesheet('${entry.id}')">
                    <i data-lucide="trash-2" style="width:13px;height:13px"></i>
                </button>` : '<span style="font-size:0.6875rem;color:var(--white-30)">—</span>'}
            </td>
        </tr>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function updateDevTsStats() {
    const currentDevId = activeDeveloper?.id || developers[0]?.id;
    const devTs = timesheets.filter(t => t.developer_id === currentDevId);
    
    // --- This Week: only uren from Mon-Sun of the current week ---
    const now = new Date();
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0 ... Sun=6
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    const thisWeek = devTs
        .filter(e => {
            if (!e.date) return false;
            // e.date comes from formatDateString which gives DD-MM-YYYY
            const parts = e.date.split('-');
            let d;
            if (parts.length === 3 && parts[2].length === 4) {
                // DD-MM-YYYY format
                d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            } else {
                d = new Date(e.date);
            }
            return d >= monday && d <= sunday;
        })
        .reduce((s, e) => s + (parseFloat(e.hoursWorked)||0), 0);

    const approved = devTs.filter(e => (e.status || '').toLowerCase() === 'approved').reduce((s, e) => s + (parseFloat(e.hoursWorked)||0), 0);
    const pending  = devTs.filter(e => (e.status || '').toLowerCase() === 'pending').reduce((s, e) => s + (parseFloat(e.hoursWorked)||0), 0);
    
    if (document.getElementById('dev-ts-week'))     document.getElementById('dev-ts-week').textContent     = thisWeek + 'h';
    if (document.getElementById('dev-ts-approved')) document.getElementById('dev-ts-approved').textContent = approved + 'h';
    if (document.getElementById('dev-ts-pending'))  document.getElementById('dev-ts-pending').textContent  = pending + 'h';
    
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const earnings = devTs
        .filter(e => (e.status || '').toLowerCase() === 'approved')
        .filter(e => {
            if (!e.date) return false;
            const parts = e.date.split('-');
            let d;
            if (parts.length === 3 && parts[2].length === 4) {
                d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            } else {
                d = new Date(e.date);
            }
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        })
        .reduce((s, e) => s + (parseFloat(e.bedrag)||0), 0);
        
    if (document.getElementById('dev-ts-earnings')) document.getElementById('dev-ts-earnings').textContent = formatCurrency(earnings);
}

let devTimesheetAutoRefreshInterval = null;

function startDevTimesheetAutoRefresh() {
    if (devTimesheetAutoRefreshInterval) clearInterval(devTimesheetAutoRefreshInterval);
    devTimesheetAutoRefreshInterval = setInterval(() => {
        const screen = document.getElementById('screen-dev-timesheets');
        if (screen && screen.classList.contains('active')) {
            refreshDevTimesheetsSilent();
        }
    }, 30000);
}

function stopDevTimesheetAutoRefresh() {
    if (devTimesheetAutoRefreshInterval) {
        clearInterval(devTimesheetAutoRefreshInterval);
        devTimesheetAutoRefreshInterval = null;
    }
}

async function refreshDevTimesheetsSilent() {
    try {
        const currentDevId = developers[0]?.id;
        const oldDevTs = timesheets.filter(t => t.developer_id === currentDevId);
        
        await loadTimesheets();
        
        const newDevTs = timesheets.filter(t => t.developer_id === currentDevId);
        
        const oldJSON = JSON.stringify(oldDevTs);
        const newJSON = JSON.stringify(newDevTs);
        
        if (oldJSON !== newJSON) {
            renderDevTimesheets();
            updateDevTsStats();
            
            let statusChanged = false;
            let approvedCount = 0;
            let rejectedCount = 0;
            
            for (const newTs of newDevTs) {
                const oldTs = oldDevTs.find(t => t.id === newTs.id);
                if (oldTs && (oldTs.status || '').toLowerCase() !== (newTs.status || '').toLowerCase()) {
                    statusChanged = true;
                    if ((newTs.status || '').toLowerCase() === 'approved') approvedCount++;
                    if ((newTs.status || '').toLowerCase() === 'rejected') rejectedCount++;
                }
            }
            
            if (statusChanged) {
                if (approvedCount > 0) showToast('✅ Je timesheet is goedgekeurd!');
                else if (rejectedCount > 0) showToast('❌ Je timesheet is afgekeurd.');
            }
        }
    } catch(e) {
        console.warn('Dev auto-refresh mislukt:', e);
    }
}

async function deleteDevTimesheet(id) {
    if(!confirm('Weet je zeker dat je deze uren wilt verwijderen?')) return;
    try {
        await apiFetch(`/api/timesheets/${id}`, { method: 'DELETE' });
        await loadTimesheets();
        renderDevTimesheets();
        updateDevTsStats();
        updateTimesheetSummary();
        renderDashboardStats();
        showToast('✓ Timesheet verwijderd');
    } catch (e) {
        showToast(`⚠ ${e.message}`);
    }
}

function getCurrentISOWeekString() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil(( ( (d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getMondayFromWeek(weekStr) {
    if (!weekStr) return null;
    const parts = weekStr.split('-W');
    if (parts.length !== 2) return null;
    const year = parseInt(parts[0], 10);
    const week = parseInt(parts[1], 10);
    const jan4 = new Date(year, 0, 4);
    const day = jan4.getDay();
    const dayOfWeek = day === 0 ? 7 : day;
    const startOfYear = new Date(jan4.getTime() - (dayOfWeek - 1) * 24 * 60 * 60 * 1000);
    const weekMonday = new Date(startOfYear.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
    const pad = (num) => String(num).padStart(2, '0');
    return `${weekMonday.getFullYear()}-${pad(weekMonday.getMonth() + 1)}-${pad(weekMonday.getDate())}`;
}

async function submitDevTimesheet() {
    const developer_id = activeDeveloper?.id || developers[0]?.id;
    if (!developer_id) {
        showToast('⚠ Geen developer gevonden. Log opnieuw in.');
        return;
    }

    const weekVal     = document.getElementById('timesheet-week')?.value;
    const project_id  = document.getElementById('dev-ts-project')?.value;
    const hours       = parseFloat(document.getElementById('timesheet-uren')?.value);
    let desc          = document.getElementById('dev-ts-desc')?.value?.trim() || '';

    if (!developer_id) {
        showToast('⚠ Fout: geen developer ingelogd');
        return;
    }
    if (!project_id || project_id === '' || project_id === 'undefined') {
        showToast('⚠ Selecteer een geldig project.');
        return;
    }
    if (!weekVal) {
        showToast('⚠ Kies een week.');
        return;
    }
    if (!hours || hours <= 0 || hours > 40) {
        showToast('⚠ Voer een geldig aantal uren in (1-40 per week).');
        return;
    }

    const date = getMondayFromWeek(weekVal);

    try {
        await apiFetch('/api/timesheets', {
            method: 'POST',
            body: JSON.stringify({ 
                developer_id: parseInt(developer_id), 
                project_id: parseInt(project_id), 
                datum: date, 
                aantal_uren: hours, 
                omschrijving: desc || ''
            })
        });

        // Reset form
        if (document.getElementById('timesheet-week')) document.getElementById('timesheet-week').value = '';
        if (document.getElementById('timesheet-uren')) document.getElementById('timesheet-uren').value = '';
        if (document.getElementById('week-label')) document.getElementById('week-label').textContent = '';
        if (document.getElementById('dev-ts-desc')) document.getElementById('dev-ts-desc').value = '';

        await loadTimesheets(); // refetch from DB
        renderDevTimesheets();
        updateDevTsStats();
        updateTimesheetSummary();
        renderDashboardStats();
        showToast('✓ Uren geregistreerd!');
    } catch (e) {
        showToast(`⚠ ${e.message}`);
    }
}

function filterDevTimesheets(searchText) {
    renderDevTimesheets();
}

function exportDevTimesheets() {
    const lines = ['Date,Project,Hours,Type,Status,Description'];
    const currentDevId = developers[0]?.id;
    timesheets.filter(t => t.developer_id === currentDevId).forEach(e => {
        const isOvertime = e.description.includes('[OVERTIME]');
        const typeStr = isOvertime ? 'Overtime' : 'Regular';
        lines.push(`${e.date},"${e.projectName}",${e.hoursWorked},${typeStr},${e.status},"${e.description}"`);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'Timesheets_Export.csv';
    a.click(); URL.revokeObjectURL(url);
}

// Initialize dev timesheets on screen show
const _origNavigateTo = window.navigateTo;

// ===== MY DOCUMENTS =====
const _DEF_DEV_DOCS = [
    { id: 'doc1', name: 'Alex_Rivera_CV.pdf',         type: 'CV',       date: '2024-03-19', size: '1.2 MB', icon: 'file-text',      color: '#60a5fa' },
    { id: 'doc2', name: 'NDA_Acme_Corp.pdf',          type: 'NDA',      date: '2024-03-01', size: '0.4 MB', icon: 'file-lock',      color: '#fbbf24' },
    { id: 'doc3', name: 'Service_Contract_2024.pdf',  type: 'Contract', date: '2024-01-15', size: '0.8 MB', icon: 'file-signature', color: '#a5b4fc' },
    { id: 'doc4', name: 'Tax_Form_2023.pdf',          type: 'Finance',  date: '2024-02-10', size: '0.3 MB', icon: 'receipt',        color: '#34d399' },
];
let devDocuments = _ls('reemo_dev_docs', _DEF_DEV_DOCS);
function saveDevDocs() { _lss('reemo_dev_docs', devDocuments); }

const typeColors = {
    'CV':       'rgba(37,99,235,0.1);color:#60a5fa;border:1px solid rgba(37,99,235,0.2)',
    'NDA':      'rgba(245,158,11,0.1);color:#fbbf24;border:1px solid rgba(245,158,11,0.2)',
    'Contract': 'rgba(99,102,241,0.1);color:#a5b4fc;border:1px solid rgba(99,102,241,0.2)',
    'Finance':  'rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2)',
    'Other':    'rgba(255,255,255,0.06);color:var(--white-60);border:1px solid rgba(255,255,255,0.1)',
};

function renderDevDocsList() {
    const tbody = document.getElementById('dev-docs-body');
    if (!tbody) return;

    const filterVal = document.getElementById('dev-docs-filter')?.value || '';
    const filteredDocs = filterVal ? devDocuments.filter(d => d.type === filterVal) : devDocuments;

    if (filteredDocs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding:2rem;text-align:center;color:var(--white-30);font-size:0.875rem">No documents found</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredDocs.map(doc => {
        const typeBg = typeColors[doc.type] || typeColors['Other'];
        return `
        <tr class="ts-row">
            <td style="padding:0.875rem 1.25rem">
                <div style="display:flex;align-items:center;gap:0.75rem">
                    <div style="width:2rem;height:2rem;border-radius:0.5rem;background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.15);display:flex;align-items:center;justify-content:center;flex-shrink:0">
                        <i data-lucide="${doc.icon}" style="width:13px;height:13px;color:${doc.color}"></i>
                    </div>
                    <div>
                        <div style="font-size:0.8125rem;font-weight:600;color:var(--white)">${doc.name}</div>
                        <div style="font-size:0.625rem;color:var(--white-40)">${doc.size}</div>
                    </div>
                </div>
            </td>
            <td style="padding:0.875rem 1.25rem">
                <span style="display:inline-block;padding:0.2rem 0.5rem;border-radius:0.375rem;font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;background:${typeBg}">${doc.type}</span>
            </td>
            <td style="padding:0.875rem 1.25rem;font-size:0.8125rem;color:var(--white-40);font-family:monospace;white-space:nowrap">${doc.date}</td>
            <td style="padding:0.875rem 1.25rem;text-align:right">
                <div style="display:flex;justify-content:flex-end;gap:0.375rem">
                    <button class="ts-action-btn view" title="Download" onclick="downloadDevDoc('${doc.id}')">
                        <i data-lucide="download" style="width:13px;height:13px"></i>
                    </button>
                    <button class="ts-action-btn reject" title="Delete" onclick="deleteDevDoc('${doc.id}')">
                        <i data-lucide="trash-2" style="width:13px;height:13px"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    updateDocTotal();
    renderDevCVPreview();
}

function renderDevDocuments() {
    renderDevDocsList();
}

function renderDevCVPreview() {
    const previewContainer = document.getElementById('dev-docs-cv-preview');
    if (!previewContainer) return;

    const cvDoc = devDocuments.find(d => d.type === 'CV');
    if (!cvDoc) {
        previewContainer.innerHTML = `
            <div onclick="triggerDocUpload('CV')" style="background:rgba(255,255,255,0.02);border:1.5px dashed rgba(255,255,255,0.1);border-radius:0.875rem;padding:2rem 1rem;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;margin-bottom:1rem;cursor:pointer;transition:all 0.2s">
                <i data-lucide="file-x" style="width:24px;height:24px;color:var(--white-30);margin-bottom:0.75rem"></i>
                <div style="font-weight:700;font-size:0.875rem;color:var(--white-60)">Geen CV geüpload</div>
                <div style="margin-top:0.25rem;font-size:0.625rem;color:#60a5fa;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Klik om te uploaden</div>
            </div>
        `;
    } else {
        const devId = developers[0]?.id || '';
        const devName = (developers[0]?.naam || '').replace(/'/g, "\\'");
        
        let actionsHtml = `
            <button class="btn-outline" onclick="downloadDevCV()" style="justify-content:center;font-size:0.75rem;padding:0.5rem 0.75rem;flex:1">
                <i data-lucide="download" style="width:13px;height:13px"></i> Download
            </button>
            <button class="btn-outline" onclick="triggerDocUpload('cv')" style="justify-content:center;font-size:0.75rem;padding:0.5rem 0.75rem;flex:1">
                <i data-lucide="upload-cloud" style="width:13px;height:13px"></i> Replace
            </button>
        `;

        actionsHtml += `
        <button class="btn-outline" onclick="openCvConverterModal({developer_naam: '${devName}', cv_url: '${cvDoc.url || ''}', developer_id: '${devId}'})" style="justify-content:center;font-size:0.75rem;padding:0.5rem 0.75rem;flex:1;border-color:rgba(167,139,250,0.3);color:#a78bfa">
            <i data-lucide="sparkles" style="width:13px;height:13px"></i> Converteer
        </button>
        `;

        previewContainer.innerHTML = `
            <div onclick="downloadDevCV()" style="background:rgba(255,255,255,0.03);border:1.5px dashed rgba(255,255,255,0.12);border-radius:0.875rem;padding:2rem 1rem;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;margin-bottom:1rem;cursor:pointer;transition:all 0.2s" onmouseover="this.style.borderColor='rgba(37,99,235,0.4)';this.style.background='rgba(37,99,235,0.04)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.12)';this.style.background='rgba(255,255,255,0.03)'">
                <div style="width:3rem;height:3rem;border-radius:0.75rem;background:rgba(37,99,235,0.1);border:1px solid rgba(37,99,235,0.2);display:flex;align-items:center;justify-content:center;margin-bottom:0.75rem">
                    <i data-lucide="file-text" style="width:22px;height:22px;color:#60a5fa"></i>
                </div>
                <div style="font-weight:700;font-size:0.875rem;color:var(--white);margin-bottom:0.25rem">${cvDoc.name}</div>
                <div style="font-size:0.6875rem;color:var(--white-40)">Uploaded ${cvDoc.date} &bull; ${cvDoc.size}</div>
                <div style="margin-top:0.75rem;font-size:0.625rem;color:#60a5fa;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Click to download</div>
            </div>
            <div style="display:flex;gap:0.625rem">
                ${actionsHtml}
            </div>
        `;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function updateDocTotal() {
    const el = document.getElementById('doc-total');
    if (el) el.textContent = devDocuments.length;
    
    const lastUploadEl = document.getElementById('doc-last-upload');
    if (lastUploadEl) {
        if (devDocuments.length > 0) {
            // Find most recent
            const sorted = [...devDocuments].sort((a,b) => new Date(b.date) - new Date(a.date));
            const diffDays = Math.floor((new Date() - new Date(sorted[0].date)) / (1000 * 60 * 60 * 24));
            lastUploadEl.textContent = diffDays === 0 ? 'Vandaag' : diffDays === 1 ? 'Gisteren' : `${diffDays} dagen geleden`;
        } else {
            lastUploadEl.textContent = '—';
        }
    }
}

function triggerDocUpload(hint) {
    window._uploadDocType = hint ? hint.toUpperCase() : 'OTHER';
    document.getElementById('doc-file-input')?.click();
}

function handleDocUpload(input) {
    const file = input.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toUpperCase();
    const type = window._uploadDocType || 'OTHER';

    if (type === 'CV') {
        const cvDocIdx = devDocuments.findIndex(d => d.type === 'CV');
        const cvDoc = {
            id: genId('doc'),
            name: file.name,
            type: 'CV',
            date: new Date().toISOString().slice(0, 10),
            size: (file.size / 1024 / 1024).toFixed(1) + ' MB',
            icon: 'file-text',
            color: '#60a5fa',
            url: 'uploads/' + file.name
        };
        if (cvDocIdx >= 0) {
            devDocuments[cvDocIdx] = cvDoc;
        } else {
            devDocuments.unshift(cvDoc);
        }
    } else {
        devDocuments.unshift({
            id: genId('doc'),
            name: file.name,
            type: type,
            date: new Date().toISOString().slice(0, 10),
            size: (file.size / 1024 / 1024).toFixed(1) + ' MB',
            icon: 'file',
            color: 'var(--white-50)',
            url: 'uploads/' + file.name
        });
    }

    saveDevDocs();
    input.value = '';
    renderDevDocuments();
    showToast(`✓ "${file.name}" uploaded!`);

    // Sync with cvs list if a CV is uploaded
    if (type === 'CV') {
        const activeDev = activeDeveloper || developers[0];
        const activeDevId = activeDev?.id || activeDev?.developer_id || 'dev1';
        const activeDevName = activeDev?.naam || activeDev?.name || 'Developer';
        const activeDevEmail = activeDev?.email || 'developer@reemo.io';
        const activeDevRole = activeDev?.rol || activeDev?.role || 'Developer';
        const activeDevRate = activeDev?.uurtarief || activeDev?.hourlyRate || 85;

        if (activeDev) {
            activeDev.cv_url = 'uploads/' + file.name;
            saveDevelopers();
        }

        const cvIdx = cvs.findIndex(c => c.developer_id === activeDevId || c.id === activeDevId || c.email === activeDevEmail);
        const cvEntry = {
            id: cvIdx >= 0 ? cvs[cvIdx].id : genId('cv'),
            developer_id: activeDevId,
            naam: activeDevName,
            name: activeDevName,
            email: activeDevEmail,
            rol: activeDevRole,
            role: activeDevRole,
            rate: activeDevRate,
            skills: cvIdx >= 0 ? cvs[cvIdx].skills : ['JavaScript'],
            uploadDate: new Date().toISOString().slice(0, 10),
            status: 'ORIGINAL',
            cv_url: 'uploads/' + file.name
        };
        if (cvIdx >= 0) {
            cvs[cvIdx] = cvEntry;
        } else {
            cvs.unshift(cvEntry);
        }
        saveCVs();
        renderCVDatabase();
        updateCVStats();
    }
}

function downloadDevDoc(id) {
    const doc = devDocuments.find(d => d.id === id);
    if (!doc) return;
    const text = `Document: ${doc.name}\nType: ${doc.type}\nDate: ${doc.date}\nManaged by: Reemo B.V.`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = doc.name.replace(/\.[^.]+$/, '.txt');
    a.click(); URL.revokeObjectURL(url);
}
function downloadDevCV() {
    const cvDoc = devDocuments.find(d => d.type === 'CV');
    if(cvDoc) downloadDevDoc(cvDoc.id);
}

// ===== SKILLS API & CV CONVERTER MODAL =====

async function saveSkills(devId, updatedSkills) {
  try {
    const res = await fetch(`/api/developers/${devId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skills: updatedSkills })
    });

    if (!res.ok) {
      showToast('Skills opslaan mislukt. Probeer opnieuw.', 'error');
      return false;
    }

    showToast('Skills bijgewerkt', 'success');
    return true;
  } catch (err) {
    showToast('Skills opslaan mislukt. Probeer opnieuw.', 'error');
    console.error('Skills save error:', err);
    return false;
  }
}

async function addDevSkill(devId) {
    const input = document.getElementById('new-dev-skill');
    if (!input || !input.value.trim()) return;
    const newSkill = input.value.trim();
    
    try {
        const res = await apiFetch(`/api/developers/${devId}`);
        let currentSkills = [];
        try { currentSkills = JSON.parse(res.developer.skills) || []; } catch(e) {}
        
        if (!currentSkills.includes(newSkill)) {
            currentSkills.push(newSkill);
            const success = await saveSkills(devId, currentSkills);
            if (success) {
                input.value = '';
                loadDevProfile(); // reload the UI
            }
        }
    } catch(e) {
        showToast('⚠ Fout bij toevoegen skill: ' + e.message, 'error');
    }
}

async function removeDevSkill(devId, skillToRemove) {
    if(!confirm(`Weet je zeker dat je "${skillToRemove}" wilt verwijderen?`)) return;
    try {
        const res = await apiFetch(`/api/developers/${devId}`);
        let currentSkills = [];
        try { currentSkills = JSON.parse(res.developer.skills) || []; } catch(e) {}
        
        currentSkills = currentSkills.filter(s => s !== skillToRemove);
        
        const success = await saveSkills(devId, currentSkills);
        if (success) {
            loadDevProfile(); // reload the UI
        }
    } catch(e) {
        showToast('⚠ Fout bij verwijderen skill: ' + e.message, 'error');
    }
}

async function downloadDeveloperCV(devId) {
  try {
    const res = await fetch(`/api/developers/${devId}/cv-url`);
    const data = await res.json();

    const url = data.url || (data.data && data.data.url);
    if (!res.ok || !url) {
      showToast('CV niet beschikbaar. Upload eerst een CV via My Documents.', 'error');
      return;
    }

    // Start download
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename || (data.data && data.data.filename) || 'CV.pdf';
    a.click();
  } catch (err) {
    showToast('CV niet beschikbaar. Upload eerst een CV via My Documents.', 'error');
    console.error('CV download fout:', err);
  }
}

function openCvConverterModal({ developer_naam, cv_url, developer_id }) {
    let modal = document.getElementById('modal-cv-converter');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-cv-converter';
        modal.style = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);backdrop-filter:blur(6px);align-items:center;justify-content:center';
        document.body.appendChild(modal);
    }
    
    if (typeof CV_CONVERTER_ENABLED !== 'undefined' && CV_CONVERTER_ENABLED) {
        // Active/working CV Converter Modal in English
        modal.innerHTML = `
            <div style="background:#111;border:1px solid #333;border-radius:1rem;width:90%;max-width:400px;overflow:hidden;animation:slideUpFade 0.3s ease-out">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:1.25rem 1.5rem;border-bottom:1px solid #1f1f1f;background:linear-gradient(90deg, rgba(167,139,250,0.05), transparent)">
                    <div style="display:flex;align-items:center;gap:0.75rem">
                        <div style="width:2rem;height:2rem;border-radius:0.5rem;background:rgba(167,139,250,0.1);display:flex;align-items:center;justify-content:center;color:#a78bfa;border:1px solid rgba(167,139,250,0.2)">
                            <i data-lucide="sparkles" style="width:14px;height:14px"></i>
                        </div>
                        <div>
                            <div style="font-weight:700;font-size:0.9375rem;color:var(--white)">Reemo CV Converter</div>
                            <div style="font-size:0.6875rem;color:var(--white-40)">Automated Formatting</div>
                        </div>
                    </div>
                    <button onclick="document.getElementById('modal-cv-converter').style.display='none'" style="background:none;border:none;color:var(--white-40);cursor:pointer;padding:0.25rem"><i data-lucide="x" style="width:18px;height:18px"></i></button>
                </div>
                <div style="padding:1.5rem">
                    <div style="text-align:center;margin-bottom:1.5rem">
                        <div style="width:3rem;height:3rem;border-radius:0.75rem;background:rgba(167,139,250,0.05);border:1px dashed rgba(167,139,250,0.2);display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;color:#a78bfa">
                            <i data-lucide="file-json" style="width:20px;height:20px"></i>
                        </div>
                        <div style="font-weight:700;color:var(--white);font-size:0.9375rem;margin-bottom:0.35rem">Convert CV of ${developer_naam} to Reemo format</div>
                        <div style="font-size:0.75rem;color:var(--white-40);line-height:1.5">
                            This feature reads the original document and converts the text into the clean, anonymized Reemo styling.
                        </div>
                    </div>
                    
                    <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:0.5rem;padding:0.875rem;margin-bottom:1.5rem">
                        <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--white-40);margin-bottom:0.5rem">What we do:</div>
                        <ul style="margin:0;padding-left:1.25rem;color:var(--white-60);font-size:0.75rem;line-height:1.6">
                            <li>AI Data Extraction (Skills, Experience)</li>
                            <li>Remove contact details (Anonymization)</li>
                            <li>Generate Reemo-branded PDF</li>
                        </ul>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
                        <button class="btn-outline" onclick="document.getElementById('modal-cv-converter').style.display='none'" style="justify-content:center;padding:0.75rem">Cancel</button>
                        <button class="btn-blue" onclick="showToast('Converter endpoint not available yet.');document.getElementById('modal-cv-converter').style.display='none'" style="justify-content:center;padding:0.75rem;background:#8b5cf6;border-color:#8b5cf6;color:white">
                            <i data-lucide="sparkles" style="width:14px;height:14px"></i> Start Convert
                        </button>
                    </div>
                </div>
            </div>
        `;
    } else {
        // Placeholder "Coming soon" modal
        modal.innerHTML = `
            <div style="background:#111;border:1px solid #333;border-radius:1rem;width:90%;max-width:400px;overflow:hidden;animation:slideUpFade 0.3s ease-out">
                <div style="display:flex;justify-content:space-between;align-items:center;padding:1.25rem 1.5rem;border-bottom:1px solid #1f1f1f;background:linear-gradient(90deg, rgba(167,139,250,0.05), transparent)">
                    <div style="display:flex;align-items:center;gap:0.75rem">
                        <div style="width:2rem;height:2rem;border-radius:0.5rem;background:rgba(167,139,250,0.1);display:flex;align-items:center;justify-content:center;color:#a78bfa;border:1px solid rgba(167,139,250,0.2)">
                            <i class="ti ti-sparkles" style="font-size:14px"></i>
                        </div>
                        <div>
                            <div style="font-weight:700;font-size:0.9375rem;color:var(--white)">Reemo CV Converter</div>
                            <div style="font-size:0.6875rem;color:var(--white-40)">Automated Formatting</div>
                        </div>
                    </div>
                    <button onclick="document.getElementById('modal-cv-converter').style.display='none'" style="background:none;border:none;color:var(--white-40);cursor:pointer;padding:0.25rem"><i data-lucide="x" style="width:18px;height:18px"></i></button>
                </div>
                <div style="padding:1.5rem">
                    <div style="text-align:center;margin-bottom:1.5rem">
                        <div style="width:3.5rem;height:3.5rem;border-radius:50%;background:rgba(167,139,250,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 1.25rem;color:#a78bfa;box-shadow:0 0 15px rgba(167,139,250,0.15)">
                            <i class="ti ti-bell" style="font-size:24px"></i>
                        </div>
                        <div style="font-weight:700;color:var(--white);font-size:0.9375rem;margin-bottom:0.5rem">Convert CV of ${developer_naam} to Reemo format</div>
                        <div style="font-size:0.8125rem;color:#a78bfa;font-weight:700;margin-top:0.75rem;margin-bottom:0.5rem;display:flex;align-items:center;justify-content:center;gap:0.35rem">
                            <span>🔔 Coming soon</span>
                        </div>
                        <div style="font-size:0.75rem;color:var(--white-60);line-height:1.5;margin-top:0.5rem">
                            The converter is currently being integrated.<br>
                            You will be notified once it goes live.
                        </div>
                    </div>
                    
                    <div style="display:flex;justify-content:center">
                        <button class="btn-blue" onclick="document.getElementById('modal-cv-converter').style.display='none'" style="justify-content:center;padding:0.75rem;width:100%;background:#8b5cf6;border-color:#8b5cf6;color:white;font-weight:700">OK</button>
                    </div>
                </div>
            </div>
        `;
    }
    modal.style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function deleteDevDoc(id) {
    const idx = devDocuments.findIndex(d => d.id === id);
    if (idx !== -1) {
        devDocuments.splice(idx, 1);
        saveDevDocs();
        renderDevDocuments();
        showToast('Document verwijderd.');
    }
}

// ============================================================
//  CV UPLOAD & PARSE
// Holds parsed skills (mutable, user can remove chips)
// NOTE: declared at top of file with var to avoid temporal dead zone issues

function openCVUploadModal() {
    resetCVUpload();
    openModal('modal-cv-upload');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function resetCVUpload() {
    const $ = id => document.getElementById(id);
    $('cv-upload-zone').style.display   = 'block';
    $('cv-parsing').style.display       = 'none';
    $('cv-parse-error').style.display   = 'none';
    $('cv-parse-result').style.display  = 'none';
    const inp = $('cv-file-input');
    if (inp) inp.value = '';
    _cvParsedSkills = [];
}

async function openBulkUploadModal() {
  const modal = document.getElementById('modal-bulk-upload');
  if (modal) modal.style.display = 'flex';

  // Reset inputs and previews
  const fileInput = document.getElementById('bulk-file-input');
  if (fileInput) fileInput.value = '';
  
  const preview = document.getElementById('bulk-file-preview');
  if (preview) preview.innerHTML = '';
  
  const resultaat = document.getElementById('bulk-upload-resultaat');
  if (resultaat) resultaat.innerHTML = '';
  
  const progressLabel = document.getElementById('bulk-progress-label');
  if (progressLabel) progressLabel.textContent = '';

  window._bulkUploadFiles = [];
  window._totalSelectedFilesCount = 0;
  window._bulkUploadAborted = false;

  // Reset footer buttons
  const startBtn = document.getElementById('btn-start-bulk-upload');
  if (startBtn) {
    startBtn.style.display = 'inline-block';
    startBtn.textContent = 'Upload bestanden';
    startBtn.disabled = true;
    startBtn.onclick = startBulkUpload;
  }
  const cancelBtn = document.querySelector('#modal-bulk-upload .btn-secondary');
  if (cancelBtn) {
    cancelBtn.textContent = 'Annuleer';
    cancelBtn.onclick = closeBulkUploadModal;
  }
}

function closeBulkUploadModal() {
  const modal = document.getElementById('modal-bulk-upload');
  if (modal) modal.style.display = 'none';
  window._bulkUploadFiles = [];
  window._totalSelectedFilesCount = 0;
  window._bulkUploadAborted = true; // Abort active loop if any
  
  const preview = document.getElementById('bulk-file-preview');
  if (preview) preview.innerHTML = '';
  
  const resultaat = document.getElementById('bulk-upload-resultaat');
  if (resultaat) resultaat.innerHTML = '';
}

function handleBulkFileSelect(event) {
  const files = Array.from(event.target.files);
  window._totalSelectedFilesCount = files.length;
  renderBulkFilePreview(files);
}

function handleBulkDrop(event) {
  event.preventDefault();
  const files = Array.from(event.dataTransfer.files);
  window._totalSelectedFilesCount = files.length;
  renderBulkFilePreview(files);
}

function renderBulkFilePreview(files) {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED  = ['application/pdf',
                    'application/msword',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

  const validated = files.map(f => {
    const isAllowedType = ALLOWED.includes(f.type) || 
      f.name.endsWith('.pdf') || 
      f.name.endsWith('.doc') || 
      f.name.endsWith('.docx');
    
    return {
      file:   f,
      naam:   f.name,
      grootte: (f.size / 1024 / 1024).toFixed(1) + ' MB',
      geldig: f.size <= MAX_SIZE && isAllowedType,
      fout:   f.size > MAX_SIZE ? 'Te groot (max 10MB)' :
              !isAllowedType ? 'Ongeldig bestand' : null
    };
  });

  const geldig = validated.filter(f => f.geldig);

  // Render preview lijst
  const container = document.getElementById('bulk-file-preview');
  if (!container) return;

  container.innerHTML = validated.map(f => `
    <div class="bulk-file-row ${f.geldig ? 'valid' : 'invalid'}">
      <span class="file-icon">📄</span>
      <span class="file-naam">${f.naam}</span>
      <span class="file-grootte">${f.grootte}</span>
      <span class="file-status">
        ${f.geldig
          ? '<span style="color:#22C55E;">✓ Klaar</span>'
          : `<span style="color:#EF4444;">✗ ${f.fout}</span>`}
      </span>
    </div>
  `).join('');

  // Update knop tekst
  const btn = document.getElementById('btn-start-bulk-upload');
  if (btn) {
    btn.textContent = `Upload ${geldig.length} bestand${geldig.length !== 1 ? 'en' : ''}`;
    btn.disabled = geldig.length === 0;
    btn.dataset.files = JSON.stringify(geldig.map(f => f.naam));
  }

  // Sla geldige files op voor upload
  window._bulkUploadFiles = geldig.map(f => f.file);
}

async function startBulkUpload() {
  const files = window._bulkUploadFiles;
  if (!files || files.length === 0) return;

  window._bulkUploadAborted = false;

  // Change UI to upload/progress state inside the preview box
  const container = document.getElementById('bulk-file-preview');
  if (container) {
    container.innerHTML = files.map(f => {
      const cleanName = f.name.replace(/[^a-z0-9]/gi, '_');
      return `
        <div class="bulk-file-row valid" style="display:flex; align-items:center;">
          <span class="file-icon">📄</span>
          <span class="file-naam" style="flex:0.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${f.name}</span>
          <div style="flex:1; height:6px; background:#1E293B; border-radius:3px; overflow:hidden; margin:0 12px; border:1px solid #334155;">
            <div id="progress-${cleanName}" style="width:0%; height:100%; background:#3B82F6; transition:width 0.2s;"></div>
          </div>
          <span id="status-${cleanName}" class="file-status" style="width:70px; text-align:right; color:#94A3B8;">Wachten</span>
        </div>
      `;
    }).join('');
  }

  // Hide upload button during active upload
  const startBtn = document.getElementById('btn-start-bulk-upload');
  if (startBtn) {
    startBtn.style.display = 'none';
  }

  // Change cancel button to stop upload
  const cancelBtn = document.querySelector('#modal-bulk-upload .btn-secondary');
  if (cancelBtn) {
    cancelBtn.textContent = 'Stop upload';
    cancelBtn.onclick = () => {
      window._bulkUploadAborted = true;
      closeBulkUploadModal();
    };
  }

  const resultaten = { geslaagd: 0, mislukt: 0 };

  for (let i = 0; i < files.length; i++) {
    if (window._bulkUploadAborted) {
      break;
    }

    const file = files[i];

    // Update progress
    updateBulkProgress(i + 1, files.length, file.name);

    try {
      const formData = new FormData();
      formData.append('cv', file);
      formData.append('naam', file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' '));

      const res = await fetch('/api/cv-database/bulk-upload-single', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        resultaten.geslaagd++;
        markBulkFileStatus(file.name, 'success');
      } else {
        resultaten.mislukt++;
        markBulkFileStatus(file.name, 'error');
      }
    } catch (err) {
      resultaten.mislukt++;
      markBulkFileStatus(file.name, 'error');
    }
  }

  // Toon eindresultaat
  showBulkUploadResultaat(resultaten);
  
  // Refresh the database lists
  await Promise.all([loadDevelopers(), loadCVDatabase()]); 
  if (typeof renderCVDatabase === 'function') renderCVDatabase();
  if (typeof updateCVStats === 'function') updateCVStats();
}

function updateBulkProgress(huidig, totaal, bestandsnaam) {
  const label = document.getElementById('bulk-progress-label');
  if (label) label.textContent = `${huidig} van ${totaal} geüpload`;

  const cleanName = bestandsnaam.replace(/[^a-z0-9]/gi, '_');
  const bar = document.getElementById(`progress-${cleanName}`);
  if (bar) bar.style.width = '50%';

  const statusEl = document.getElementById(`status-${cleanName}`);
  if (statusEl) {
    statusEl.innerHTML = '<span style="color:#fbbf24;">Bezig...</span>';
  }
}

function markBulkFileStatus(bestandsnaam, status) {
  const cleanName = bestandsnaam.replace(/[^a-z0-9]/gi, '_');
  const bar = document.getElementById(`progress-${cleanName}`);
  if (bar) bar.style.width = '100%';

  const statusEl = document.getElementById(`status-${cleanName}`);
  if (statusEl) {
    if (status === 'success') {
      statusEl.innerHTML = '<span style="color:#22C55E;">✓ Klaar</span>';
    } else {
      statusEl.innerHTML = '<span style="color:#EF4444;">✗ Fout</span>';
    }
  }
}

function showBulkUploadResultaat(resultaten) {
  const container = document.getElementById('bulk-upload-resultaat');
  if (!container) return;

  const overgeslagen = window._totalSelectedFilesCount - resultaten.geslaagd;

  container.innerHTML = `
    <div style="text-align:center; padding:20px; background:rgba(30,41,59,0.3); border:1px solid #1e293b; border-radius:12px; margin-top:12px;">
      ${resultaten.geslaagd > 0
        ? `<p style="color:#22C55E; font-size:15px; font-weight:600; margin-bottom:8px;">✅ ${resultaten.geslaagd} CV${resultaten.geslaagd !== 1 ? 's' : ''} succesvol geüpload</p>`
        : ''}
      ${overgeslagen > 0
        ? `<p style="color:#EF4444; font-size:14px; font-weight:600; margin-bottom:8px;">❌ ${overgeslagen} bestand${overgeslagen !== 1 ? 'en' : ''} overgeslagen (te groot of ongeldig)</p>`
        : ''}
      <p style="color:#94A3B8; font-size:12px; margin-top:8px;">De CVs zijn toegevoegd aan de CV Database.</p>
    </div>
  `;

  // Update footer buttons to allow closing or viewing the results
  const cancelBtn = document.querySelector('#modal-bulk-upload .btn-secondary');
  if (cancelBtn) {
    cancelBtn.textContent = 'Sluiten';
    cancelBtn.onclick = closeBulkUploadModal;
  }

  const startBtn = document.getElementById('btn-start-bulk-upload');
  if (startBtn) {
    startBtn.style.display = 'inline-block';
    startBtn.textContent = 'Bekijk geüploade CVs';
    startBtn.disabled = false;
    startBtn.onclick = () => {
      closeBulkUploadModal();
      navigateTo('cvs');
    };
  }
}

function handleCVDrop(event) {
    const file = event.dataTransfer?.files?.[0];
    if (file) handleCVFileSelect(file);
}

function handleCVFileSelect(file) {
    if (!file) return;
    const allowed = ['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','text/plain'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(pdf|doc|docx|txt)$/i)) {
        showToast('⚠ Alleen PDF, Word of TXT bestanden zijn toegestaan.');
        return;
    }
    _cvFile = file; // Store for later upload
    uploadAndParseCV(file);
}

async function uploadAndParseCV(file) {
    const $ = id => document.getElementById(id);

    // Show spinner
    $('cv-upload-zone').style.display  = 'none';
    $('cv-parsing').style.display      = 'block';
    $('cv-parse-error').style.display  = 'none';
    $('cv-parse-result').style.display = 'none';
    $('cv-parsing-msg').textContent = `"${file.name}" wordt geanalyseerd...`;

    try {
        const formData = new FormData();
        formData.append('cv', file);

        let res, json;
        try {
            res = await fetch('/api/cv/parse', { method: 'POST', body: formData });
            json = await res.json();
        } catch (apiErr) {
            console.warn('[API] /api/cv/parse failed, using mock data.');
            // Simulate network delay for realistic prototype feel
            await new Promise(r => setTimeout(r, 1200));
            
            const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
            json = {
                ok: true,
                data: {
                    name: cleanName || 'Jane Doe',
                    role: 'Fullstack Developer',
                    email: (cleanName.split(' ')[0] || 'dev').toLowerCase() + '@reemo.io',
                    phone: '+31 6 12345678',
                    hourlyRate: 85,
                    experience: '5 years',
                    summary: 'Ervaren developer geëxtraheerd via mock parsing.',
                    skills: ['JavaScript', 'React', 'Node.js', 'PostgreSQL'],
                    savedFilename: file.name,
                    originalName: file.name
                }
            };
            res = { ok: true };
        }

        $('cv-parsing').style.display = 'none';

        if (!res.ok || !json.ok) {
            $('cv-parse-error-msg').textContent = json.error || 'Onbekende fout bij het lezen van het CV.';
            $('cv-parse-error').style.display = 'block';
            $('cv-upload-zone').style.display = 'block';
            return;
        }

        showCVParseResult(json.data, file.name);

    } catch (e) {
        $('cv-parsing').style.display = 'none';
        $('cv-parse-error-msg').textContent = 'Verbindingsfout: ' + e.message;
        $('cv-parse-error').style.display = 'block';
        $('cv-upload-zone').style.display = 'block';
    }
}

// NOTE: _cvSavedFilename and _cvOriginalName declared at top of file

function showCVParseResult(data, filename) {
    const $ = id => document.getElementById(id);

    // Store server-side filename for download
    _cvSavedFilename = data.savedFilename || null;
    _cvOriginalName  = data.originalName  || filename;

    // Fill editable fields
    $('cv-r-name').value    = data.name        || '';
    $('cv-r-role').value    = data.role        || '';
    $('cv-r-email').value   = data.email       || '';
    $('cv-r-phone').value   = data.phone       || '';
    $('cv-r-rate').value    = data.hourlyRate  || '';
    $('cv-r-exp').value     = data.experience  || '';
    $('cv-r-summary').value = data.summary     || '';
    $('cv-filename-tag').textContent = filename;

    // Skills chips
    _cvParsedSkills = [...(data.skills || [])];
    renderCVSkillChips();

    // Show/hide summary section
    $('cv-summary-wrap').style.display = data.summary ? 'block' : 'none';

    // Show result panel
    $('cv-parse-result').style.display = 'block';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderCVSkillChips() {
    const container = document.getElementById('cv-r-skills');
    if (!container) return;
    container.innerHTML = _cvParsedSkills.map((s, i) => `
        <span onclick="removeCVSkill(${i})"
              style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.25rem 0.625rem;border-radius:9999px;
                     background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.25);
                     font-size:0.6875rem;font-weight:700;color:#93c5fd;cursor:pointer;transition:all 0.15s;user-select:none"
              onmouseover="this.style.background='rgba(239,68,68,0.12)';this.style.borderColor='rgba(239,68,68,0.3)';this.style.color='#fca5a5'"
              onmouseout="this.style.background='rgba(37,99,235,0.12)';this.style.borderColor='rgba(37,99,235,0.25)';this.style.color='#93c5fd'">
            ${s} <span style="opacity:0.6;font-size:0.625rem">✕</span>
        </span>
    `).join('');
}

function removeCVSkill(index) {
    _cvParsedSkills.splice(index, 1);
    renderCVSkillChips();
}

function addCVSkillFromInput() {
    const input = document.getElementById('cv-r-skill-new');
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    if (!_cvParsedSkills.includes(val)) {
        _cvParsedSkills.push(val);
        renderCVSkillChips();
    }
    input.value = '';
}

// Save to developer table in Supabase
async function saveParsedCV() {
    const naam         = document.getElementById('cv-r-name')?.value.trim();
    const email        = document.getElementById('cv-r-email')?.value.trim();
    const rol          = document.getElementById('cv-r-role')?.value.trim() || null;
    const rate         = parseFloat(document.getElementById('cv-r-rate')?.value) || null;
    const weekcap      = parseInt(document.getElementById('cv-r-weekcap')?.value) || 40;

    if (!naam) { showToast('⚠ Naam is verplicht om op te slaan.'); return; }
    if (!email) { showToast('⚠ E-mailadres is verplicht.'); return; }

    // Disable button while saving
    const btn = document.querySelector('[onclick="saveParsedCV()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Opslaan...'; }

    try {
        let result;
        try {
            result = await apiFetch('/api/developers', {
                method: 'POST',
                body: JSON.stringify({
                    naam, email, rol, type: 'ZZP',
                    uurtarief: rate, weekcapaciteit: weekcap,
                    savedFilename: _cvSavedFilename,
                    originalName:  _cvOriginalName
                })
            });
        } catch (apiErr) {
            console.warn('[API] Mocking developer save.');
            result = { upserted: false };
            
            // Generate a random ID for the mock
            const genId = prefix => prefix + Math.random().toString(36).substring(2, 9);
            
            // Verify if developer already exists locally
            const existingDevIdx = developers.findIndex(d => d.email === email);
            if (existingDevIdx >= 0) {
                result = { upserted: true };
                developers[existingDevIdx] = {
                    ...developers[existingDevIdx],
                    naam, name: naam, role: rol, rol,
                    hourlyRate: rate, uurtarief: rate, weekcapaciteit: weekcap
                };
            } else {
                developers.unshift({
                    id: genId('d'), naam, name: naam,
                    email, role: rol, rol,
                    hourlyRate: rate, uurtarief: rate,
                    weekcapaciteit: weekcap,
                    hoursThisWeek: 0, activeProjects: 0
                });
            }
        }

        const developer_id = result?.developer_id || result?.data?.developer_id || result?.id;
        const isUpdate = result?.upserted || false;

        console.log('[DEBUG] saveParsedCV - Result object:', result);
        console.log('[DEBUG] saveParsedCV - Extracted developer_id:', developer_id);
        console.log('[DEBUG] saveParsedCV - CV file exists:', !!_cvFile);

        // NEW: Upload file directly to Supabase Storage via memory storage endpoint
        if (_cvFile && developer_id) {
            console.log('4. Upload gestart naar Storage');
            const formData = new FormData();
            formData.append('file', _cvFile);
            formData.append('bucket', 'cvs');
            formData.append('developer_id', developer_id);

            try {
                const storageRes = await fetch('/api/storage/upload', {
                    method: 'POST',
                    body: formData
                });
                const storageJson = await storageRes.json();
                console.log('5. Upload resultaat:', storageJson);

                if (storageJson.ok) {
                    console.log('[DEBUG] saveParsedCV - Updating cv_url via PATCH');
                    await fetch(`/api/developers/${developer_id}`, {
                        method: 'PATCH',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ cv_url: storageJson.data.filePath })
                    });
                    console.log('[DEBUG] saveParsedCV - PATCH successful');
                    showToast('CV succesvol geüpload!', 'success');
                } else {
                    console.error('Upload mislukt:', storageJson.error);
                    showToast('Developer opgeslagen maar CV upload mislukt', 'warning');
                }
            } catch (storageErr) {
                console.error('Netwerkfout bij storage upload:', storageErr);
                showToast('Fout bij verbinden met storage', 'error');
            }
        }
        
        // Reset state
        _cvFile = null;

        // Also save/update in local CV database list
        const existingIdx = cvs.findIndex(c => c.email === email);
        const cvEntry = {
            id: existingIdx >= 0 ? cvs[existingIdx].id : genId('cv'),
            name: naam, email, role: rol, rate,
            skills: _cvParsedSkills,
            uploadDate: new Date().toISOString().slice(0, 10),
            status: 'ORIGINAL',
            active: true,
            savedFilename: _cvSavedFilename,
            originalName:  _cvOriginalName,
            cv_url: _cvSavedFilename ? 'uploads/' + _cvSavedFilename : (_cvFile ? 'uploads/' + _cvFile.name : ('uploads/' + (naam || 'cv').toLowerCase().replace(/\s+/g, '_') + '.pdf'))
        };
        if (existingIdx >= 0) cvs[existingIdx] = cvEntry;
        else cvs.unshift(cvEntry);
        saveCVs();
        renderCVDatabase();
        updateCVStats();

        closeModal('modal-cv-upload');
        resetCVUpload();

        // Refresh data and navigate to Developers page
        await loadDevelopers();
        navigateTo('developers');
        renderDevelopersGrid();
        renderDashboardStats();

        const msg = isUpdate
            ? `✓ Developer "${naam}" bijgewerkt (email bestond al).`
            : `✓ ${naam} toegevoegd als developer!`;
        showToast(msg);

    } catch (e) {
        console.error('[ERROR] saveParsedCV:', e);
        showToast(`⚠ ${e.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="user-plus" style="width:14px;height:14px"></i> Opslaan als Developer'; if(typeof lucide!=='undefined') lucide.createIcons(); }
    }
}

// Save only to CV Database (not as developer in DB) — tagged "Nog niet actief"
async function saveParsedCVDatabase() {
    const naam  = document.getElementById('cv-r-name')?.value.trim();
    const rol   = document.getElementById('cv-r-role')?.value.trim() || null;
    const rate  = parseFloat(document.getElementById('cv-r-rate')?.value) || null;
    const email = document.getElementById('cv-r-email')?.value.trim() || null;
    const weekcap = parseInt(document.getElementById('cv-r-weekcap')?.value) || 40;

    if (!naam || !email) { showToast('⚠ Naam en Email zijn verplicht.'); return; }

    const btn = document.querySelector('[onclick="saveParsedCVDatabase()"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-small"></span> Bezig...'; }

    try {
        let result;
        try {
            result = await apiFetch('/api/developers', {
                method: 'POST',
                body: JSON.stringify({
                    naam, email, rol, type: 'ZZP',
                    uurtarief: rate, weekcapaciteit: weekcap,
                    status: 'candidate',
                    skills: _cvParsedSkills.join(',')
                })
            });
        } catch (apiErr) {
            console.warn('[API] Mocking candidate save.');
            result = { id: genId('d') };
        }

        const developer_id = result?.developer_id || result?.data?.developer_id || result?.id;

        // Upload file to storage if exists
        if (_cvFile && developer_id) {
            const formData = new FormData();
            formData.append('file', _cvFile);
            formData.append('bucket', 'cvs');
            formData.append('developer_id', developer_id);
            try {
                const storageRes = await fetch('/api/storage/upload', { method: 'POST', body: formData });
                const storageJson = await storageRes.json();
                if (storageJson.ok) {
                    await fetch(`/api/developers/${developer_id}`, {
                        method: 'PATCH',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ cv_url: storageJson.data.filePath })
                    });
                }
            } catch (err) { console.error('Storage upload failed:', err); }
        }

        // Also save/update in local CV database list
        const existingIdx = cvs.findIndex(c => c.email === email);
        const cvEntry = {
            id: existingIdx >= 0 ? cvs[existingIdx].id : genId('cv'),
            developer_id: developer_id || genId('d'),
            naam: naam,
            name: naam,
            email: email,
            rol: rol,
            role: rol,
            rate: rate,
            skills: _cvParsedSkills,
            uploadDate: new Date().toISOString().slice(0, 10),
            status: 'ORIGINAL',
            cv_url: _cvSavedFilename ? 'uploads/' + _cvSavedFilename : (_cvFile ? 'uploads/' + _cvFile.name : ('uploads/' + (naam || 'cv').toLowerCase().replace(/\s+/g, '_') + '.pdf'))
        };
        if (existingIdx >= 0) cvs[existingIdx] = cvEntry;
        else cvs.unshift(cvEntry);
        saveCVs();

        closeModal('modal-cv-upload');
        resetCVUpload();
        
        // Refresh CV database and switch screen
        await loadCVDatabase();
        renderCVDatabase();
        updateCVStats();
        showToast(`✓ CV van ${naam} toegevoegd aan de database.`);
        
    } catch (e) {
        console.error('[ERROR] saveParsedCVDatabase:', e);
        showToast(`⚠ ${e.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="database" style="width:14px;height:14px"></i> Alleen in CV Database'; if(typeof lucide!=='undefined') lucide.createIcons(); }
    }
}

async function loadCVDatabase() {
    try {
        const res = await apiFetch('/api/developers/all');
        cvs = res || [];
        renderCVDatabase();
        updateCVStats();
    } catch (e) {
        console.error('Failed to load CV database:', e);
        cvs = [];
        renderCVDatabase();
        updateCVStats();
    }
}

// Activate an inactive CV as a developer directly from the CV Database table
async function activateCVasDeveloper(cvId) {
    const cv = cvs.find(c => c.id === cvId);
    if (!cv) return;
    if (!cv.email) {
        showToast('⚠ E-mailadres ontbreekt — open het CV opnieuw via Upload CV en vul het e-mail in.');
        return;
    }
    try {
        let result;
        try {
            result = await apiFetch('/api/developers', {
                method: 'POST',
                body: JSON.stringify({
                    naam: cv.naam || cv.name, email: cv.email,
                    rol: cv.rol || cv.role || null, type: 'ZZP',
                    uurtarief: cv.rate || null, weekcapaciteit: 40,
                    status: 'active'
                })
            });
        } catch(apiErr) {
            console.warn('[API] Mocking developer activation.');
            result = { upserted: false };
            
            const genId = prefix => prefix + Math.random().toString(36).substring(2, 9);
            const existingDevIdx = developers.findIndex(d => d.email === cv.email);
            
            if (existingDevIdx >= 0) {
                result = { upserted: true };
                developers[existingDevIdx] = {
                    ...developers[existingDevIdx],
                    naam: cv.name, name: cv.name, role: cv.role, rol: cv.role,
                    hourlyRate: cv.rate, uurtarief: cv.rate
                };
            } else {
                developers.unshift({
                    id: genId('d'), naam: cv.name, name: cv.name,
                    email: cv.email, role: cv.role, rol: cv.role,
                    hourlyRate: cv.rate, uurtarief: cv.rate,
                    weekcapaciteit: 40,
                    hoursThisWeek: 0, activeProjects: 0
                });
            }
        }
        const developer_id = result?.developer_id || result?.data?.developer_id || result?.id;
        const isUpdate = result?.upserted || false;

        // If we have a file in memory from a recent upload, upload it now
        if (_cvFile && developer_id) {
            const formData = new FormData();
            formData.append('file', _cvFile);
            formData.append('bucket', 'cvs');
            formData.append('developer_id', developer_id);
            try {
                const storageRes = await fetch('/api/storage/upload', { method: 'POST', body: formData });
                const storageJson = await storageRes.json();
                if (storageJson.ok) {
                    await fetch(`/api/developers/${developer_id}`, {
                        method: 'PATCH',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ cv_url: storageJson.data.filePath })
                    });
                }
            } catch (err) { console.error('Storage upload failed during activation:', err); }
        }

        // Mark CV as active in local store
        const idx = cvs.findIndex(c => c.id === cvId);
        if (idx >= 0) cvs[idx] = { ...cv, active: true };
        saveCVs();
        renderCVDatabase();
        await loadDevelopers();
        renderDashboardStats();
        showToast(isUpdate
            ? `✓ Developer "${cv.name}" bijgewerkt.`
            : `✓ ${cv.name} geactiveerd als developer!`);
    } catch (e) {
        showToast(`⚠ ${e.message}`);
    }
}

// ==============================================================================
//  CLIENT LOGO UPLOAD & CONTRACTS MANAGEMENT
// ==============================================================================
let _uploadingLogoClientId = null;
let _activeContractsClientId = null;

// Global listener to close client logo dropdown when clicking outside
document.addEventListener('click', () => {
    document.querySelectorAll('.client-logo-dropdown').forEach(el => el.remove());
});

function uploadClientLogo(clientId) {
    const client = clients.find(c => c.id == clientId);
    if (!client) return;

    if (client.logo_url) {
        const existed = document.querySelector(`#client-card-${clientId} .client-logo-dropdown`) ||
                        document.querySelector(`#detail-client-logo-container .client-logo-dropdown`);
        document.querySelectorAll('.client-logo-dropdown').forEach(el => el.remove());

        if (!existed) {
            const container = document.querySelector(`#client-card-${clientId} .client-logo-container`) ||
                              document.getElementById('detail-client-logo-container');
            if (!container) return;

            const dropdown = document.createElement('div');
            dropdown.className = 'client-logo-dropdown';
            dropdown.innerHTML = `
                <button class="client-logo-option" onclick="event.stopPropagation(); triggerReplaceLogo('${clientId}')">
                    <i class="ti ti-edit" style="font-size:14px; vertical-align:middle; margin-right:4px"></i> Replace
                </button>
                <button class="client-logo-option remove" onclick="event.stopPropagation(); removeLogo('${clientId}')">
                    <i class="ti ti-trash" style="font-size:14px; vertical-align:middle; margin-right:4px"></i> Remove
                </button>
            `;
            container.appendChild(dropdown);
        }
    } else {
        triggerReplaceLogo(clientId);
    }
}

function triggerReplaceLogo(clientId) {
    _uploadingLogoClientId = clientId;
    document.querySelectorAll('.client-logo-dropdown').forEach(el => el.remove());
    
    const fileInput = document.getElementById('client-logo-input');
    if (fileInput) {
        fileInput.value = '';
        fileInput.click();
    }
}

async function handleLogoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
        alert('Het logo mag maximaal 2MB groot zijn.');
        return;
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
    if (!allowedTypes.includes(file.type)) {
        alert('Alleen PNG, JPG en SVG afbeeldingen zijn toegestaan.');
        return;
    }

    const clientId = _uploadingLogoClientId;
    if (!clientId) return;

    const formData = new FormData();
    formData.append('logo', file);

    try {
        const response = await fetch(`/api/clients/${clientId}/logo`, {
            method: 'POST',
            body: formData
        });
        const result = await response.json();
        if (result.ok) {
            await loadClients();
            renderClientsGrid();

            // Refresh client detail page hero if active
            if (_currentClientId == clientId) {
                const updated = clients.find(c => c.id == clientId);
                if (updated) {
                    const initials = getInitials(updated.naam);
                    const logoEl = document.getElementById('detail-client-logo');
                    if (logoEl) {
                        logoEl.innerHTML = `
                            ${updated.logo_url
                                ? `<img src="${updated.logo_url}" alt="${updated.naam}" style="width:100%; height:100%; object-fit:cover;" />`
                                : `<span>${initials}</span>`
                            }
                            <div class="avatar-overlay">
                                <i class="ti ti-camera"></i>
                            </div>
                        `;
                        logoEl.className = `client-detail-logo client-avatar ${updated.logo_url ? 'has-image' : ''}`;
                    }
                }
            }
        } else {
            alert('Uploaden mislukt: ' + (result.error || 'onbekende fout'));
        }
    } catch (e) {
        console.error('Error uploading logo:', e);
        alert('Fout tijdens uploaden van logo.');
    }
}

async function removeLogo(clientId) {
    if (!confirm('Weet je zeker dat je het logo wilt verwijderen?')) return;
    
    document.querySelectorAll('.client-logo-dropdown').forEach(el => el.remove());

    try {
        const response = await fetch(`/api/clients/${clientId}/logo`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.ok) {
            await loadClients();
            renderClientsGrid();

            // Refresh client detail page hero if active
            if (_currentClientId == clientId) {
                const updated = clients.find(c => c.id == clientId);
                if (updated) {
                    const initials = getInitials(updated.naam);
                    const logoEl = document.getElementById('detail-client-logo');
                    if (logoEl) {
                        logoEl.innerHTML = `
                            ${updated.logo_url
                                ? `<img src="${updated.logo_url}" alt="${updated.naam}" style="width:100%; height:100%; object-fit:cover;" />`
                                : `<span>${initials}</span>`
                            }
                            <div class="avatar-overlay">
                                <i class="ti ti-camera"></i>
                            </div>
                        `;
                        logoEl.className = `client-detail-logo client-avatar ${updated.logo_url ? 'has-image' : ''}`;
                    }
                }
            }
        } else {
            alert('Verwijderen mislukt: ' + (result.error || 'onbekende fout'));
        }
    } catch (e) {
        console.error('Error removing logo:', e);
        alert('Fout tijdens verwijderen van logo.');
    }
}

function openContractenModal(clientId, clientName) {
    openClientContractsModal(clientId);
}

// Client Contracts Modal
async function openClientContractsModal(clientId) {
    _activeContractsClientId = clientId;
    const client = clients.find(c => c.id == clientId);
    if (!client) return;

    const nameEl = document.getElementById('contracts-client-name');
    if (nameEl) nameEl.textContent = client.naam || client.name || '';

    const clientIdField = document.getElementById('contract-client-id');
    if (clientIdField) clientIdField.value = clientId;

    await loadClientContracts(clientId);
    populateContractFormDropdowns(clientId);

    const formContainer = document.getElementById('add-contract-form-container');
    if (formContainer) formContainer.style.display = 'none';
    const toggleBtn = document.getElementById('btn-toggle-add-contract');
    if (toggleBtn) toggleBtn.style.display = 'inline-block';

    openModal('modal-client-contracts');
}

async function loadClientContracts(clientId) {
    const container = document.getElementById('contracts-list-container');
    if (!container) return;

    container.innerHTML = `
        <div style="text-align:center;padding:2rem;color:var(--white-40);font-size:0.8125rem">
            <i class="ti ti-spinner spin" style="font-size:18px;margin-bottom:0.5rem;display:inline-block"></i><br>Contracten laden...
        </div>
    `;

    try {
        const response = await fetch(`/api/clients/${clientId}/contracts`);
        const result = await response.json();
        
        if (!result.ok || !result.data) {
            container.innerHTML = `
                <div style="text-align:center;padding:2rem;color:var(--white-40);font-size:0.8125rem">
                    Fout bij het laden van contracten.
                </div>
            `;
            return;
        }

        const contracts = result.data;
        if (contracts.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;padding:2rem;color:var(--white-40);font-size:0.8125rem">
                    Geen contracten gevonden voor deze klant.
                </div>
            `;
            return;
        }

        container.innerHTML = contracts.map(contract => {
            const status = getContractStatus(contract);
            const badgeStyle = status === 'ACTIEF' 
                ? 'background:rgba(16,185,129,0.1);color:#10b981;border:1px solid rgba(16,185,129,0.2)' 
                : 'background:rgba(255,255,255,0.06);color:var(--white-40);border:1px solid rgba(255,255,255,0.1)';
            
            const periodString = formatContractPeriod(contract.startdatum, contract.einddatum);
            const rateFormatted = formatCurrency(parseFloat(contract.uurtarief || 0));
            
            return `
                <div class="contract-row-card" style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:0.75rem;padding:1rem;display:flex;justify-content:space-between;align-items:center">
                    <div style="display:flex;flex-direction:column;gap:0.25rem;min-width:0;flex:1">
                        <div style="font-size:0.9375rem;font-weight:700;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${contract.projectnaam || 'Onbekend Project'}</div>
                        <div style="font-size:0.8125rem;color:var(--white-70)">
                            <span style="font-weight:600;color:var(--white)">${contract.developer_naam || 'Onbekende Developer'}</span> 
                            <span style="color:var(--white-40)">•</span> 
                            ${contract.uren_per_week}u/wk 
                            <span style="color:var(--white-40)">•</span> 
                            ${rateFormatted}/u
                        </div>
                        <div style="font-size:0.75rem;color:var(--white-40)">${periodString}</div>
                    </div>
                    <span class="status-badge" style="flex-shrink:0;margin-left:1rem;font-size:0.625rem;padding:0.25rem 0.5rem;border-radius:4px;font-weight:700;${badgeStyle}">${status}</span>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('Error loading contracts:', e);
        container.innerHTML = `
            <div style="text-align:center;padding:2rem;color:var(--white-40);font-size:0.8125rem">
                Fout bij het laden van contracten.
            </div>
        `;
    }
}

function getContractStatus(contract) {
    const today = new Date().toISOString().slice(0, 10);
    const status = (contract.status || '').toLowerCase();
    const endDate = contract.einddatum ? formatDateString(contract.einddatum) : null;
    
    if (status === 'actief') {
        if (!endDate || endDate >= today) {
            return 'ACTIEF';
        }
    }
    return 'VERLOPEN';
}

function formatContractPeriod(startDateStr, endDateStr) {
    const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    
    function formatD(dStr) {
        if (!dStr) return '';
        const d = new Date(dStr);
        if (isNaN(d.getTime())) return dStr;
        return `${months[d.getMonth()]} ${d.getFullYear()}`;
    }
    
    const start = formatD(startDateStr) || '—';
    const end = endDateStr ? formatD(endDateStr) : 'heden';
    return `${start} – ${end}`;
}

function toggleAddContractForm() {
    const formContainer = document.getElementById('add-contract-form-container');
    const toggleBtn = document.getElementById('btn-toggle-add-contract');
    if (!formContainer) return;
    
    if (formContainer.style.display === 'none') {
        formContainer.style.display = 'flex';
        if (toggleBtn) toggleBtn.style.display = 'none';
    } else {
        formContainer.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'inline-block';
    }
}

function populateContractFormDropdowns(clientId) {
    const projectSelect = document.getElementById('contract-project-id');
    if (projectSelect) {
        const clientProjects = projects.filter(p => p.klant_id == clientId);
        projectSelect.innerHTML = '<option value="">Selecteer project...</option>' + 
            clientProjects.map(p => `<option value="${p.project_id}">${p.projectnaam}</option>`).join('');
    }

    const developerSelect = document.getElementById('contract-developer-id');
    if (developerSelect) {
        developerSelect.innerHTML = '<option value="">Selecteer developer...</option>' + 
            developers.map(d => `<option value="${d.id}">${d.name || d.naam}</option>`).join('');
    }

    const rateInput = document.getElementById('contract-rate');
    if (rateInput) rateInput.value = '';

    const hoursInput = document.getElementById('contract-hours');
    if (hoursInput) hoursInput.value = '40';

    const startInput = document.getElementById('contract-start');
    if (startInput) {
        startInput.value = new Date().toISOString().slice(0, 10);
    }

    const endInput = document.getElementById('contract-end');
    if (endInput) endInput.value = '';
}

function onContractDeveloperChange(devId) {
    const dev = developers.find(d => d.id == devId);
    const rateInput = document.getElementById('contract-rate');
    if (dev && rateInput) {
        rateInput.value = dev.hourlyRate || dev.uurtarief || '';
    }
}

async function submitContractForm() {
    const clientId = document.getElementById('contract-client-id')?.value;
    const projectId = document.getElementById('contract-project-id')?.value;
    const developerId = document.getElementById('contract-developer-id')?.value;
    const rate = document.getElementById('contract-rate')?.value;
    const hours = document.getElementById('contract-hours')?.value;
    const startDate = document.getElementById('contract-start')?.value;
    const endDate = document.getElementById('contract-end')?.value;

    if (!clientId || !projectId || !developerId || !rate || !hours || !startDate) {
        alert('Vul alle verplichte velden in.');
        return;
    }

    const body = {
        project_id: parseInt(projectId),
        developer_id: parseInt(developerId),
        uurtarief: parseFloat(rate),
        uren_per_week: parseInt(hours),
        startdatum: startDate,
        einddatum: endDate || null
    };

    try {
        const response = await fetch(`/api/clients/${clientId}/contracts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const result = await response.json();
        
        if (result.ok) {
            await loadClientContracts(clientId);
            await loadClients();
            renderClientsGrid();
            toggleAddContractForm();
        } else {
            alert('Opslaan mislukt: ' + (result.error || 'onbekende fout'));
        }
    } catch (e) {
        console.error('Error saving contract:', e);
        alert('Fout tijdens opslaan van contract.');
    }
}

// === Data Management Logic ===
const SYSTEM_RESET_ENABLED = false;

let huidigeDMScope = null;

function switchDMSection(sectie) {
  const importSection = document.getElementById('dm-sectie-import');
  const gevaarlijkSection = document.getElementById('dm-sectie-gevaarlijk');
  
  if (importSection) {
    importSection.style.display = sectie === 'import' ? 'block' : 'none';
  }
  if (gevaarlijkSection) {
    gevaarlijkSection.style.display = sectie === 'gevaarlijk' ? 'block' : 'none';
  }

  const toggleImport = document.getElementById('toggle-import');
  const toggleGevaarlijk = document.getElementById('toggle-gevaarlijk');

  if (toggleImport) {
    toggleImport.classList.toggle('active', sectie === 'import');
  }
  if (toggleGevaarlijk) {
    toggleGevaarlijk.classList.toggle('active', sectie === 'gevaarlijk');
  }
}

function initDataManagement() {
  const container = document.getElementById('screen-data-management');
  if (!container) return;

  switchDMSection('import');
  // De-select any scopes
  huidigeDMScope = null;
  document.querySelectorAll('.dm-scope-card').forEach(c => c.classList.remove('selected'));
  
  // Hide criteria and impact panels
  ['default', 'periode', 'klant', 'reset'].forEach(s => {
    const el = document.getElementById(`dm-criteria-${s}`);
    if (el) el.style.display = s === 'default' ? 'block' : 'none';
  });
  const impactEl = document.getElementById('dm-impact-analyse');
  if (impactEl) impactEl.style.display = 'none';
}

function downloadTemplate(type) {
  const mapping = {
    'operations': 'timesheets',
    'cashflow':   'facturen',
    'crm':        'klanten',
    'contracts':  'projecten',
    'hr':         'developers'
  };
  window.location.href = `/api/data-management/template/${mapping[type] || type}`;
}

function handleDMAutoFileSelect(event) {
  const files = Array.from(event.target.files);
  startDMPreview(files, null); // null = auto-detectie
}

function handleDMAutoDrop(event) {
  event.preventDefault();
  const files = Array.from(event.dataTransfer.files);
  startDMPreview(files, null);
}

function openDMImportModal(type) {
  // Open file picker voor specifiek type
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.xlsx,.xls';
  input.multiple = true;
  input.onchange = (e) => startDMPreview(Array.from(e.target.files), type);
  input.click();
}

async function startDMPreview(files, geforceerdType) {
  if (!files.length) return;

  const formData = new FormData();
  files.forEach(f => formData.append('bestanden', f));
  if (geforceerdType) formData.append('type', geforceerdType);

  showToast('Bestanden worden geanalyseerd...', 'info');

  try {
    const res = await fetch('/api/data-management/preview', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Preview mislukt', 'error');
      return;
    }

    window._dmPendingFiles = files;
    window._dmPendingType  = geforceerdType;
    
    // reset input values if using input file
    const fileInput = document.getElementById('dm-auto-file-input');
    if (fileInput) fileInput.value = '';

    toonDMPreviewModal(data.resultaten);
  } catch (err) {
    console.error('Preview error:', err);
    showToast('Fout bij het laden van preview: ' + err.message, 'error');
  }
}

function toonDMPreviewModal(resultaten) {
  const container = document.getElementById('dm-preview-content');
  if (!container) return;

  container.innerHTML = '';

  const IMPORT_VOLGORDE = ['klanten', 'developers', 'projecten', 'facturen', 'timesheets'];

  // Sorteer resultaten volgens IMPORT_VOLGORDE (parsefouten met undefined tabelType komen achteraan)
  const gesorteerdeResultaten = [...resultaten].sort((a, b) => {
    const idxA = a.tabelType ? IMPORT_VOLGORDE.indexOf(a.tabelType) : 99;
    const idxB = b.tabelType ? IMPORT_VOLGORDE.indexOf(b.tabelType) : 99;
    return idxA - idxB;
  });

  const succesvolleBestanden = gesorteerdeResultaten.filter(r => !r.fout && r.tabelType);
  let volgordeHtml = '';
  if (succesvolleBestanden.length > 0) {
    const stappen = succesvolleBestanden.map((r, i) => `${i + 1}. <span style="color:#60a5fa; font-weight:600;">${r.bestand}</span> (${r.tabelType})`).join(' &rarr; ');
    volgordeHtml = `
      <div style="background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.2); border-radius:8px; padding:12px 16px; margin-bottom:1.5rem; font-size:12px; color:#93c5fd; display:flex; align-items:center; gap:8px;">
        <i class="ti ti-sort-ascending" style="font-size:16px;"></i> 
        <span><strong>Verwerkvolgorde:</strong> ${stappen}</span>
      </div>
    `;
  }

  const html = gesorteerdeResultaten.map((res, index) => {
    if (res.fout) {
      return `
        <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:1.25rem; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong style="color:#f87171; font-size:14px;"><i class="ti ti-alert-triangle"></i> ${res.bestand}</strong>
            <span class="dm-badge danger">PARSE FOUT</span>
          </div>
          <p style="color:#fca5a5; font-size:12px; line-height:1.5; margin-bottom:8px;">${res.fout}</p>
          ${res.gevondenHeaders ? `
            <div style="font-size:11px; color:#94a3b8;">
              <strong>Gevonden kolommen:</strong> ${res.gevondenHeaders.join(', ')}
            </div>
          ` : ''}
        </div>
      `;
    }

    const badgeClass = res.tabelType; // e.g. 'operations', 'cashflow', etc.
    const badgeLabel = res.tabelType.toUpperCase();

    // Generate table headers and rows
    const records = res.records || [];
    const headers = records.length > 0 ? Object.keys(records[0]) : [];
    const duplicaatStatus = res.duplicaatStatus || [];

    let tableHtml = '';
    if (records.length > 0) {
      tableHtml = `
        <div style="overflow-x:auto; border:1px solid #1e1e1e; border-radius:6px; background:#050505; max-height:220px; overflow-y:auto; margin-top:10px;">
          <table class="table" style="width:100%; font-size:11px; text-align:left; border-collapse:collapse;">
            <thead>
              <tr style="background:#111;">
                <th style="padding:6px 12px; border-bottom:1px solid #1e1e1e; color:#64748b; font-size:10px; text-transform:uppercase;">Status</th>
                ${headers.map(h => `<th style="padding:6px 12px; border-bottom:1px solid #1e1e1e; color:#64748b; font-size:10px; text-transform:uppercase;">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${records.map((rec, rIdx) => {
                const status = duplicaatStatus[rIdx] || 'nieuw';
                const statusText = status === 'bestaat_al' ? 'Bestaat al' : 'Nieuw';
                const rowStyle = status === 'bestaat_al' 
                  ? 'background: rgba(245,158,11,0.06);' 
                  : 'background: rgba(34,197,94,0.06);';
                const statusBadgeStyle = status === 'bestaat_al'
                  ? 'background:rgba(245,158,11,0.15); color:#fbbf24; border:1px solid rgba(245,158,11,0.3);'
                  : 'background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.3);';

                return `
                  <tr style="${rowStyle}">
                    <td style="padding:6px 12px; border-bottom:1px solid #111;">
                      <span style="font-size:9px; font-weight:700; padding:2px 6px; border-radius:4px; ${statusBadgeStyle}">${statusText}</span>
                    </td>
                    ${headers.map(h => `<td style="padding:6px 12px; border-bottom:1px solid #111; color:#cbd5e1; white-space:nowrap; max-width:200px; overflow:hidden; text-overflow:ellipsis;">${rec[h] !== undefined ? rec[h] : ''}</td>`).join('')}
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    let mappingHtml = '';
    if (res.kolomMapping && Object.keys(res.kolomMapping).length > 0) {
      const mappingItems = Object.entries(res.kolomMapping)
        .map(([orig, std]) => `<strong>${orig}</strong> &rarr; <span style="color:#60a5fa">${std}</span>`)
        .join(' &bull; ');
      
      const genegeerdText = (res.onherkendekolommen && res.onherkendekolommen.length > 0)
        ? ` &nbsp;|&nbsp; <span style="color:#ef4444;">Genegeerd:</span> "${res.onherkendekolommen.join('", "')}"`
        : '';

      mappingHtml = `
        <div style="font-size:11px; background:#18181b; border:1px solid #27272a; border-radius:6px; padding:8px 12px; margin-top:10px; color:#a1a1aa; line-height:1.4;">
          <span style="color:#22c55e; font-weight:600;"><i class="ti ti-check"></i> Herkende kolommen:</span> ${mappingItems}${genegeerdText}
        </div>
      `;
    }

    return `
      <div style="background:#0e0e0e; border:1px solid #1e1e1e; border-radius:8px; padding:1.25rem; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="color:white; font-size:14px;"><i class="ti ti-file-text" style="color:#3B82F6;"></i> ${res.bestand}</strong>
          <span class="dm-badge ${badgeClass === 'timesheets' ? 'operations' : (badgeClass === 'facturen' ? 'cashflow' : (badgeClass === 'klanten' ? 'crm' : (badgeClass === 'projecten' ? 'contracts' : 'hr')))}">${badgeLabel}</span>
        </div>
        <div style="font-size:12px; color:#94a3b8; display:flex; gap:16px;">
          <span>Totaal rijen: <strong>${res.totaal}</strong></span>
          <span style="color:#4ade80;">Nieuw: <strong>${res.nieuw}</strong></span>
          <span style="color:#fbbf24;">Bestaat al: <strong>${res.bestaatAl}</strong></span>
        </div>
        ${mappingHtml}
        ${tableHtml}
      </div>
    `;
  }).join('');

  container.innerHTML = volgordeHtml + html;
  
  // Reset checkboxes/inputs inside preview modal
  const chk = document.getElementById('dm-overwrite-dup');
  if (chk) chk.checked = false;

  // Show the modal
  const modal = document.getElementById('modal-dm-preview');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function openDmPinModal() {
  // Reset PIN inputs
  ['dm-imp-pin-1','dm-imp-pin-2','dm-imp-pin-3','dm-imp-pin-4'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  
  const modal = document.getElementById('modal-dm-pin');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('dm-imp-pin-1')?.focus();
  }
}

async function bevestigDMImport() {
  const pin = ['dm-imp-pin-1','dm-imp-pin-2','dm-imp-pin-3','dm-imp-pin-4']
    .map(id => document.getElementById(id)?.value || '').join('');

  if (pin.length !== 4) {
    showToast('Voer de volledige 4-cijferige code in', 'error');
    return;
  }

  const overwrite = document.getElementById('dm-overwrite-dup')?.checked || false;

  const formData = new FormData();
  window._dmPendingFiles.forEach(f => formData.append('bestanden', f));
  if (window._dmPendingType) formData.append('type', window._dmPendingType);
  formData.append('pin', pin);
  formData.append('overschrijf', overwrite ? 'true' : 'false');

  showToast('Importeren is gestart...', 'info');

  try {
    const res = await fetch('/api/data-management/import', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      showToast(data.error || 'Import mislukt', 'error');
      return;
    }

    // Close preview and pin modals
    closeModal('modal-dm-preview');
    closeModal('modal-dm-pin');

    // Show result modal
    toonDMImportResultaat(data.resultaten);
  } catch (err) {
    console.error('Import error:', err);
    showToast('Fout tijdens import: ' + err.message, 'error');
  }
}

function toonDMImportResultaat(resultaten) {
  const container = document.getElementById('dm-result-content');
  if (!container) return;

  container.innerHTML = '';

  const html = resultaten.map(res => {
    if (res.fout) {
      return `
        <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:1rem; margin-bottom:10px;">
          <strong style="color:#f87171; display:block; margin-bottom:4px;"><i class="ti ti-alert-triangle"></i> ${res.bestand}</strong>
          <span style="font-size:12px; color:#fca5a5;">Import mislukt: ${res.fout}</span>
        </div>
      `;
    }

    const hasFouten = res.fouten && res.fouten.length > 0;
    const hasAutoAangemaakt = res.autoAangemaakt && res.autoAangemaakt.length > 0;

    return `
      <div style="background:#0e0e0e; border:1px solid #1e1e1e; border-radius:8px; padding:1.25rem; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <strong style="color:white; font-size:14px;"><i class="ti ti-file-check" style="color:#22c55e;"></i> ${res.bestand}</strong>
          <span class="dm-badge ${res.tabelType === 'timesheets' ? 'operations' : (res.tabelType === 'facturen' ? 'cashflow' : (res.tabelType === 'klanten' ? 'crm' : (res.tabelType === 'projecten' ? 'contracts' : 'hr')))}">${res.tabelType.toUpperCase()}</span>
        </div>
        
        <div style="font-size:12px; color:#cbd5e1; display:flex; gap:16px; margin-bottom:10px;">
          <span style="color:#4ade80;">Toegevoegd: <strong>${res.toegevoegd}</strong></span>
          <span style="color:#94a3b8;">Overgeslagen (duplicaten): <strong>${res.overgeslagen}</strong></span>
          <span style="color:#f87171;">Fouten: <strong>${hasFouten ? res.fouten.length : 0}</strong></span>
        </div>

        ${hasAutoAangemaakt ? `
          <div style="background:rgba(245,158,11,0.05); border:1px solid rgba(245,158,11,0.25); border-radius:6px; padding:8px 12px; margin-bottom:10px; border-left:3px solid #f59e0b;">
            <span style="font-size:11px; color:#fbbf24; font-weight:700; display:flex; align-items:center; gap:4px; margin-bottom:4px;">
              ⚡ ${res.autoAangemaakt.length} automatisch aangemaakt:
            </span>
            <ul style="margin:0; padding-left:16px; font-size:11px; color:#f59e0b; line-height:1.5;">
              ${res.autoAangemaakt.map(item => `<li>${item}</li>`).join('')}
            </ul>
            <span style="font-size:10px; color:#a1a1aa; display:block; margin-top:6px;">
              ℹ️ Vul de gegevens van auto-aangemaakte records later aan via de Clients/Developers pagina.
            </span>
          </div>
        ` : ''}

        ${hasFouten ? `
          <div style="background:rgba(239,68,68,0.05); border:1px solid rgba(239,68,68,0.2); border-radius:6px; padding:8px 12px;">
            <span style="font-size:10px; color:#fca5a5; font-weight:700; text-transform:uppercase; display:block; margin-bottom:4px;">Gedetecteerde Import Fouten (Eerste 20):</span>
            <ul style="margin:0; padding-left:16px; font-size:11px; color:#f87171; line-height:1.5;">
              ${res.fouten.map(f => `<li>${f}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  container.innerHTML = html;

  const modal = document.getElementById('modal-dm-result');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function sluitDmResultEnRefresh() {
  closeModal('modal-dm-result');
  
  // Refresh all dashboard and lists states
  if (typeof loadClients === 'function') loadClients();
  if (typeof loadDevelopers === 'function') loadDevelopers();
  if (typeof loadTimesheets === 'function') {
    loadTimesheets().then(() => {
      if (typeof renderTimesheetsTable === 'function') {
        renderTimesheetsTable(
          document.getElementById('ts-search')?.value || '',
          document.getElementById('ts-status-filter')?.value || ''
        );
      }
      if (typeof updateTimesheetSummary === 'function') updateTimesheetSummary();
    });
  }
  if (typeof loadInvoices === 'function') {
    loadInvoices().then(() => {
      if (typeof renderInvoicesTable === 'function') renderInvoicesTable();
      if (typeof updateInvoiceStats === 'function') updateInvoiceStats();
    });
  }
}

function selectDMScope(scope) {
  // Reset alle kaarten
  document.querySelectorAll('.dm-scope-card').forEach(c => c.classList.remove('selected'));

  // Als reset uitgeschakeld is blokkeer dan
  if (scope === 'reset' && !SYSTEM_RESET_ENABLED) {
    showToast('System Reset is uitgeschakeld door de beheerder', 'error');
    return;
  }

  huidigeDMScope = scope;
  document.getElementById(`scope-${scope}`)?.classList.add('selected');

  // Verberg alle criteria panelen
  ['default','periode','klant','reset','cvs'].forEach(s => {
    const el = document.getElementById(`dm-criteria-${s}`);
    if (el) el.style.display = 'none';
  });

  // Verberg impact analyse
  const impactEl = document.getElementById('dm-impact-analyse');
  if (impactEl) impactEl.style.display = 'none';

  // Toon juiste criteria paneel
  if (scope === 'uren' || scope === 'omzet') {
    const titel = scope === 'uren' ? 'Periode voor urenregistraties' : 'Periode voor facturen';
    const titelEl = document.getElementById('dm-criteria-titel');
    if (titelEl) titelEl.textContent = titel;
    const periodeEl = document.getElementById('dm-criteria-periode');
    if (periodeEl) periodeEl.style.display = 'block';
  } else if (scope === 'klant') {
    const klantEl = document.getElementById('dm-criteria-klant');
    if (klantEl) klantEl.style.display = 'block';
    laadKlantenDropdown();
  } else if (scope === 'cvs') {
    const cvsEl = document.getElementById('dm-criteria-cvs');
    if (cvsEl) cvsEl.style.display = 'block';
  } else if (scope === 'reset') {
    const resetEl = document.getElementById('dm-criteria-reset');
    if (resetEl) resetEl.style.display = 'block';
  }
}

async function laadKlantenDropdown() {
  try {
    const data = await apiFetchSafe('/api/klanten');
    const select = document.getElementById('dm-klant-select');
    if (!select) return;
    
    const clientsList = data || [];
    select.innerHTML = '<option value="">— Kies een klant —</option>' +
      clientsList.map(k =>
        `<option value="${k.klant_id || k.id || ''}">${k.naam || k.name || ''}</option>`
      ).join('');
  } catch(err) {
    console.error('Klanten laden mislukt:', err);
    showToast('Fout bij het laden van klanten', 'error');
  }
}

async function evaluerenImpact() {
  const body = { scope: huidigeDMScope };

  if (huidigeDMScope === 'uren' || huidigeDMScope === 'omzet') {
    body.van = document.getElementById('dm-periode-van')?.value;
    body.tot = document.getElementById('dm-periode-tot')?.value;
    if (!body.van || !body.tot) {
      showToast('Fout: Selecteer een van- en tot-datum.', 'error');
      return;
    }
  }
  if (huidigeDMScope === 'klant') {
    body.klant_id = document.getElementById('dm-klant-select')?.value;
    if (!body.klant_id) {
      showToast('Fout: Gelieve eerst de te verwijderen klant te selecteren.', 'error');
      return;
    }
  }
  if (huidigeDMScope === 'cvs') {
    body.cvKeuze = document.querySelector('input[name="cv-scope-keuze"]:checked')?.value || 'kandidaten';
  }

  const res = await fetch('/api/data-management/impact-analyse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  if (!res.ok) {
    showToast(data.error || 'Impact analyse mislukt', 'error');
    return;
  }

  // Vul de echte data in
  document.getElementById('impact-target').textContent = data.target;
  document.getElementById('impact-target-sub').textContent = data.targetSub;
  document.getElementById('impact-records').textContent = data.aantalRecords;
  document.getElementById('impact-verlies').textContent =
    '€' + Math.round(data.verlies).toLocaleString('nl-NL');
  document.getElementById('impact-cascade').textContent = data.cascade;

  // Update checkbox 2 tekst met het echte bedrag
  const check2Label = document.querySelector('label[for="check-2"], #check-2')?.closest('.dm-check-item');
  if (check2Label) {
    check2Label.innerHTML = `<input type="checkbox" id="check-2" onchange="updateVernietigKnop()" />
      Ik heb de gecalculeerde impactwaarde van €${Math.round(data.verlies).toLocaleString('nl-NL')} gecontroleerd en ga akkoord.`;
  }

  // Bewaar voor de vernietig-stap
  window._dmImpactData = body;

  document.getElementById('dm-impact-analyse').style.display = 'block';

  // Reset checks/PIN
  ['check-1','check-2','check-3'].forEach(id => {
    const el = document.getElementById(id); if (el) el.checked = false;
  });
  ['pin-1','pin-2','pin-3','pin-4'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const c = document.getElementById('dm-confirm-text'); if (c) c.value = '';
  updateVernietigKnop();
}

function movePinFocus(current, nextId) {
  if (current.value.length === 1 && nextId) {
    document.getElementById(nextId)?.focus();
  }
  updateVernietigKnop();
}

function updateVernietigKnop() {
  const check1 = document.getElementById('check-1')?.checked;
  const check2 = document.getElementById('check-2')?.checked;
  const check3 = document.getElementById('check-3')?.checked;
  const pin = ['pin-1','pin-2','pin-3','pin-4']
    .map(id => document.getElementById(id)?.value || '')
    .join('');
  const confirmText = document.getElementById('dm-confirm-text')?.value;

  const allesKlaar = check1 && check2 && check3 &&
                     pin.length === 4 &&
                     confirmText === 'VERWIJDER';

  const btn = document.getElementById('btn-permanent-vernietigen');
  if (btn) {
    btn.disabled = !allesKlaar;
    btn.classList.toggle('active', allesKlaar);
  }
}

async function permanentVernietigen() {
  const pin = ['pin-1','pin-2','pin-3','pin-4']
    .map(id => document.getElementById(id)?.value || '').join('');
  const bevestiging = document.getElementById('dm-confirm-text')?.value;

  const body = {
    ...window._dmImpactData,
    pin,
    bevestiging
  };

  if (huidigeDMScope === 'cvs') {
    body.cvKeuze = document.querySelector('input[name="cv-scope-keuze"]:checked')?.value || 'kandidaten';
  }

  const btn = document.getElementById('btn-permanent-vernietigen');
  btn.disabled = true;
  btn.textContent = 'Bezig met vernietigen...';

  const res = await fetch('/api/data-management/vernietig', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();

  if (!res.ok) {
    showToast(data.error || 'Vernietiging mislukt', 'error');
    btn.disabled = false;
    btn.textContent = 'Permanent Vernietigen 🗑️';
    return;
  }

  // Toon resultaat
  const samenvatting = Object.entries(data.verwijderd)
    .map(([k, v]) => `${v} ${k}`).join(', ');
  showToast(`Vernietiging voltooid: ${samenvatting}`, 'success');

  // Reset de hele sectie en refresh data
  document.getElementById('dm-impact-analyse').style.display = 'none';
  document.querySelectorAll('.dm-scope-card').forEach(c => c.classList.remove('selected'));
  ['default','periode','klant','reset','cvs'].forEach(s => {
    const el = document.getElementById(`dm-criteria-${s}`);
    if (el) el.style.display = s === 'default' ? 'block' : 'none';
  });
  huidigeDMScope = null;

  btn.disabled = true;
  btn.textContent = 'Permanent Vernietigen 🗑️';

  // Refresh alle dashboards/lijsten zodat de verwijderde data verdwijnt
  if (typeof renderDashboardStats === 'function') renderDashboardStats();
  if (typeof loadClients === 'function') loadClients();
  if (typeof loadDevelopers === 'function') loadDevelopers();
  if (typeof loadCVDatabase === 'function') loadCVDatabase();
}

// === CV Deletion Logic ===
let _verwijderCVId = null;

function verwijderCV(devId, naam, hasCV) {
  _verwijderCVId = devId;
  document.getElementById('vcv-naam').textContent = naam;
  
  const alleenCvOptie = document.getElementById('vcv-optie-alleen-cv');
  if (alleenCvOptie) {
    alleenCvOptie.style.display = hasCV ? 'flex' : 'none';
  }
  
  if (hasCV) {
    document.querySelector('input[name="vcv-keuze"][value="alleen-cv"]').checked = true;
  } else {
    document.querySelector('input[name="vcv-keuze"][value="hele-kandidaat"]').checked = true;
  }
  
  document.getElementById('modal-verwijder-cv').style.display = 'flex';
}

function sluitVerwijderCVModal() {
  document.getElementById('modal-verwijder-cv').style.display = 'none';
  _verwijderCVId = null;
}

async function bevestigVerwijderCV() {
  if (!_verwijderCVId) return;
  const keuze = document.querySelector('input[name="vcv-keuze"]:checked')?.value;

  const isEchteDeveloper = !isNaN(parseInt(_verwijderCVId)) && String(_verwijderCVId).match(/^\d+$/);
  if (!isEchteDeveloper) {
    // Verwijder uit de lokale cvs/mock array
    cvs = cvs.filter(c => String(c.id || c.developer_id) !== String(_verwijderCVId));
    saveCVs();
    sluitVerwijderCVModal();
    showToast('CV verwijderd', 'success');
    if (typeof loadCVDatabase === 'function') {
      await loadCVDatabase();
    } else {
      renderCVDatabase();
    }
    return;
  }

  let url, method;
  if (keuze === 'alleen-cv') {
    url = `/api/developers/${_verwijderCVId}/cv`;
    method = 'DELETE';
  } else {
    url = `/api/developers/${_verwijderCVId}`;
    method = 'DELETE';
  }

  const res = await fetch(url, { method });
  const data = await res.json();

  if (!res.ok) {
    showToast(`Verwijderen mislukt: ${data.error || 'onbekende fout'}`, 'error');
    return;
  }

  sluitVerwijderCVModal();
  showToast(keuze === 'alleen-cv' ? 'CV verwijderd' : 'Kandidaat verwijderd', 'success');
  
  // Reload developers and CV database to update UI stats and tables
  if (typeof loadDevelopers === 'function') {
    await loadDevelopers();
  }
  if (typeof loadCVDatabase === 'function') {
    await loadCVDatabase();
  } else {
    renderCVDatabase();
  }
}

