// ============================================================
//  REEMO – API-backed state
//  All reads/writes go to the Express backend → Supabase.
//  Seed data is only used as a fallback when the API is down.
// ============================================================

function genId(p) { return p + Date.now() + Math.random().toString(36).slice(2,5); }

// ── In-memory cache (populated by load* functions on page load) ───────────────
let clients    = [];
let developers = [];
let timesheets = [];
let cvs        = [];           // CV database still uses localStorage (no DB table yet)
let invoices   = [];

// ── CV Upload modal state (var = always hoisted, never causes TDZ errors) ──────
var _cvParsedSkills  = [];
var _cvSavedFilename = null;
var _cvOriginalName  = null;

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
    { id:'cv1', name:'Thomas Anderson', skills:['React','Node.js','TypeScript'], uploadDate:'2024-03-20', status:'ORIGINAL'     },
    { id:'cv2', name:'Trinity Knight',  skills:['Python','Django','AWS'],        uploadDate:'2024-03-21', status:'REEMO FORMAT' },
    { id:'cv3', name:'Morpheus Dream',  skills:['Kubernetes','Docker','Go'],     uploadDate:'2024-03-22', status:'ORIGINAL'     },
    { id:'cv4', name:'Niobe Captain',   skills:['Java','Spring Boot','SQL'],     uploadDate:'2024-03-23', status:'REEMO FORMAT' },
    { id:'cv5', name:'Cypher Traitor',  skills:['PHP','Laravel','Vue.js'],       uploadDate:'2024-03-24', status:'ORIGINAL'     },
];
function _ls(k, d) { try { const v=localStorage.getItem(k); return v?JSON.parse(v):JSON.parse(JSON.stringify(d)); } catch{return JSON.parse(JSON.stringify(d));} }
function _lss(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
cvs = _ls('reemo_cvs', _DEF_CVS);
function saveCVs() { _lss('reemo_cvs', cvs); }

// ── Generic API fetch helper ──────────────────────────────────────────────────
// Also translates PostgreSQL errors to Dutch user-friendly messages
const FK_ERRORS = {
    'violates foreign key constraint': 'De gekoppelde record bestaat niet (controleer of de klant/developer/project bestaat).',
    'violates not-null constraint':    'Een verplicht veld ontbreekt. Vul alle velden in.',
    'duplicate key value':             'Er bestaat al een record met deze gegevens.',
    'relation':                        'Databasetabel niet gevonden. Controleer de serverinstellingen.',
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
        id: r.klant_id, naam: r.naam, name: r.naam,
        contactPerson: r.contactpersoon, contactpersoon: r.contactpersoon,
        email: r.email, sector: r.sector, industry: r.sector,
        developersCount: 0, totalHoursMonth: 0, invoiceStatus: 'Open'
    })) : (clients.length ? clients : _DEF_CLIENTS);
}

async function loadDevelopers() {
    const data = await apiFetchSafe('/api/developers');
    developers = data ? data.map(r => ({
        id: r.developer_id, naam: r.naam, name: r.naam,
        email: r.email, role: r.rol, rol: r.rol,
        hourlyRate: parseFloat(r.uurtarief)||0, uurtarief: r.uurtarief,
        weekcapaciteit: r.weekcapaciteit || 40,
        hoursThisWeek: parseFloat(r.uren_week) || 0,
        activeProjects: parseInt(r.project_count) || 0,
        firstProjectId: r.first_project_id,
        firstClientId: r.first_klant_id
    })) : (developers.length ? developers : _DEF_DEVS);
}

async function loadTimesheets() {
    const data = await apiFetchSafe('/api/timesheets');
    timesheets = data ? data.map(r => ({
        id: r.id, developer_id: r.developer_id, developerName: r.developerName,
        clientName: r.clientName || '—', projectName: r.projectName || '—',
        hoursWorked: parseFloat(r.hoursWorked)||0, bedrag: parseFloat(r.bedrag)||0, status: r.status,
        date: r.date ? r.date.slice(0,10) : '', description: r.description || ''
    })) : (timesheets.length ? timesheets : _DEF_TS);
}

async function loadInvoices() {
    const data = await apiFetchSafe('/api/facturen');
    invoices = data ? data.map(r => ({
        id: (r.factuur_id || r.id || '').toString(),
        clientName: r.klant_naam || r.clientName,
        amount: parseFloat(r.totaalbedrag || r.amount) || 0,
        status: r.betalingsstatus || r.status,
        dateSent: (r.factuurdatum || r.dateSent || '').slice(0,10),
        paymentDeadline: (r.vervaldatum || r.paymentDeadline || '').slice(0,10)
    })) : (invoices.length ? invoices : _DEF_INV);
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
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function getStatusClass(status) {
    status = status.toLowerCase();
    if (status === 'approved' || status === 'paid' || status === 'betaald') return 'status-approved';
    if (status === 'pending' || status === 'open') return 'status-pending';
    if (status === 'rejected' || status === 'overdue' || status === 'te_laat') return 'status-rejected';
    return '';
}

function formatCurrency(amount) {
    return '$' + amount.toLocaleString();
}

// --- DOM Elements ---
const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout-btn');
const navItems = document.querySelectorAll('.nav-item[data-target]');
const screenContents = document.querySelectorAll('.screen-content');

const wsAdminBtn = document.getElementById('ws-admin-btn');
const wsDevBtn = document.getElementById('ws-dev-btn');
const loginEmailInput = document.getElementById('login-email');
const loginGlow = document.getElementById('login-glow');
const loginLogoBox = document.getElementById('login-logo-box');
const loginSubmitBtn = document.getElementById('login-submit-btn');

const navAdminItems = document.getElementById('nav-admin-items');
const navDevItems = document.getElementById('nav-dev-items');
const userProfileAvatar = document.getElementById('user-profile-avatar');
const userProfileName = document.getElementById('user-profile-name');

let currentRole = 'admin';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Workspace Toggles
    if (wsAdminBtn && wsDevBtn) {
        wsAdminBtn.addEventListener('click', () => setLoginWorkspace('admin'));
        wsDevBtn.addEventListener('click', () => setLoginWorkspace('developer'));
    }

    // Setup Event Listeners
    if (loginForm) loginForm.addEventListener('submit', (e) => handleLogin(e, currentRole));
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
    initCharts();
});

// --- Authentication ---
function setLoginWorkspace(role) {
    currentRole = role;
    if (role === 'admin') {
        wsAdminBtn.classList.add('active');
        wsDevBtn.classList.remove('active');
        if (loginEmailInput) loginEmailInput.value = 'admin@reemo.io';
        if (loginSubmitBtn) {
            loginSubmitBtn.style.background = 'var(--blue-600)';
            loginSubmitBtn.style.boxShadow = '0 0 24px rgba(37,99,235,0.3)';
        }
    } else {
        wsDevBtn.classList.add('active');
        wsAdminBtn.classList.remove('active');
        if (loginEmailInput) loginEmailInput.value = 'developer@reemo.io';
        if (loginSubmitBtn) {
            loginSubmitBtn.style.background = '#059669';
            loginSubmitBtn.style.boxShadow = '0 0 24px rgba(16,185,129,0.3)';
        }
    }
}


function handleLogin(e, role) {
    e.preventDefault();
    loginScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');

    const appTitle = document.getElementById('app-title');

    if (role === 'developer') {
        navAdminItems.classList.add('hidden');
        navDevItems.classList.remove('hidden');
        userProfileAvatar.textContent = 'A';
        userProfileAvatar.className = 'w-8 h-8 rounded-full bg-emerald-900 text-emerald-400 font-bold flex items-center justify-center shrink-0';
        userProfileName.innerHTML = `<p class="text-sm font-medium truncate">Alex Rivera</p><p class="text-[10px] text-emerald-500 truncate">Developer</p>`;
        if (appTitle) appTitle.textContent = 'Reemo Developer';
        navigateTo('dev-dashboard');
    } else {
        navDevItems.classList.add('hidden');
        navAdminItems.classList.remove('hidden');
        userProfileAvatar.textContent = 'T';
        userProfileAvatar.className = 'avatar-small';
        userProfileName.innerHTML = `<p class="text-sm font-medium truncate">Test</p><p class="text-[10px] text-white-40 truncate">Admin</p>`;
        if (appTitle) appTitle.textContent = 'Reemo Admin';
        navigateTo('dashboard');
    }
}

function handleLogout() {
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
        const devId = developers[0]?.id;
        
        // Helper to fill the dropdown
        function fillProjectDropdown(devProjects) {
            const sel = document.getElementById('dev-ts-project');
            // Prefer dev-specific projects; fall back to all available projects
            const displayProjects = (devProjects && devProjects.length > 0) ? devProjects : projects;
            if (sel) {
                if (!displayProjects || displayProjects.length === 0) {
                    sel.innerHTML = '<option value="">— Geen projecten beschikbaar —</option>';
                } else {
                    sel.innerHTML = displayProjects.map(p =>
                        `<option value="${p.project_id}">${p.klant_naam || 'Onbekende Klant'} — ${p.projectnaam}</option>`
                    ).join('');
                }
            }
            
            // Show/hide warning banner
            const warn = document.getElementById('dev-ts-prereq-warn');
            if (warn) {
                if (projects.length === 0 && developers.length === 0) {
                    warn.textContent = `⚠ Neem contact op met de admin om projecten aan te maken.`;
                    warn.style.display = 'block';
                } else {
                    warn.style.display = 'none';
                }
            }
        }
        
        // Fill immediately with the projects array (no API needed)
        fillProjectDropdown(null);
        
        // Then try to also load dev-specific project assignments
        if (devId) {
            apiFetchSafe(`/api/developer-projects/${devId}`).then(devProjects => {
                if (devProjects && devProjects.length > 0) {
                    fillProjectDropdown(devProjects);
                }
            });
        }
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
}

async function loadDevDashboard() {
    const devId = developers[0]?.id;
    if (!devId) return;

    const container = document.getElementById('screen-dev-dashboard');
    if (!container) return;

    try {
        const res = await apiFetch(`/api/developers/${devId}/dashboard`);
        renderDevDashboard(res);
    } catch (e) {
        console.error('Failed to load dev dashboard:', e);
    }
}

function renderDevDashboard(data) {
    // Update Welcome Banner
    const welcomeText = document.querySelector('#screen-dev-dashboard .page-header-left p');
    if (welcomeText) {
        welcomeText.innerHTML = `Welcome back, <strong style="color:var(--white)">${data.devName}</strong>. Here is your current status.`;
    }

    // Update Stats
    const statsCards = document.querySelectorAll('#screen-dev-dashboard .dev-stat-card');
    if (statsCards.length >= 3) {
        // Hours This Week
        const hoursCard = statsCards[0];
        const capacity = data.assignment?.weekcapaciteit || 40;
        const hoursPct = Math.min((data.stats.hoursThisWeek / capacity) * 100, 100);
        hoursCard.querySelector('.dev-stat-value').innerHTML = `${data.stats.hoursThisWeek}<span class="dev-stat-unit">h</span>`;
        hoursCard.querySelector('.capacity-bar-fill').style.width = `${hoursPct}%`;
        
        // Active Projects
        statsCards[1].querySelector('.dev-stat-value').textContent = data.stats.activeProjects;
        
        // Pending Invoices (Placeholder)
        statsCards[2].querySelector('.dev-stat-value').textContent = data.stats.pendingInvoices;
    }

    // Update Current Assignment
    const assignmentCard = document.querySelector('.dev-assignment-card');
    if (assignmentCard) {
        if (data.assignment) {
            assignmentCard.querySelector('h3').textContent = data.assignment.projectnaam;
            assignmentCard.querySelector('div[style*="color:var(--white-40)"]').textContent = data.assignment.klant_naam;
            assignmentCard.querySelector('p').textContent = `Current role: ${data.assignment.rol_op_project || 'Developer'}`;
            
            const periodDivs = assignmentCard.querySelectorAll('.dev-inner-box div[style*="color:var(--white)"]');
            if (periodDivs.length >= 2) {
                const start = new Date(data.assignment.start_datum).toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' });
                periodDivs[0].textContent = `${start} – Present`;
                periodDivs[1].textContent = `${data.assignment.weekcapaciteit || 40} Hours`;
            }
        } else {
            assignmentCard.innerHTML = `
                <div style="padding:2rem;text-align:center;color:var(--white-30)">
                    <i data-lucide="briefcase" style="width:32px;height:32px;margin-bottom:1rem;opacity:0.2"></i>
                    <div style="font-weight:700;color:var(--white-60)">Geen actieve opdracht</div>
                    <div style="font-size:0.8125rem">Neem contact op met de admin voor een nieuwe toewijzing.</div>
                </div>
            `;
        }
    }

    // Update Recent Timesheets (We'll add a section for this)
    // For now, let's inject it or update the deadlines if that's what was intended
}

// --- Renderers ---

function renderDashboardStats() {
    const statsContainer = document.getElementById('dashboard-stats');
    if (!statsContainer) return;
    
    const totalHours = timesheets.reduce((s,t) => s + (parseFloat(t.hoursWorked)||0), 0);
    const openInvoices = invoices.filter(i => (i.status||'').toLowerCase() === 'open').length;
    
    const stats = [
        {
            label: 'Active Clients',
            value: clients.length || 0,
            icon: 'users',
            accent: '#3b82f6',
            bg: 'rgba(37,99,235,0.08)',
            border: 'rgba(37,99,235,0.18)',
            glow: 'rgba(59,130,246,0.15)',
            trend: '+2 this month',
            trendUp: true,
        },
        {
            label: 'Developers',
            value: developers.length || 0,
            icon: 'code-2',
            accent: '#10b981',
            bg: 'rgba(16,185,129,0.08)',
            border: 'rgba(16,185,129,0.18)',
            glow: 'rgba(16,185,129,0.15)',
            trend: 'Active roster',
            trendUp: true,
        },
        {
            label: 'Hours Registered',
            value: totalHours + 'h',
            icon: 'clock',
            accent: '#f59e0b',
            bg: 'rgba(245,158,11,0.08)',
            border: 'rgba(245,158,11,0.18)',
            glow: 'rgba(245,158,11,0.15)',
            trend: 'This period',
            trendUp: true,
        },
        {
            label: 'Open Invoices',
            value: openInvoices,
            icon: 'file-text',
            accent: openInvoices > 0 ? '#f43f5e' : '#10b981',
            bg: openInvoices > 0 ? 'rgba(244,63,94,0.08)' : 'rgba(16,185,129,0.08)',
            border: openInvoices > 0 ? 'rgba(244,63,94,0.18)' : 'rgba(16,185,129,0.18)',
            glow: openInvoices > 0 ? 'rgba(244,63,94,0.12)' : 'rgba(16,185,129,0.12)',
            trend: openInvoices > 0 ? 'Requires action' : 'All settled',
            trendUp: openInvoices === 0,
        },
    ];
    
    statsContainer.innerHTML = stats.map((s, i) => `
        <div style="
            position:relative;overflow:hidden;padding:1.25rem 1.375rem;
            background:#0d0d0d;border:1px solid ${s.border};
            border-radius:0.875rem;cursor:default;
            transition:transform 0.2s, box-shadow 0.2s;
            box-shadow:0 0 0 1px rgba(255,255,255,0.03), 0 4px 24px ${s.glow};
            animation:fadeIn 0.4s ease-out ${i * 0.08}s both
        " onmouseenter="this.style.transform='translateY(-2px)';this.style.boxShadow='0 0 0 1px rgba(255,255,255,0.06),0 8px 32px ${s.glow}'"
           onmouseleave="this.style.transform='';this.style.boxShadow='0 0 0 1px rgba(255,255,255,0.03),0 4px 24px ${s.glow}'">
            <!-- Background glow blob -->
            <div style="position:absolute;top:-30px;right:-20px;width:100px;height:100px;border-radius:50%;background:radial-gradient(circle,${s.glow} 0%,transparent 70%);pointer-events:none"></div>
            
            <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1rem">
                <div style="width:2.5rem;height:2.5rem;border-radius:0.75rem;background:${s.bg};border:1px solid ${s.border};display:flex;align-items:center;justify-content:center;flex-shrink:0">
                    <i data-lucide="${s.icon}" style="width:16px;height:16px;color:${s.accent}"></i>
                </div>
                <span style="font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#34d399;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:0.375rem;padding:0.2rem 0.5rem;white-space:nowrap">LIVE</span>
            </div>
            
            <div style="margin-bottom:0.375rem">
                <div style="font-size:1.875rem;font-weight:900;color:var(--white);letter-spacing:-0.02em;line-height:1">${s.value}</div>
            </div>
            <div style="font-size:0.75rem;font-weight:600;color:var(--white-50);margin-bottom:0.625rem">${s.label}</div>
            
            <div style="display:flex;align-items:center;gap:0.3rem">
                <i data-lucide="${s.trendUp ? 'trending-up' : 'alert-circle'}" style="width:11px;height:11px;color:${s.trendUp ? '#34d399' : '#f59e0b'}"></i>
                <span style="font-size:0.625rem;color:${s.trendUp ? '#34d399' : '#f59e0b'};font-weight:600">${s.trend}</span>
            </div>
            
            <!-- Bottom accent line -->
            <div style="position:absolute;bottom:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,${s.accent},transparent);opacity:0.5"></div>
        </div>
    `).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
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

function renderClientsGrid() {
    const grid = document.getElementById('clients-grid');
    if (!grid) return;

    let displayClients = clients;
    if (activeClientSectorFilter) {
        displayClients = clients.filter(c => (c.sector || '').toLowerCase() === activeClientSectorFilter.toLowerCase());
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
        <div class="client-card" style="animation:fadeIn 0.25s ease-out ${i*0.06}s both" onclick="openClientDetails('${id}')">
            <div class="client-card-actions">
                <span class="status-badge status-approved" style="font-size:0.5rem">${sector}</span>
                <button class="client-card-btn" title="Bewerken" onclick="event.stopPropagation();openEditClientModal('${id}')">
                    <i data-lucide="pencil" style="width:12px;height:12px"></i>
                </button>
                <button class="client-card-btn" title="Verwijderen" style="color:#f43f5e" onclick="event.stopPropagation();deleteClient('${id}','${(c.naam||'').replace(/'/g,"\\'")}', this)">
                    <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                </button>
            </div>
            <div class="client-card-header">
                <div class="client-logo"><span class="logo-initials">${initials}</span></div>
                <div style="min-width:0;flex:1">
                    <div class="client-card-name">${c.naam || c.name}</div>
                    <div class="client-card-meta">${sector} • ${contact}</div>
                </div>
            </div>
            <div class="client-stat-grid">
                <div class="client-stat-box">
                    <div class="client-stat-label"><i data-lucide="mail" style="width:10px;height:10px;color:#60a5fa"></i> E-mail</div>
                    <div class="client-stat-value" style="font-size:0.6875rem;font-weight:600">${c.email || '—'}</div>
                </div>
                <div class="client-stat-box">
                    <div class="client-stat-label"><i data-lucide="phone" style="width:10px;height:10px;color:#34d399"></i> Telefoon</div>
                    <div class="client-stat-value" style="font-size:0.6875rem;font-weight:600">${c.telefoonnummer || '—'}</div>
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

async function deleteClient(id, naam, btnElement) {
    if (!confirm(`Weet je zeker dat je "${naam}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`)) return;
    
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.innerHTML = '<div class="spinner" style="width:12px;height:12px;border:2px solid rgba(244,63,94,0.3);border-top-color:#f43f5e;border-radius:50%;animation:spin 1s linear infinite"></div>';
    }
    
    try {
        await apiFetch(`/api/klanten/${id}`, { method: 'DELETE' });
        await loadClients();
        renderClientsGrid();
        if (typeof renderDashboardStats === 'function') renderDashboardStats();
        showToast(`✓ Klant "${naam}" verwijderd.`);
    } catch (e) { 
        showToast(`⚠ ${e.message}`); 
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.innerHTML = '<i data-lucide="trash-2" style="width:12px;height:12px"></i>';
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }
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
    document.getElementById('detail-client-logo').textContent = getInitials(k.naam);
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
            <div style="font-size:0.6875rem;color:var(--white-40)">${p.type||'—'} • ${(p.startdatum||'').slice(0,10)||'—'} → ${(p.einddatum||'').slice(0,10)||'—'}</div>
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
            <div style="font-weight:700;font-size:0.8125rem;color:var(--white)">${(f.factuurdatum||'').slice(0,10)||'—'}</div>
            <div style="font-size:0.6875rem;color:var(--white-40)">Vervalt: ${(f.vervaldatum||'').slice(0,10)||'—'}</div>
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
    const isMale = !['Aisha','Elena','Nadia','Sarah'].includes(dev.naam.split(' ')[0]);
    const genderColor = isMale ? '#60a5fa' : '#f472b6'; // Blue or Pink theme based on initial setup

    // Calculate totals from uren
    const totalHours = uren.reduce((sum, u) => sum + parseFloat(u.aantal_uren || 0), 0);
    const activeProjects = new Set(uren.map(u => u.project_id)).size || projecten.length;

    // Build recent timesheets list
    const tsHtml = uren.slice(0, 5).map(u => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:1rem 0;border-bottom:1px solid rgba(255,255,255,0.05)">
          <div>
              <div style="font-weight:700;color:var(--white);font-size:0.875rem">${u.projectnaam}</div>
              <div style="font-size:0.75rem;color:var(--white-40);margin-top:0.25rem">${u.klant_naam} • ${u.beschrijving}</div>
          </div>
          <div style="text-align:right">
              <div style="font-family:monospace;color:var(--white);font-weight:700">${parseFloat(u.aantal_uren)}h</div>
              <div style="font-size:0.75rem;color:var(--white-40);margin-top:0.25rem">${u.datum.slice(0,10)}</div>
          </div>
      </div>
    `).join('') || '<div style="color:var(--white-40);font-size:0.875rem;padding:1rem 0">Geen urenregistraties gevonden.</div>';

    let cvHtml = '';
    if (cv) {
        let skills = [];
        try { skills = JSON.parse(cv.skills || '[]'); } catch(e){}
        cvHtml = `
            <div style="background:#111;border:1px solid #1e1e1e;border-radius:1rem;padding:1.5rem;margin-bottom:2rem">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
                    <h3 style="font-size:1rem;font-weight:700;display:flex;align-items:center;gap:0.5rem">
                        <i data-lucide="file-text" style="width:16px;height:16px;color:#34d399"></i> CV Informatie
                    </h3>
                    <a href="/api/cv/file/${encodeURIComponent(cv.savedFilename)}" target="_blank" class="btn-outline" style="font-size:0.75rem;padding:0.4rem 0.8rem;text-decoration:none">
                        <i data-lucide="download" style="width:12px;height:12px"></i> CV Downloaden
                    </a>
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:1.5rem">
                    ${skills.map(s => `<span style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:0.25rem 0.6rem;border-radius:1rem;font-size:0.6875rem;color:var(--white-60)">${s}</span>`).join('')}
                </div>
                ${cv.experience ? `
                <div style="margin-bottom:1rem">
                    <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;color:var(--white-40);margin-bottom:0.5rem">Samenvatting / Ervaring</div>
                    <div style="font-size:0.875rem;color:var(--white-60);line-height:1.6">${cv.experience.substring(0, 400)}${cv.experience.length > 400 ? '...' : ''}</div>
                </div>` : ''}
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
                  
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;text-align:left;margin-top:2rem;padding-top:1.5rem;border-top:1px solid rgba(255,255,255,0.05)">
                      <div>
                          <div style="font-size:0.625rem;text-transform:uppercase;font-weight:700;color:var(--white-40);letter-spacing:0.1em;margin-bottom:0.25rem">Email</div>
                          <div style="font-size:0.8125rem;font-weight:600;color:var(--white);word-break:break-all">${dev.email}</div>
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
              </div>
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




function renderDevelopersGrid() {
    const container = document.getElementById('developers-grid');
    if (!container) return;

    if (developers.length === 0) {
        container.innerHTML = `
        <div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4rem 2rem;text-align:center">
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
        const devHours = dev.hoursThisWeek || 0;
        const devProjects = dev.activeProjects || 0;
        const capacityPct = Math.min((devHours / 40) * 100, 100);
        const capacityColor = devHours >= 40 ? '#f43f5e' : (devHours > 30 ? '#f59e0b' : '#3b82f6');
        const isFemale = ['Sarah', 'Elena', 'Niobe', 'Trinity'].some(n => devName.includes(n));
        const avatarClass = isFemale ? 'female' : 'male';
        const isBooked = devProjects > 0;
        
        return `
        <div class="dev-card" style="animation: fadeIn 0.3s ease-out ${i * 0.1}s both;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div style="display:flex;align-items:center;gap:0.75rem;min-width:0;flex:1">
                    <div class="dev-avatar ${avatarClass}">${getInitials(devName)}</div>
                    <div style="min-width:0;flex:1">
                        <div style="font-weight:700;font-size:0.9375rem;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${devName}</div>
                        <div style="font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--white-40);margin-top:0.15rem">${devRole}</div>
                    </div>
                </div>
                <div style="display:flex;gap:0.25rem">
                    <button class="client-card-btn" style="flex-shrink:0" title="Assign to Project" onclick="openAssignProjectModal('${dev.id}')">
                        <i data-lucide="link" style="width:13px;height:13px;color:#60a5fa"></i>
                    </button>
                    <button class="client-card-btn" style="flex-shrink:0" title="View CV">
                        <i data-lucide="file-text" style="width:13px;height:13px"></i>
                    </button>
                </div>
            </div>

            <div class="dev-inner-box">
                <div class="dev-inner-label">
                    <i data-lucide="${isBooked ? 'briefcase' : 'check-circle'}" style="width:10px;height:10px;color:${isBooked ? '#3b82f6' : '#10b981'}"></i>
                    Currently ${isBooked ? 'Booked' : 'Available'}
                </div>
                ${isBooked ? `
                    <div style="font-weight:700;font-size:0.875rem;color:var(--white);margin-top:0.35rem">Checkout Redesign</div>
                    <div style="font-size:0.75rem;color:var(--white-50);margin-top:0.2rem">Acme Corp</div>
                    <div style="font-size:0.7rem;color:var(--white-30);margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #1e1e1e;font-family:monospace">2024-01-01 &mdash; 2024-06-30</div>
                ` : `
                    <div style="font-weight:700;font-size:0.875rem;color:#34d399;margin-top:0.35rem">Ready for Assignment</div>
                    <div style="font-size:0.75rem;color:var(--white-50);margin-top:0.2rem">Available remotely</div>
                    <div style="font-size:0.7rem;color:var(--white-30);margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #1e1e1e;font-family:monospace">Immediate Start</div>
                `}
            </div>

            <div class="dev-inner-grid">
                <div class="dev-inner-box" style="cursor:pointer" onclick="event.stopPropagation(); if(${dev.firstClientId}){ openClientDetails('${dev.firstClientId}') } else { showToast('Nog niet gekoppeld aan een klant') }">
                    <div class="dev-inner-label" style="display:flex;align-items:center;justify-content:space-between">
                        <span><i data-lucide="layout-grid" style="width:10px;height:10px"></i> Projects</span>
                        ${devProjects > 0 ? `<span style="background:#3b82f6;color:white;font-size:0.625rem;padding:0.1rem 0.4rem;border-radius:1rem">${devProjects}</span>` : ''}
                    </div>
                    <div style="font-weight:700;font-size:0.9rem;color:var(--white);margin-top:0.25rem">${devProjects > 0 ? 'View Projects' : 'No Projects'}</div>
                </div>
                <div class="dev-inner-box">
                    <div class="dev-inner-label"><i data-lucide="dollar-sign" style="width:10px;height:10px"></i> Rate</div>
                    <div style="font-weight:700;font-size:1rem;color:var(--white)">€${devRate}/h</div>
                </div>
            </div>

            <div>
                <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:0.5rem">
                    <span style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--white-40)">Weekly Capacity</span>
                    <span style="font-size:0.7rem;font-weight:700;color:${capacityColor}">${devHours} <span style="color:var(--white-30)">/ 40H</span></span>
                </div>
                <div class="capacity-bar-track">
                    <div class="capacity-bar-fill" style="width:${capacityPct}%;background-color:${capacityColor};box-shadow:0 0 8px ${capacityColor}88"></div>
                </div>
            </div>

            <button class="dev-view-btn" onclick="openDeveloperDetails('${dev.id}')">View Profile</button>
        </div>
        `;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Per-session status overrides
const timesheetStatuses = {};

function renderTimesheetsTable(filterText = '', filterStatus = '') {
    const tbody = document.getElementById('timesheets-body');
    if (!tbody) return;

    const filtered = timesheets.filter(ts => {
        const status = timesheetStatuses[ts.id] || ts.status;
        const matchText = !filterText ||
            ts.developerName.toLowerCase().includes(filterText.toLowerCase()) ||
            ts.clientName.toLowerCase().includes(filterText.toLowerCase()) ||
            ts.description.toLowerCase().includes(filterText.toLowerCase());
        const matchStatus = !filterStatus || filterStatus === 'All Statuses' || status.toLowerCase() === filterStatus.toLowerCase();
        return matchText && matchStatus;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:3rem;text-align:center;color:var(--white-30);font-size:0.875rem">No timesheets found</td></tr>`;
        return;
    }

    const isFemale = name => ['Sarah', 'Elena', 'Niobe', 'Trinity'].some(n => name.includes(n));

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
    const pending  = timesheets.filter(ts => ts.status.toLowerCase() === 'pending').length;
    const approved = timesheets.filter(ts => ts.status.toLowerCase() === 'approved').length;
    const rejected = timesheets.filter(ts => ts.status.toLowerCase() === 'rejected').length;
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
            if (typeof initCharts === 'function') initCharts();
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

    const isFemale = name => ['Trinity','Niobe','Sarah','Elena'].some(n => name.includes(n));

    tbody.innerHTML = rows.map((cv, i) => {
        const isReemo   = cv.status === 'REEMO FORMAT';
        const isInactive = cv.active === false; // saved via "Alleen in CV Database"
        const avatarBg  = isFemale(cv.name)
            ? 'background:rgba(236,72,153,0.12);border:1px solid rgba(236,72,153,0.25);color:#f9a8d4'
            : 'background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.25);color:#60a5fa';

        // Status badge
        let statusHtml;
        if (isInactive) {
            statusHtml = `<span style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.25rem 0.625rem;border-radius:0.375rem;font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;background:rgba(245,158,11,0.08);color:#fbbf24;border:1px solid rgba(245,158,11,0.2)">
                <i data-lucide="clock" style="width:9px;height:9px"></i> Nog niet actief
            </span>`;
        } else if (isReemo) {
            statusHtml = `<span style="display:inline-block;padding:0.25rem 0.625rem;border-radius:0.375rem;font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;background:rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2)">Reemo Format</span>`;
        } else {
            statusHtml = `<span style="display:inline-block;padding:0.25rem 0.625rem;border-radius:0.375rem;font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;background:rgba(37,99,235,0.08);color:#60a5fa;border:1px solid rgba(37,99,235,0.15)">Actief</span>`;
        }

        const skillsHtml = (cv.skills || []).slice(0,6).map(s =>
            `<span style="padding:0.2rem 0.45rem;border-radius:0.375rem;background:rgba(255,255,255,0.05);color:var(--white-50);font-size:0.5625rem;font-weight:700;border:1px solid rgba(255,255,255,0.07);white-space:nowrap">${s}</span>`
        ).join('') + ((cv.skills||[]).length > 6 ? `<span style="padding:0.2rem 0.45rem;border-radius:0.375rem;background:rgba(255,255,255,0.03);color:var(--white-30);font-size:0.5625rem;border:1px solid rgba(255,255,255,0.05)">+${cv.skills.length-6}</span>` : '');

        return `
        <tr class="ts-row" style="animation:fadeIn 0.2s ease-out ${i*0.05}s both">
            <td style="padding:0.875rem 1.25rem">
                <div style="display:flex;align-items:center;gap:0.75rem">
                    <div style="width:2.25rem;height:2.25rem;border-radius:0.625rem;${avatarBg};display:flex;align-items:center;justify-content:center;font-size:0.625rem;font-weight:800;flex-shrink:0">${getInitials(cv.name)}</div>
                    <div>
                        <div style="font-weight:700;color:var(--white);font-size:0.875rem">${cv.name}</div>
                        <div style="font-size:0.6875rem;color:var(--white-40);margin-top:0.1rem">${cv.email || ''}</div>
                    </div>
                </div>
            </td>
            <td style="padding:0.875rem 1.25rem;font-size:0.8125rem;color:var(--white-60)">${cv.role || '—'}</td>
            <td style="padding:0.875rem 1.25rem">
                <div style="display:flex;flex-wrap:wrap;gap:0.25rem">${skillsHtml || '<span style="color:var(--white-30);font-size:0.75rem">—</span>'}</div>
            </td>
            <td style="padding:0.875rem 1.25rem;font-family:monospace;font-size:0.8125rem;color:${cv.rate ? '#34d399' : 'var(--white-30)'}">${cv.rate ? '€' + cv.rate + '/h' : '—'}</td>
            <td style="padding:0.875rem 1.25rem;color:var(--white-30);font-family:monospace;font-size:0.8125rem">${cv.uploadDate}</td>
            <td style="padding:0.875rem 1.25rem">${statusHtml}</td>
            <td style="padding:0.875rem 1.25rem;text-align:right">
                <div style="display:flex;justify-content:flex-end;gap:0.375rem">
                    ${isInactive ? `<button class="ts-action-btn approve" title="Activeren als Developer" onclick="activateCVasDeveloper('${cv.id}')">
                        <i data-lucide="user-plus" style="width:13px;height:13px"></i>
                    </button>` : ''}
                    <button class="ts-action-btn view" title="Download CV" onclick="downloadCV('${cv.id}')">
                        <i data-lucide="download" style="width:13px;height:13px"></i>
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
        cvs.push({ id: genId('cv'), name, skills: ['To be reviewed'], uploadDate: new Date().toISOString().slice(0,10), status: 'ORIGINAL' });
        saveCVs();
        renderCVDatabase();
        updateCVStats();
        showToast(`✓ CV "${name}" uploaded successfully!`);
    };
    input.click();
}

function updateCVStats() {
    const total    = cvs.length;
    const original = cvs.filter(c => c.status === 'ORIGINAL').length;
    const reemo    = cvs.filter(c => c.status === 'REEMO FORMAT').length;
    const el = id => document.getElementById(id);
    if (el('cv-stat-total'))    el('cv-stat-total').textContent    = total;
    if (el('cv-stat-original')) el('cv-stat-original').textContent = original;
    if (el('cv-stat-reemo'))    el('cv-stat-reemo').textContent    = reemo;
    if (el('cv-stat-week'))     el('cv-stat-week').textContent     = cvs.filter(c => { const d=new Date(c.uploadDate); const n=new Date(); return (n-d)<7*86400000; }).length;
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

function convertToReemo(id) {
    const cv = cvs.find(c => c.id === id);
    if (cv) { cv.status = 'REEMO FORMAT'; saveCVs(); renderCVDatabase(); updateCVStats(); }
}

// ===== INVOICE STATS =====
function updateInvoiceStats() {
    const outstanding = invoices.filter(i => i.status.toLowerCase() === 'open').reduce((s,i) => s + i.amount, 0);
    const overdue     = invoices.filter(i => i.status.toLowerCase() === 'overdue' || i.status.toLowerCase() === 'te_laat').reduce((s,i) => s + i.amount, 0);
    const paid        = invoices.filter(i => i.status.toLowerCase() === 'paid' || i.status.toLowerCase() === 'betaald').reduce((s,i) => s + i.amount, 0);
    const total       = invoices.reduce((s,i) => s + i.amount, 0);
    const fmt = v => '€' + (v/1000).toFixed(1) + 'k';
    const el = id => document.getElementById(id);
    if (el('inv-stat-total'))       el('inv-stat-total').textContent       = fmt(total);
    if (el('inv-stat-outstanding')) el('inv-stat-outstanding').textContent = fmt(outstanding);
    if (el('inv-stat-overdue'))     el('inv-stat-overdue').textContent     = fmt(overdue);
    if (el('inv-stat-paid'))        el('inv-stat-paid').textContent        = fmt(paid);
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
        const isOverdue = inv.status.toLowerCase() === 'overdue' || inv.status.toLowerCase() === 'te_laat';
        const deadlineColor = isOverdue ? '#fb7185' : 'var(--white-40)';
        return `
        <tr class="ts-row">
            <td style="padding:0.875rem 1.25rem">
                <span style="font-family:monospace;font-weight:700;font-size:0.8125rem;color:#60a5fa">#${inv.id.toUpperCase()}</span>
            </td>
            <td style="padding:0.875rem 1.25rem">
                <div style="display:flex;align-items:center;gap:0.625rem">
                    <div style="width:1.75rem;height:1.75rem;border-radius:0.375rem;background:rgba(37,99,235,0.1);border:1px solid rgba(37,99,235,0.2);display:flex;align-items:center;justify-content:center;font-size:0.5625rem;font-weight:800;color:#60a5fa;flex-shrink:0">${getInitials(inv.clientName)}</div>
                    <span style="font-weight:700;color:var(--white);font-size:0.875rem">${inv.clientName}</span>
                </div>
            </td>
            <td style="padding:0.875rem 1.25rem">
                <span style="font-weight:800;font-size:1rem;color:var(--white)">${formatCurrency(inv.amount)}</span>
            </td>
            <td style="padding:0.875rem 1.25rem;color:var(--white-40);font-size:0.8125rem;font-family:monospace;white-space:nowrap">${inv.dateSent}</td>
            <td style="padding:0.875rem 1.25rem;font-family:monospace;font-size:0.8125rem;white-space:nowrap;color:${deadlineColor};font-weight:${isOverdue ? '700' : '400'}">
                ${isOverdue ? '<span style="display:inline-flex;align-items:center;gap:0.25rem">âš  ' : ''}${inv.paymentDeadline}${isOverdue ? '</span>' : ''}
            </td>
            <td style="padding:0.875rem 1.25rem">
                <select class="status-badge ${getStatusClass(inv.status)}" 
                        style="appearance:none; cursor:pointer; font-family:inherit; font-size:inherit; font-weight:inherit; text-transform:uppercase; border:none; outline:none; text-align:center; padding-right:1rem;" 
                        onchange="updateInvoiceStatus('${inv.id}', this.value)">
                    <option value="open" ${inv.status.toLowerCase() === 'open' ? 'selected' : ''}>OPEN</option>
                    <option value="betaald" ${inv.status.toLowerCase() === 'betaald' || inv.status.toLowerCase() === 'paid' ? 'selected' : ''}>PAID</option>
                    <option value="te_laat" ${inv.status.toLowerCase() === 'te_laat' || inv.status.toLowerCase() === 'overdue' ? 'selected' : ''}>OVERDUE</option>
                </select>
            </td>
            <td style="padding:0.875rem 1.25rem;text-align:right">
                <div style="display:flex;justify-content:flex-end;gap:0.375rem">
                    <button class="ts-action-btn view" title="View Invoice">
                        <i data-lucide="eye" style="width:13px;height:13px"></i>
                    </button>
                    <button class="ts-action-btn view" title="Download PDF" onclick="downloadInvoicePdf('${inv.id}','${inv.clientName}',${inv.amount})">
                        <i data-lucide="download" style="width:13px;height:13px"></i>
                    </button>
                    ${inv.status.toLowerCase() === 'overdue' || inv.status.toLowerCase() === 'te_laat' || inv.status.toLowerCase() === 'open' ? `
                    <button class="ts-action-btn remind" title="Send Reminder">
                        <i data-lucide="bell" style="width:13px;height:13px"></i>
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
            inv.clientName.toLowerCase().includes(searchText.toLowerCase()) ||
            inv.id.toLowerCase().includes(searchText.toLowerCase());
        const matchStatus = !statusFilter || statusFilter === 'All Statuses' ||
            inv.status.toLowerCase() === statusFilter.toLowerCase();
        return matchText && matchStatus;
    });
    renderInvoicesTable(filtered);
}

function downloadInvoicePdf(id, clientName, amount) {
    const text = `INVOICE ${id.toUpperCase()}\n\nClient: ${clientName}\nAmount: $${amount.toLocaleString()}\nIssued by: Reemo B.V.\nDate: ${new Date().toLocaleDateString()}\n\nPayment due within 30 days of invoice date.\n\nThank you for your business.`;
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
const revenueData = {
    2022: [32000, 29000, 35000, 38000, 41000, 39000, 44000, 47000, 43000, 50000, 52000, 58000],
    2023: [42000, 38000, 45000, 51000, 49000, 55000, 59000, 62000, 57000, 65000, 68000, 74000],
    2024: [55000, 51000, 61000, 58000, 64000, 70000, 67000, 73000, 69000, 78000, 82000, 90000],
    2025: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    2026: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let revenueChart = null;

// Build revenueData from v_revenue_per_maand rows if available.
// Actual Supabase columns: { jaar: 2024, maand: 1, maand_naam: 'Januari', totaal_bedrag: '42425.00', totaal_uren: '493.00', ... }
function buildRevenueDataFromDB(rows) {
    const byYear = {};
    rows.forEach(row => {
        let yr, mon;
        if (row.jaar !== undefined && row.maand !== undefined) {
            // Native numeric columns from the view
            yr  = parseInt(row.jaar);
            mon = parseInt(row.maand) - 1; // DB: 1-based → JS 0-based
        } else {
            // Fallback: try to parse a date string
            const dateStr = row.maand || row.month || row.periode || '';
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return;
            yr  = d.getFullYear();
            mon = d.getMonth();
        }
        const val = parseFloat(row.totaal_bedrag || row.omzet || row.revenue || row.bedrag || 0);
        if (!byYear[yr]) byYear[yr] = new Array(12).fill(0);
        byYear[yr][mon] = val;
    });
    return byYear;
}

function getChartSlice(year, period) {
    const data = revenueData[year] || revenueData[2024];
    if (period === 'q1') return { labels: monthLabels.slice(0,3),  data: data.slice(0,3)  };
    if (period === 'q2') return { labels: monthLabels.slice(3,6),  data: data.slice(3,6)  };
    if (period === 'q3') return { labels: monthLabels.slice(6,9),  data: data.slice(6,9)  };
    if (period === 'q4') return { labels: monthLabels.slice(9,12), data: data.slice(9,12) };
    if (period === '6' ) return { labels: monthLabels.slice(6,12), data: data.slice(6,12) };
    return { labels: monthLabels, data };
}

function renderYearStrip() {
    const strip = document.getElementById('revenue-year-strip');
    if (!strip) return;
    const selectedYear = parseInt(document.getElementById('chart-year')?.value || 2024);
    strip.innerHTML = Object.keys(revenueData).map(yr => {
        const total = revenueData[yr].reduce((a,b) => a+b, 0);
        const isActive = parseInt(yr) === selectedYear;
        return `<div style="padding:0.35rem 0.75rem;border-radius:0.5rem;border:1px solid ${isActive ? 'rgba(37,99,235,0.4)' : '#1e1e1e'};background:${isActive ? 'rgba(37,99,235,0.1)' : 'transparent'};cursor:pointer;transition:all 0.2s" onclick="document.getElementById('chart-year').value='${yr}';updateRevenueChart()">
            <div style="font-size:0.5rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:${isActive ? '#60a5fa' : 'var(--white-30)'}">FY${yr}</div>
            <div style="font-size:0.8125rem;font-weight:800;color:${isActive ? 'var(--white)' : 'var(--white-50)'}">${'€' + (total/1000).toFixed(0) + 'k'}</div>
        </div>`;
    }).join('');
}

function _drawRevenueChart(labels, data) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;
    const revCtx = ctx.getContext('2d');
    const grad = revCtx.createLinearGradient(0, 0, 0, 260);
    grad.addColorStop(0, 'rgba(37,99,235,0.28)');
    grad.addColorStop(1, 'rgba(37,99,235,0)');

    if (revenueChart) {
        revenueChart.data.labels = labels;
        revenueChart.data.datasets[0].data = data;
        revenueChart.update();
        return;
    }

    revenueChart = new Chart(revCtx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Revenue',
                data,
                borderColor: '#3b82f6',
                borderWidth: 2.5,
                backgroundColor: grad,
                fill: true,
                tension: 0.45,
                pointRadius: 3,
                pointBackgroundColor: '#3b82f6',
                pointBorderColor: '#0a0a0a',
                pointBorderWidth: 2,
                pointHoverRadius: 7,
            }]
        },
        options: {
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
                    displayColors: false,
                    callbacks: {
                        label: c => '€' + c.parsed.y.toLocaleString()
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { color: 'rgba(255,255,255,0.35)', font: { size: 11 } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)', borderDash: [3,3] },
                    border: { display: false },
                    ticks: {
                        color: 'rgba(255,255,255,0.3)',
                        font: { size: 11 },
                        callback: v => '€' + (v/1000).toFixed(0) + 'k'
                    }
                }
            }
        }
    });
}

function updateRevenueChart() {
    const year   = parseInt(document.getElementById('chart-year')?.value || 2024);
    const period = document.getElementById('chart-period')?.value || 'all';
    const { labels, data } = getChartSlice(year, period);
    renderYearStrip();
    _drawRevenueChart(labels, data);
}

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
    Chart.defaults.color = 'rgba(255,255,255,0.4)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    // ── Revenue Overview: try live DB first ───────────────────────────────────
    const revenueRows = await apiFetchSafe('/api/revenue-per-maand');
    if (revenueRows && revenueRows.length > 0) {
        const dbData = buildRevenueDataFromDB(revenueRows);
        if (Object.keys(dbData).length > 0) {
            // Merge live data into revenueData so year strip also updates
            Object.assign(revenueData, dbData);
            console.log('[Charts] Revenue data loaded from Supabase ✓');
        }
    }
    
    // Build year selector from ALL available years (fallback + DB), select current year
    const yearSelect = document.getElementById('chart-year');
    if (yearSelect) {
        const currentYear = new Date().getFullYear();
        const allYears = Object.keys(revenueData).map(Number).sort((a,b) => b - a);
        yearSelect.innerHTML = allYears.map(y =>
            `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`
        ).join('');
    }
    updateRevenueChart();

    // ── Hours per Client: try live DB first ───────────────────────────────────
    const hoursRows = await apiFetch('/api/uren-per-klant');
    if (hoursRows && hoursRows.length > 0) {
        // Detect column names flexibly
        const first = hoursRows[0];
        const nameKey  = Object.keys(first).find(k => /klant|client|naam|name/i.test(k)) || Object.keys(first)[0];
        const hoursKey = Object.keys(first).find(k => /uren|hours|uur/i.test(k))  || Object.keys(first)[1];
        const labels = hoursRows.map(r => r[nameKey]);
        const data   = hoursRows.map(r => parseFloat(r[hoursKey]) || 0);
        _drawHoursChart(labels, data);
        console.log('[Charts] Hours-per-client data loaded from Supabase ✓');
    } else {
        // Fallback mock
        _drawHoursChart(
            ['Acme Corp', 'Initech', 'Soylent Corp', 'Globex', 'Umbrella Corp'],
            [640, 800, 480, 320, 160]
        );
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
        'modal-client-form','modal-project-form','modal-factuur-form'
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
                uurtarief: rate, weekcapaciteit: 40
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
        const matchText = !searchText ||
            d.name.toLowerCase().includes(searchText.toLowerCase()) ||
            (d.role||'').toLowerCase().includes(searchText.toLowerCase());
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

// ===== TOAST NOTIFICATION =====
function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
        position:'fixed', bottom:'1.5rem', right:'1.5rem', zIndex:'9999',
        background:'#111', border:'1px solid rgba(16,185,129,0.3)',
        color:'#34d399', padding:'0.75rem 1.25rem', borderRadius:'0.75rem',
        fontSize:'0.875rem', fontWeight:'700', boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
        transition:'opacity 0.5s', opacity:'1'
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 3000);
}

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
                e.projectName.toLowerCase().includes(searchText) ||
                (e.description || '').toLowerCase().includes(searchText);
            const matchStatus = !statusFilter || e.status === statusFilter;
            return matchText && matchStatus;
        });
    }

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:2.5rem;text-align:center;color:var(--white-30);font-size:0.875rem">No entries found</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(entry => {
        const isPending  = entry.status.toLowerCase() === 'pending';
        const isApproved = entry.status.toLowerCase() === 'approved';
        const statusStyle = isPending
            ? 'background:rgba(245,158,11,0.1);color:#fbbf24;border:1px solid rgba(245,158,11,0.2)'
            : isApproved
            ? 'background:rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2)'
            : 'background:rgba(244,63,94,0.1);color:#fb7185;border:1px solid rgba(244,63,94,0.2)';
        
        const isOvertime = entry.description.includes('[OVERTIME]');
        const typeStr = isOvertime ? 'Overtime' : 'Regular';
        const typeColor = isOvertime ? '#fbbf24' : 'var(--white-50)';

        return `
        <tr class="ts-row" title="${entry.description}">
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
    const currentDevId = developers[0]?.id;
    const devTs = timesheets.filter(t => t.developer_id === currentDevId);
    
    const thisWeek = devTs.reduce((s, e) => s + (parseFloat(e.hoursWorked)||0), 0);
    const approved = devTs.filter(e => e.status.toLowerCase() === 'approved').reduce((s, e) => s + (parseFloat(e.hoursWorked)||0), 0);
    const pending  = devTs.filter(e => e.status.toLowerCase() === 'pending').reduce((s, e) => s + (parseFloat(e.hoursWorked)||0), 0);
    
    if (document.getElementById('dev-ts-week'))     document.getElementById('dev-ts-week').textContent     = thisWeek + 'h';
    if (document.getElementById('dev-ts-approved')) document.getElementById('dev-ts-approved').textContent = approved + 'h';
    if (document.getElementById('dev-ts-pending'))  document.getElementById('dev-ts-pending').textContent  = pending + 'h';
    
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const earnings = devTs
        .filter(e => e.status.toLowerCase() === 'approved')
        .filter(e => {
            if (!e.date) return false;
            const d = new Date(e.date);
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
                if (oldTs && oldTs.status.toLowerCase() !== newTs.status.toLowerCase()) {
                    statusChanged = true;
                    if (newTs.status.toLowerCase() === 'approved') approvedCount++;
                    if (newTs.status.toLowerCase() === 'rejected') rejectedCount++;
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

async function submitDevTimesheet() {
    // Guard: need at least 1 developer
    if (developers.length === 0) {
        showToast('⚠ Geen developer gevonden. Log opnieuw in.');
        return;
    }

    const date       = document.getElementById('dev-ts-date')?.value;
    const project_id = document.getElementById('dev-ts-project')?.value;
    const hours      = parseFloat(document.getElementById('dev-ts-hours')?.value);
    const type       = document.getElementById('dev-ts-type')?.value || 'Regular';
    let desc         = document.getElementById('dev-ts-desc')?.value?.trim() || '';

    if (!date || !project_id || !hours || hours < 0.5) {
        showToast('⚠ Vul Datum, Project en Uren in.');
        return;
    }

    if (type === 'Overtime') {
        desc = `[OVERTIME] ${desc}`;
    }

    // Use the first developer as the logged-in developer (placeholder until auth is added)
    const developer_id = developers[0]?.id;
    if (!developer_id) { showToast('⚠ Geen developer gevonden.'); return; }
    
    const uurtarief = developers[0]?.hourlyRate || 0;
    const bedrag = hours * uurtarief;

    try {
        await apiFetch('/api/timesheets', {
            method: 'POST',
            body: JSON.stringify({ developer_id, project_id, datum: date, aantal_uren: hours, bedrag, omschrijving: desc || null })
        });

        // Reset form
        document.getElementById('dev-ts-date').value  = '';
        document.getElementById('dev-ts-hours').value = '';
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
let devDocuments = _ls_load('reemo_dev_docs', _DEF_DEV_DOCS);
function saveDevDocs() { _ls_save('reemo_dev_docs', devDocuments); }

const typeColors = {
    'CV':       'rgba(37,99,235,0.1);color:#60a5fa;border:1px solid rgba(37,99,235,0.2)',
    'NDA':      'rgba(245,158,11,0.1);color:#fbbf24;border:1px solid rgba(245,158,11,0.2)',
    'Contract': 'rgba(99,102,241,0.1);color:#a5b4fc;border:1px solid rgba(99,102,241,0.2)',
    'Finance':  'rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2)',
    'Other':    'rgba(255,255,255,0.06);color:var(--white-60);border:1px solid rgba(255,255,255,0.1)',
};

function renderDevDocuments() {
    const tbody = document.getElementById('dev-docs-body');
    if (!tbody) return;

    if (devDocuments.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding:2rem;text-align:center;color:var(--white-30);font-size:0.875rem">No documents yet</td></tr>`;
        return;
    }

    tbody.innerHTML = devDocuments.map(doc => {
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
}

function updateDocTotal() {
    const el = document.getElementById('doc-total');
    if (el) el.textContent = devDocuments.length;
}

function triggerDocUpload(hint) {
    document.getElementById('doc-file-input')?.click();
}

function handleDocUpload(input) {
    const file = input.files[0];
    if (!file) return;
    const ext = file.name.split('.').pop().toUpperCase();
    devDocuments.unshift({
        id: genId('doc'),
        name: file.name, type: 'Other',
        date: new Date().toISOString().slice(0,10),
        size: (file.size/1024/1024).toFixed(1)+' MB',
        icon: 'file', color: 'var(--white-50)'
    });
    saveDevDocs();
    input.value = '';
    renderDevDocuments();
    showToast(`✓ "${file.name}" uploaded!`);
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
    const text = `CURRICULUM VITAE\n\nName: Alex Rivera\nRole: Senior Frontend Developer\nManaged by: Reemo B.V.\nDate: ${new Date().toLocaleDateString()}\n\n[Full CV on file — Reemo Format]`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'Alex_Rivera_CV.txt';
    a.click(); URL.revokeObjectURL(url);
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
    if (_cvParsedSkills.length === 0) {
        container.innerHTML = '<span style="font-size:0.8125rem;color:var(--white-30)">Geen skills herkend — voeg ze handmatig toe</span>';
        return;
    }
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
                    uurtarief: rate, weekcapaciteit: weekcap
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

        const wasUpdated = result?.upserted === true;

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
        };
        if (existingIdx >= 0) cvs[existingIdx] = cvEntry;
        else cvs.unshift(cvEntry);
        saveCVs();

        closeModal('modal-cv-upload');
        resetCVUpload();

        // Refresh data and navigate to Developers page
        await loadDevelopers();
        navigateTo('developers');
        renderDevelopersGrid();
        renderDashboardStats();

        const msg = wasUpdated
            ? `✓ Developer "${naam}" bijgewerkt (email bestond al).`
            : `✓ ${naam} toegevoegd als developer!`;
        showToast(msg);

    } catch (e) {
        showToast(`⚠ ${e.message}`);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="user-plus" style="width:14px;height:14px"></i> Opslaan als Developer'; if(typeof lucide!=='undefined') lucide.createIcons(); }
    }
}

// Save only to CV Database (not as developer in DB) — tagged "Nog niet actief"
function saveParsedCVDatabase() {
    const naam  = document.getElementById('cv-r-name')?.value.trim();
    const rol   = document.getElementById('cv-r-role')?.value.trim() || null;
    const rate  = parseFloat(document.getElementById('cv-r-rate')?.value) || null;
    const email = document.getElementById('cv-r-email')?.value.trim() || null;

    if (!naam) { showToast('⚠ Naam is verplicht.'); return; }

    // Check for duplicate by email
    const existingIdx = email ? cvs.findIndex(c => c.email === email) : -1;
    const cvEntry = {
        id: existingIdx >= 0 ? cvs[existingIdx].id : genId('cv'),
        name: naam, email, role: rol, rate,
        skills: [..._cvParsedSkills],
        uploadDate: new Date().toISOString().slice(0, 10),
        status: 'ORIGINAL',
        active: false,
        savedFilename: _cvSavedFilename,
        originalName:  _cvOriginalName,
    };
    if (existingIdx >= 0) cvs[existingIdx] = cvEntry;
    else cvs.unshift(cvEntry);
    saveCVs();

    closeModal('modal-cv-upload');
    resetCVUpload();
    renderCVDatabase();
    updateCVStats();
    showToast(`✓ CV van ${naam} opgeslagen — gemarkeerd als "Nog niet actief".`);
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
                    naam: cv.name, email: cv.email,
                    rol: cv.role || null, type: 'ZZP',
                    uurtarief: cv.rate || null, weekcapaciteit: 40
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
        const wasUpdated = result?.upserted === true;
        // Mark CV as active in local store
        const idx = cvs.findIndex(c => c.id === cvId);
        if (idx >= 0) cvs[idx] = { ...cv, active: true };
        saveCVs();
        renderCVDatabase();
        await loadDevelopers();
        renderDashboardStats();
        showToast(wasUpdated
            ? `✓ Developer "${cv.name}" bijgewerkt.`
            : `✓ ${cv.name} geactiveerd als developer!`);
    } catch (e) {
        showToast(`⚠ ${e.message}`);
    }
}
