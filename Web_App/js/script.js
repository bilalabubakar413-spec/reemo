// --- Mock Data ---
const clients = [
    { id: 'c1', name: 'Acme Corp', developersCount: 4, totalHoursMonth: 640, invoiceStatus: 'Paid', industry: 'E-commerce', contactPerson: 'John Doe', email: 'john@acme.com' },
    { id: 'c2', name: 'Globex', developersCount: 2, totalHoursMonth: 320, invoiceStatus: 'Open', industry: 'Fintech', contactPerson: 'Jane Smith', email: 'jane@globex.com' },
    { id: 'c3', name: 'Soylent Corp', developersCount: 3, totalHoursMonth: 480, invoiceStatus: 'Overdue', industry: 'Health', contactPerson: 'Bob Brown', email: 'bob@soylent.com' },
    { id: 'c4', name: 'Initech', developersCount: 5, totalHoursMonth: 800, invoiceStatus: 'Paid', industry: 'Software', contactPerson: 'Bill Lumbergh', email: 'bill@initech.com' },
    { id: 'c5', name: 'Umbrella Corp', developersCount: 1, totalHoursMonth: 160, invoiceStatus: 'Open', industry: 'Biotech', contactPerson: 'Albert Wesker', email: 'albert@umbrella.com' },
];

const developers = [
    { id: 'd1', name: 'Alex Rivera', activeProjects: 2, hoursThisWeek: 38, hourlyRate: 85, role: 'Senior Frontend', email: 'alex@reemo.io' },
    { id: 'd2', name: 'Sarah Chen', activeProjects: 1, hoursThisWeek: 40, hourlyRate: 95, role: 'Fullstack Engineer', email: 'sarah@reemo.io' },
    { id: 'd3', name: 'Marcus Thorne', activeProjects: 1, hoursThisWeek: 35, hourlyRate: 75, role: 'Backend Developer', email: 'marcus@reemo.io' },
    { id: 'd4', name: 'Elena Vance', activeProjects: 3, hoursThisWeek: 42, hourlyRate: 110, role: 'DevOps Architect', email: 'elena@reemo.io' },
    { id: 'd5', name: 'Jordan Smith', activeProjects: 1, hoursThisWeek: 40, hourlyRate: 65, role: 'Junior Developer', email: 'jordan@reemo.io' },
];

const timesheets = [
    { id: 't1', developerName: 'Alex Rivera', clientName: 'Acme Corp', hoursWorked: 40, status: 'Approved', date: '2024-03-10', description: 'Developed new checkout flow' },
    { id: 't2', developerName: 'Sarah Chen', clientName: 'Globex', hoursWorked: 38, status: 'Pending', date: '2024-03-11', description: 'API integration for payment gateway' },
    { id: 't3', developerName: 'Marcus Thorne', clientName: 'Soylent Corp', hoursWorked: 40, status: 'Approved', date: '2024-03-12', description: 'Database optimization' },
    { id: 't4', developerName: 'Elena Vance', clientName: 'Acme Corp', hoursWorked: 42, status: 'Rejected', date: '2024-03-13', description: 'Infrastructure setup' },
];

const cvs = [
    { id: 'cv1', name: 'Thomas Anderson', skills: ['React', 'Node.js', 'TypeScript'], uploadDate: '2024-03-20', status: 'ORIGINAL' },
    { id: 'cv2', name: 'Trinity Knight', skills: ['Python', 'Django', 'AWS'], uploadDate: '2024-03-21', status: 'REEMO FORMAT' },
    { id: 'cv3', name: 'Morpheus Dream', skills: ['Kubernetes', 'Docker', 'Go'], uploadDate: '2024-03-22', status: 'ORIGINAL' },
    { id: 'cv4', name: 'Niobe Captain', skills: ['Java', 'Spring Boot', 'SQL'], uploadDate: '2024-03-23', status: 'REEMO FORMAT' },
    { id: 'cv5', name: 'Cypher Traitor', skills: ['PHP', 'Laravel', 'Vue.js'], uploadDate: '2024-03-24', status: 'ORIGINAL' },
];

const invoices = [
    { id: 'i1', clientName: 'Acme Corp', amount: 12500, status: 'Paid', dateSent: '2024-02-28', paymentDeadline: '2024-03-15' },
    { id: 'i2', clientName: 'Globex', amount: 8400, status: 'Open', dateSent: '2024-03-01', paymentDeadline: '2024-03-15' },
    { id: 'i3', clientName: 'Soylent Corp', amount: 15000, status: 'Overdue', dateSent: '2024-02-15', paymentDeadline: '2024-03-01' },
];

// --- Utility Functions ---
function getInitials(name) {
    return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
}

function getStatusClass(status) {
    status = status.toLowerCase();
    if (status === 'approved' || status === 'paid') return 'status-approved';
    if (status === 'pending' || status === 'open') return 'status-pending';
    if (status === 'rejected' || status === 'overdue') return 'status-rejected';
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
document.addEventListener('DOMContentLoaded', () => {
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

    // Render Initial Data
    renderDashboardStats();
    renderDashboardTimesheets();
    renderClientsGrid();
    renderDevelopersGrid();
    renderTimesheetsTable();
    renderInvoicesTable();
    renderCVDatabase();
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

    if (role === 'developer') {
        navAdminItems.classList.add('hidden');
        navDevItems.classList.remove('hidden');
        userProfileAvatar.textContent = 'A';
        userProfileAvatar.className = 'w-8 h-8 rounded-full bg-emerald-900 text-emerald-400 font-bold flex items-center justify-center shrink-0';
        userProfileName.innerHTML = `<p class="text-sm font-medium truncate">Alex Rivera</p><p class="text-[10px] text-emerald-500 truncate">Developer</p>`;
        navigateTo('dev-dashboard');
    } else {
        navDevItems.classList.add('hidden');
        navAdminItems.classList.remove('hidden');
        userProfileAvatar.textContent = 'T';
        userProfileAvatar.className = 'avatar-small';
        userProfileName.innerHTML = `<p class="text-sm font-medium truncate">Test</p><p class="text-[10px] text-white-40 truncate">Admin</p>`;
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
    if (targetScreenId === 'dev-timesheets') {
        renderDevTimesheets();
        updateDevTsStats();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
    if (targetScreenId === 'dev-documents') {
        renderDevDocuments();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

// --- Renderers ---

function renderDashboardStats() {
    const statsContainer = document.getElementById('dashboard-stats');
    const stats = [
        { label: 'Active Clients', value: '12', trend: '+2', icon: 'users', color: 'text-blue-400', bgLine: 'bg-blue-500-10' },
        { label: 'Developers', value: '48', trend: '+5', icon: 'user-circle', color: 'text-emerald-400', bgLine: 'bg-emerald-500-10' },
        { label: 'Hours Registered', value: '2,450', trend: '+12%', icon: 'clock', color: 'text-amber-400', bgLine: 'bg-amber-500-10' },
        { label: 'Revenue (MTD)', value: '$72,400', trend: '+8.4%', icon: 'arrow-up-right', color: 'text-blue-400', bgLine: 'bg-blue-500-10' },
        { label: 'Open Invoices', value: '8', trend: '-2', icon: 'file-text', color: 'text-rose-400', bgLine: 'bg-rose-500-10' },
    ];

    statsContainer.innerHTML = stats.map((stat, i) => `
        <div class="card card-hover-border border" style="animation: fadeIn 0.3s ease-out ${i * 0.05}s both;">
            <div class="flex justify-between items-start mb-4">
                <div class="p-2 rounded-xl border border-white-5 ${stat.color} ${stat.bgLine}">
                    <i data-lucide="${stat.icon}" class="w-5 h-5"></i>
                </div>
                <span class="text-xs font-medium px-2 py-1 rounded-full ${stat.trend.startsWith('+') ? 'text-emerald-400 bg-emerald-500-10' : 'text-rose-400 bg-rose-500-10'}">
                    ${stat.trend}
                </span>
            </div>
            <p class="text-white-40 text-sm font-medium">${stat.label}</p>
            <p class="text-2xl font-bold mt-1 text-white">${stat.value}</p>
        </div>
    `).join('');
    lucide.createIcons({ root: statsContainer });
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

// --- Rendering Functions ---
function renderClientsGrid() {
    const clientsGrid = document.getElementById('clients-grid');
    if (!clientsGrid) return;
    
    clientsGrid.innerHTML = clients.map(client => {
        const statusClass = getStatusClass(client.invoiceStatus);
        const hasLogo = !!clientLogos[client.id];
        return `
        <div class="client-card" onclick="openClientDetails('${client.id}')">
            <div class="client-card-actions">
                <span class="status-badge ${statusClass}">${client.invoiceStatus}</span>
                <button class="client-card-btn upload" title="Upload Logo" onclick="event.stopPropagation(); uploadClientLogo('${client.id}')">
                    <i data-lucide="image" style="width:13px;height:13px"></i>
                </button>
                <button class="client-card-btn download" title="Download Contract" onclick="event.stopPropagation(); downloadContract('${client.id}','${client.name}')">
                    <i data-lucide="download" style="width:13px;height:13px"></i>
                </button>
            </div>

            <div class="client-card-header">
                <div class="client-logo ${hasLogo ? 'has-image' : ''}" id="logo-${client.id}">
                    <span class="logo-initials">${getInitials(client.name)}</span>
                    ${hasLogo ? `<img class="has-image" src="${clientLogos[client.id]}" alt="${client.name} logo">` : '<img alt="logo">'}
                </div>
                <div style="min-width:0;flex:1">
                    <div class="client-card-name">${client.name}</div>
                    <div class="client-card-meta">${client.industry} &bull; ${client.contactPerson}</div>
                </div>
            </div>

            <div class="client-stat-grid">
                <div class="client-stat-box">
                    <div class="client-stat-label">
                        <i data-lucide="users" style="width:10px;height:10px;color:#60a5fa"></i>
                        Developers
                    </div>
                    <div class="client-stat-value">${client.developersCount}</div>
                </div>
                <div class="client-stat-box">
                    <div class="client-stat-label">
                        <i data-lucide="clock" style="width:10px;height:10px;color:#34d399"></i>
                        Monthly Hours
                    </div>
                    <div class="client-stat-value">${client.totalHoursMonth}h</div>
                </div>
            </div>
        </div>
        `;
    }).join('');
    
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function uploadClientLogo(clientId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            clientLogos[clientId] = ev.target.result;
            renderClientsGrid(); // re-render to show new logo
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

function downloadContract(clientId, clientName) {
    // Generate a simple text contract as a downloadable file
    const contractText = `SERVICE AGREEMENT\n\nClient: ${clientName}\nDate: ${new Date().toLocaleDateString()}\n\nThis Service Agreement ("Agreement") is entered into between Reemo B.V. ("Service Provider") and ${clientName} ("Client").\n\nSCOPE OF SERVICES\nThe Service Provider will provide software development services as mutually agreed upon.\n\nPAYMENT TERMS\nPayment is due within 30 days of invoice date.\n\nSIGNATURE\n\nService Provider: ____________________   Date: ________\nClient: ____________________           Date: ________`;
    const blob = new Blob([contractText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reemo_Contract_${clientName.replace(/\s+/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function openClientDetails(clientId) {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    
    document.getElementById('detail-client-name').textContent = client.name;
    document.getElementById('detail-client-industry').textContent = `${client.industry} â€¢ ${client.developersCount} Active Developers`;
    document.getElementById('detail-client-logo').textContent = client.name.charAt(0);

    // Switch screen manually since it's a detail view inside the Clients flow
    screenContents.forEach(screen => screen.classList.remove('active'));
    document.getElementById('screen-client-details').classList.add('active');
}

// Add back button listener manually
document.addEventListener('DOMContentLoaded', () => {
    const backBtn = document.getElementById('btn-back-to-clients');
    if (backBtn) {
        backBtn.addEventListener('click', () => navigateTo('clients'));
    }
});

function renderDevelopersGrid() {
    const container = document.getElementById('developers-grid');
    if (!container) return;
    
    container.innerHTML = developers.map((dev, i) => {
        const capacityPct = Math.min((dev.hoursThisWeek / 40) * 100, 100);
        const capacityColor = dev.hoursThisWeek >= 40 ? '#f43f5e' : (dev.hoursThisWeek > 30 ? '#f59e0b' : '#3b82f6');
        const isFemale = ['Sarah', 'Elena', 'Niobe', 'Trinity'].some(n => dev.name.includes(n));
        const avatarClass = isFemale ? 'female' : 'male';
        const isBooked = dev.activeProjects > 0;
        
        return `
        <div class="dev-card" style="animation: fadeIn 0.3s ease-out ${i * 0.1}s both;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div style="display:flex;align-items:center;gap:0.75rem;min-width:0;flex:1">
                    <div class="dev-avatar ${avatarClass}">${getInitials(dev.name)}</div>
                    <div style="min-width:0;flex:1">
                        <div style="font-weight:700;font-size:0.9375rem;color:var(--white);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${dev.name}</div>
                        <div style="font-size:0.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--white-40);margin-top:0.15rem">${dev.role}</div>
                    </div>
                </div>
                <button class="client-card-btn" style="flex-shrink:0;margin-left:0.5rem" title="View CV">
                    <i data-lucide="file-text" style="width:13px;height:13px"></i>
                </button>
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
                <div class="dev-inner-box">
                    <div class="dev-inner-label"><i data-lucide="layout-grid" style="width:10px;height:10px"></i> Projects</div>
                    <div style="font-weight:700;font-size:1rem;color:var(--white)">${dev.activeProjects}</div>
                </div>
                <div class="dev-inner-box">
                    <div class="dev-inner-label"><i data-lucide="dollar-sign" style="width:10px;height:10px"></i> Rate</div>
                    <div style="font-weight:700;font-size:1rem;color:var(--white)">$${dev.hourlyRate}/h</div>
                </div>
            </div>

            <div>
                <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:0.5rem">
                    <span style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:var(--white-40)">Weekly Capacity</span>
                    <span style="font-size:0.7rem;font-weight:700;color:${capacityColor}">${dev.hoursThisWeek} <span style="color:var(--white-30)">/ 40H</span></span>
                </div>
                <div class="capacity-bar-track">
                    <div class="capacity-bar-fill" style="width:${capacityPct}%;background-color:${capacityColor};box-shadow:0 0 8px ${capacityColor}88"></div>
                </div>
            </div>

            <button class="dev-view-btn">View Profile</button>
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
                    ${canApprove ? `<button class="ts-action-btn approve" title="Approve" onclick="approveTimesheet('${ts.id}')">
                        <i data-lucide="check" style="width:13px;height:13px"></i>
                    </button>` : ''}
                    ${canReject ? `<button class="ts-action-btn reject" title="Reject" onclick="rejectTimesheet('${ts.id}')">
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

function approveTimesheet(id) {
    timesheetStatuses[id] = 'Approved';
    renderTimesheetsTable(
        document.getElementById('ts-search')?.value || '',
        document.getElementById('ts-status-filter')?.value || ''
    );
}

function rejectTimesheet(id) {
    timesheetStatuses[id] = 'Rejected';
    renderTimesheetsTable(
        document.getElementById('ts-search')?.value || '',
        document.getElementById('ts-status-filter')?.value || ''
    );
}

function updateTimesheetSummary() {
    const all = timesheets.map(ts => ({ ...ts, status: timesheetStatuses[ts.id] || ts.status }));
    const pending  = all.filter(ts => ts.status === 'Pending').length;
    const approved = all.filter(ts => ts.status === 'Approved').length;
    const rejected = all.filter(ts => ts.status === 'Rejected').length;
    const totalHrs = all.reduce((s, ts) => s + ts.hoursWorked, 0);
    const el = id => document.getElementById(id);
    if (el('ts-stat-pending'))  el('ts-stat-pending').textContent  = pending;
    if (el('ts-stat-approved')) el('ts-stat-approved').textContent = approved;
    if (el('ts-stat-rejected')) el('ts-stat-rejected').textContent = rejected;
    if (el('ts-stat-hours'))    el('ts-stat-hours').textContent    = totalHrs + 'h';
}



function renderCVDatabase(data) {
    const tbody = document.getElementById('cvs-body');
    if (!tbody) return;
    const rows = data || cvs;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="padding:3rem;text-align:center;color:var(--white-30);font-size:0.875rem">No CVs found</td></tr>`;
        return;
    }

    const isFemale = name => ['Trinity','Niobe','Sarah','Elena'].some(n => name.includes(n));

    tbody.innerHTML = rows.map((cv, i) => {
        const isOriginal = cv.status === 'ORIGINAL';
        const avatarBg = isFemale(cv.name)
            ? 'background:rgba(236,72,153,0.12);border:1px solid rgba(236,72,153,0.25);color:#f9a8d4'
            : 'background:rgba(37,99,235,0.12);border:1px solid rgba(37,99,235,0.25);color:#60a5fa';
        const statusBg = isOriginal
            ? 'background:rgba(255,255,255,0.06);color:var(--white-60);border:1px solid rgba(255,255,255,0.08)'
            : 'background:rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2)';

        return `
        <tr class="ts-row" style="animation:fadeIn 0.2s ease-out ${i*0.05}s both">
            <td style="padding:0.875rem 1.25rem">
                <div style="display:flex;align-items:center;gap:0.75rem">
                    <div style="width:2.25rem;height:2.25rem;border-radius:0.625rem;${avatarBg};display:flex;align-items:center;justify-content:center;font-size:0.625rem;font-weight:800;flex-shrink:0">${getInitials(cv.name)}</div>
                    <div>
                        <div style="font-weight:700;color:var(--white);font-size:0.8875rem">${cv.name}</div>
                    </div>
                </div>
            </td>
            <td style="padding:0.875rem 1.25rem">
                <div style="display:flex;flex-wrap:wrap;gap:0.3rem">
                    ${cv.skills.map(s => `<span style="padding:0.2rem 0.5rem;border-radius:0.375rem;background:rgba(255,255,255,0.06);color:var(--white-60);font-size:0.625rem;font-weight:600;border:1px solid rgba(255,255,255,0.08);white-space:nowrap">${s}</span>`).join('')}
                </div>
            </td>
            <td style="padding:0.875rem 1.25rem;color:var(--white-40);font-family:monospace;font-size:0.8125rem;white-space:nowrap">${cv.uploadDate}</td>
            <td style="padding:0.875rem 1.25rem">
                <span style="display:inline-block;padding:0.25rem 0.625rem;border-radius:0.375rem;font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;${statusBg}">${cv.status}</span>
            </td>
            <td style="padding:0.875rem 1.25rem;text-align:right">
                <div style="display:flex;justify-content:flex-end;gap:0.375rem">
                    <button class="ts-action-btn view" title="Download CV" onclick="downloadCV('${cv.name}')">
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
        cvs.push({ id: 'cv' + (cvs.length+1), name, skills: ['To be reviewed'], uploadDate: new Date().toISOString().slice(0,10), status: 'ORIGINAL' });
        renderCVDatabase();
        alert(`✓ CV "${name}" uploaded successfully!`);
    };
    input.click();
}

function downloadCV(name) {
    const text = `CURRICULUM VITAE\n\nName: ${name}\nManaged by: Reemo B.V.\nDate: ${new Date().toLocaleDateString()}\n\n[Full CV on file]`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `CV_${name.replace(/\s+/g,'_')}.txt`;
    a.click(); URL.revokeObjectURL(url);
}

function convertToReemo(id) {
    const cv = cvs.find(c => c.id === id);
    if (cv) { cv.status = 'REEMO FORMAT'; renderCVDatabase(); }
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
        const isOverdue = inv.status === 'Overdue';
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
                <span class="status-badge ${getStatusClass(inv.status)}">${inv.status}</span>
            </td>
            <td style="padding:0.875rem 1.25rem;text-align:right">
                <div style="display:flex;justify-content:flex-end;gap:0.375rem">
                    <button class="ts-action-btn view" title="View Invoice">
                        <i data-lucide="eye" style="width:13px;height:13px"></i>
                    </button>
                    <button class="ts-action-btn view" title="Download PDF" onclick="downloadInvoicePdf('${inv.id}','${inv.clientName}',${inv.amount})">
                        <i data-lucide="download" style="width:13px;height:13px"></i>
                    </button>
                    ${inv.status === 'Overdue' || inv.status === 'Open' ? `
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

// Multi-year monthly revenue data
const revenueData = {
    2022: [32000, 29000, 35000, 38000, 41000, 39000, 44000, 47000, 43000, 50000, 52000, 58000],
    2023: [42000, 38000, 45000, 51000, 49000, 55000, 59000, 62000, 57000, 65000, 68000, 74000],
    2024: [55000, 51000, 61000, 58000, 64000, 70000, 67000, 73000, 69000, 78000, 82000, 90000],
};
const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let revenueChart = null;

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
            <div style="font-size:0.8125rem;font-weight:800;color:${isActive ? 'var(--white)' : 'var(--white-50)'}">${'$' + (total/1000).toFixed(0) + 'k'}</div>
        </div>`;
    }).join('');
}

function updateRevenueChart() {
    const year   = parseInt(document.getElementById('chart-year')?.value || 2024);
    const period = document.getElementById('chart-period')?.value || 'all';
    const { labels, data } = getChartSlice(year, period);
    renderYearStrip();

    if (revenueChart) {
        revenueChart.data.labels = labels;
        revenueChart.data.datasets[0].data = data;
        revenueChart.update();
        return;
    }

    const ctx = document.getElementById('revenueChart');
    if (!ctx) return;
    const revCtx = ctx.getContext('2d');
    const grad = revCtx.createLinearGradient(0, 0, 0, 260);
    grad.addColorStop(0, 'rgba(37,99,235,0.28)');
    grad.addColorStop(1, 'rgba(37,99,235,0)');

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
                        label: ctx => '$' + ctx.parsed.y.toLocaleString()
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
                        callback: v => '$' + (v/1000).toFixed(0) + 'k'
                    }
                }
            }
        }
    });
}

function initCharts() {
    Chart.defaults.color = 'rgba(255,255,255,0.4)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    updateRevenueChart();

    // Hours per Client horizontal bar chart
    const hoursCtx = document.getElementById('hoursChart');
    if (!hoursCtx) return;
    new Chart(hoursCtx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Acme Corp', 'Initech', 'Soylent Corp', 'Globex', 'Umbrella Corp'],
            datasets: [{
                label: 'Hours',
                data: [640, 800, 480, 320, 160],
                backgroundColor: ['#2563eb','#3b82f6','#60a5fa','#93c5fd','#bfdbfe'],
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
// Close on overlay click
document.addEventListener('click', e => {
    ['modal-onboard','modal-adv-filter'].forEach(id => {
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

function submitOnboard() {
    const first  = document.getElementById('ob-firstname')?.value.trim();
    const last   = document.getElementById('ob-lastname')?.value.trim();
    const email  = document.getElementById('ob-email')?.value.trim();
    const role   = document.getElementById('ob-role')?.value;
    const rate   = parseInt(document.getElementById('ob-rate')?.value) || 70;

    if (!first || !last || !email) {
        alert('Please fill in Name and Email before continuing.');
        return;
    }

    const newDev = {
        id: 'd' + (developers.length + 1),
        name: first + ' ' + last,
        email,
        role,
        hourlyRate: rate,
        activeProjects: 0,
        hoursThisWeek: 0,
    };

    developers.push(newDev);
    closeModal('modal-onboard');
    renderDeveloperCards();

    // Toast-style notification
    showToast(`✓ ${newDev.name} has been onboarded!`);
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
    renderDeveloperCards();
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
    // Temporarily replace developers and re-render
    const original = developers;
    const _dev = developers;
    developers = data;
    renderDeveloperCards();
    developers = _dev;
}

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
const devTimesheetEntries = [
    { id: 'dt1', date: '2024-03-22', project: 'Acme Corp — Checkout Redesign', hours: 8,   type: 'Regular',  status: 'Pending',  desc: 'Implemented checkout flow components' },
    { id: 'dt2', date: '2024-03-21', project: 'Acme Corp — Checkout Redesign', hours: 8,   type: 'Regular',  status: 'Approved', desc: 'Cart state management & API integration' },
    { id: 'dt3', date: '2024-03-20', project: 'Acme Corp — Checkout Redesign', hours: 8,   type: 'Regular',  status: 'Approved', desc: 'Unit tests for payment module' },
    { id: 'dt4', date: '2024-03-19', project: 'Globex — API Integration',      hours: 4.5, type: 'Overtime', status: 'Pending',  desc: 'Debugging webhook endpoints' },
    { id: 'dt5', date: '2024-03-18', project: 'Internal — R&D',                hours: 6,   type: 'Regular',  status: 'Approved', desc: 'Architecture review & documentation' },
];

function renderDevTimesheets(data) {
    const tbody = document.getElementById('dev-ts-body');
    if (!tbody) return;
    const rows = data || devTimesheetEntries;

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding:2.5rem;text-align:center;color:var(--white-30);font-size:0.875rem">No entries found</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(entry => {
        const d = new Date(entry.date);
        const dateStr = d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
        const isPending  = entry.status === 'Pending';
        const isApproved = entry.status === 'Approved';
        const statusStyle = isPending
            ? 'background:rgba(245,158,11,0.1);color:#fbbf24;border:1px solid rgba(245,158,11,0.2)'
            : isApproved
            ? 'background:rgba(16,185,129,0.1);color:#34d399;border:1px solid rgba(16,185,129,0.2)'
            : 'background:rgba(244,63,94,0.1);color:#fb7185;border:1px solid rgba(244,63,94,0.2)';
        const typeColor = entry.type === 'Overtime' ? '#fbbf24' : entry.type === 'On-Call' ? '#a5b4fc' : 'var(--white-50)';

        return `
        <tr class="ts-row" title="${entry.desc}">
            <td style="padding:0.875rem 1.25rem;font-size:0.8125rem;font-weight:600;color:var(--white);white-space:nowrap">${dateStr}</td>
            <td style="padding:0.875rem 1.25rem">
                <div style="font-size:0.8125rem;font-weight:600;color:var(--white)">${entry.project.split('—')[0].trim()}</div>
                <div style="font-size:0.6875rem;color:var(--white-40)">${entry.project.includes('—') ? entry.project.split('—')[1].trim() : ''}</div>
            </td>
            <td style="padding:0.875rem 1.25rem;font-family:monospace;font-weight:800;font-size:0.9375rem;color:var(--white)">${entry.hours}h</td>
            <td style="padding:0.875rem 1.25rem">
                <span style="font-size:0.625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${typeColor}">${entry.type}</span>
            </td>
            <td style="padding:0.875rem 1.25rem">
                <span style="display:inline-block;padding:0.25rem 0.625rem;border-radius:0.375rem;font-size:0.5625rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;${statusStyle}">${entry.status}</span>
            </td>
            <td style="padding:0.875rem 1.25rem;text-align:right">
                ${isPending ? `<button class="ts-action-btn reject" title="Delete entry" onclick="deleteDevTsEntry('${entry.id}')">
                    <i data-lucide="trash-2" style="width:13px;height:13px"></i>
                </button>` : '<span style="font-size:0.6875rem;color:var(--white-30)">—</span>'}
            </td>
        </tr>`;
    }).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function updateDevTsStats() {
    const thisWeek = devTimesheetEntries.reduce((s, e) => s + e.hours, 0);
    const approved = devTimesheetEntries.filter(e => e.status === 'Approved').reduce((s, e) => s + e.hours, 0);
    const pending  = devTimesheetEntries.filter(e => e.status === 'Pending').reduce((s, e) => s + e.hours, 0);
    if (document.getElementById('dev-ts-week'))     document.getElementById('dev-ts-week').textContent     = thisWeek + 'h';
    if (document.getElementById('dev-ts-approved')) document.getElementById('dev-ts-approved').textContent = approved + 'h';
    if (document.getElementById('dev-ts-pending'))  document.getElementById('dev-ts-pending').textContent  = pending + 'h';
}

function submitDevTimesheet() {
    const date    = document.getElementById('dev-ts-date')?.value;
    const project = document.getElementById('dev-ts-project')?.value;
    const hours   = parseFloat(document.getElementById('dev-ts-hours')?.value);
    const type    = document.getElementById('dev-ts-type')?.value || 'Regular';
    const desc    = document.getElementById('dev-ts-desc')?.value?.trim();

    if (!date || !project || !hours || hours < 0.5) {
        showToast('⚠ Please fill in Date, Project and Hours.');
        return;
    }

    devTimesheetEntries.unshift({
        id: 'dt' + Date.now(),
        date, project, hours, type, status: 'Pending', desc: desc || 'No description'
    });

    // Reset form
    document.getElementById('dev-ts-date').value  = '';
    document.getElementById('dev-ts-hours').value = '';
    document.getElementById('dev-ts-desc').value  = '';

    renderDevTimesheets();
    updateDevTsStats();
    showToast('✓ Timesheet entry submitted!');
}

function filterDevTimesheets(searchText) {
    const statusFilter = document.getElementById('dev-ts-filter')?.value || '';
    const filtered = devTimesheetEntries.filter(e => {
        const matchText = !searchText ||
            e.project.toLowerCase().includes(searchText.toLowerCase()) ||
            (e.desc || '').toLowerCase().includes(searchText.toLowerCase());
        const matchStatus = !statusFilter || e.status === statusFilter;
        return matchText && matchStatus;
    });
    renderDevTimesheets(filtered);
}

function deleteDevTsEntry(id) {
    const idx = devTimesheetEntries.findIndex(e => e.id === id);
    if (idx !== -1) {
        devTimesheetEntries.splice(idx, 1);
        renderDevTimesheets();
        updateDevTsStats();
        showToast('Entry deleted.');
    }
}

function exportDevTimesheets() {
    const lines = ['Date,Project,Hours,Type,Status,Description'];
    devTimesheetEntries.forEach(e => {
        lines.push(`${e.date},"${e.project}",${e.hours},${e.type},${e.status},"${e.desc || ''}"`);
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'Timesheets_Export.csv';
    a.click(); URL.revokeObjectURL(url);
}

// Initialize dev timesheets on screen show
const _origNavigateTo = window.navigateTo;

// ===== MY DOCUMENTS =====
const devDocuments = [
    { id: 'doc1', name: 'Alex_Rivera_CV.pdf',          type: 'CV',       date: '2024-03-19', size: '1.2 MB', icon: 'file-text',      color: '#60a5fa' },
    { id: 'doc2', name: 'NDA_Acme_Corp.pdf',           type: 'NDA',      date: '2024-03-01', size: '0.4 MB', icon: 'file-lock',      color: '#fbbf24' },
    { id: 'doc3', name: 'Service_Contract_2024.pdf',   type: 'Contract', date: '2024-01-15', size: '0.8 MB', icon: 'file-signature', color: '#a5b4fc' },
    { id: 'doc4', name: 'Tax_Form_2023.pdf',           type: 'Finance',  date: '2024-02-10', size: '0.3 MB', icon: 'receipt',        color: '#34d399' },
];

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
        id: 'doc' + Date.now(),
        name: file.name,
        type: 'Other',
        date: new Date().toISOString().slice(0, 10),
        size: (file.size / 1024 / 1024).toFixed(1) + ' MB',
        icon: 'file',
        color: 'var(--white-50)'
    });
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
        renderDevDocuments();
        showToast('Document verwijderd.');
    }
}
