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

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Initialize Lucide icons
    lucide.createIcons();

    // Setup Event Listeners
    loginForm.addEventListener('submit', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    
    // Navigation
    navItems.forEach(item => {
        item.addEventListener('click', () => {
             navigateTo(item.getAttribute('data-target'));
        });
    });

    document.getElementById('btn-manage-clients').addEventListener('click', () => navigateTo('clients'));

    // Render Initial Data
    renderDashboardStats();
    renderDashboardTimesheets();
    renderClientsGrid();
    renderDevelopersGrid();
    renderTimesheetsTable();
    renderInvoicesTable();
    initCharts();
});

// --- Authentication ---
function handleLogin(e) {
    e.preventDefault();
    loginScreen.classList.add('hidden');
    appContainer.classList.remove('hidden');
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

function renderClientsGrid() {
    const container = document.getElementById('clients-grid');
    container.innerHTML = clients.map((client, i) => `
        <div class="card card-hover-border border cursor-pointer" style="animation: fadeIn 0.3s ease-out ${i * 0.1}s both;">
            <div class="flex justify-between items-start mb-6">
                <div>
                    <h3 class="text-xl font-bold hover:text-blue-400 transition-colors">${client.name}</h3>
                    <p class="text-xs text-white-40 mt-1">${client.industry}</p>
                </div>
                <div class="status-badge ${getStatusClass(client.invoiceStatus)} shrink-0">
                    ${client.invoiceStatus}
                </div>
            </div>
            <div class="grid grid-cols-2 gap-4 pt-4 border-t border-white-5">
                <div>
                    <p class="text-[10px] text-white-30 uppercase font-bold tracking-wider">Developers</p>
                    <p class="text-lg font-bold">${client.developersCount}</p>
                </div>
                <div>
                    <p class="text-[10px] text-white-30 uppercase font-bold tracking-wider">Monthly Hours</p>
                    <p class="text-lg font-bold">${client.totalHoursMonth}h</p>
                </div>
            </div>
        </div>
    `).join('');
}

function renderDevelopersGrid() {
    const container = document.getElementById('developers-grid');
    container.innerHTML = developers.map((dev, i) => {
        const capacityPct = (dev.hoursThisWeek / 40) * 100;
        const capacityColor = dev.hoursThisWeek > 35 ? 'var(--rose-500)' : 'var(--blue-600)';
        
        return `
            <div class="card card-hover-border border" style="animation: fadeIn 0.3s ease-out ${i * 0.1}s both;">
                <div class="flex items-center gap-4 mb-6">
                    <div class="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg shrink-0" style="background-color: rgba(37, 99, 235, 0.2); color: var(--blue-400)">
                        ${getInitials(dev.name)}
                    </div>
                    <div class="min-w-0">
                        <h3 class="text-xl font-bold truncate hover:text-blue-400 transition-colors cursor-pointer">${dev.name}</h3>
                        <p class="text-xs text-white-40 mt-1 truncate">${dev.role}</p>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div class="p-3 bg-white-5 rounded-xl border border-white-5">
                        <p class="text-[10px] text-white-30 uppercase font-bold tracking-wider">Projects</p>
                        <p class="text-lg font-bold">${dev.activeProjects}</p>
                    </div>
                    <div class="p-3 bg-white-5 rounded-xl border border-white-5">
                        <p class="text-[10px] text-white-30 uppercase font-bold tracking-wider">Rate</p>
                        <p class="text-lg font-bold">$${dev.hourlyRate}/h</p>
                    </div>
                </div>

                <div class="space-y-3">
                    <div class="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                        <span class="text-white-30">Weekly Capacity</span>
                        <span class="text-blue-400">${dev.hoursThisWeek} / 40h</span>
                    </div>
                    <div class="h-2 bg-white-5 rounded-full overflow-hidden w-full">
                        <div class="h-full rounded-full transition-all duration-1000 ease-out" style="width: ${capacityPct}%; background-color: ${capacityColor};"></div>
                    </div>
                </div>

                <button class="w-full mt-8 py-3 rounded-2xl bg-white-5 hover:bg-white-10 border border-white-5 text-sm font-medium transition-all cursor-pointer">
                    View Profile
                </button>
            </div>
        `;
    }).join('');
}

function renderTimesheetsTable() {
     const tbody = document.getElementById('timesheets-body');
     tbody.innerHTML = timesheets.map(ts => `
        <tr class="hover:bg-white-5 transition-all">
            <td class="text-sm font-medium whitespace-nowrap">${ts.developerName}</td>
            <td class="text-sm text-white-60">${ts.clientName}</td>
            <td class="text-sm text-white-40 whitespace-nowrap">${ts.date}</td>
            <td class="text-sm text-white-60 max-w-xs truncate">${ts.description}</td>
            <td class="text-sm font-mono whitespace-nowrap">${ts.hoursWorked}h</td>
            <td>
                <span class="status-badge ${getStatusClass(ts.status)}">${ts.status}</span>
            </td>
        </tr>
     `).join('');
}

function renderInvoicesTable() {
    const tbody = document.getElementById('invoices-body');
     tbody.innerHTML = invoices.map(inv => `
        <tr class="hover:bg-white-5 transition-all cursor-pointer">
            <td class="text-sm font-mono text-blue-400 whitespace-nowrap">#INV-${inv.id.toUpperCase()}</td>
            <td class="text-sm font-medium text-white-80 whitespace-nowrap">${inv.clientName}</td>
            <td class="text-sm font-bold whitespace-nowrap">${formatCurrency(inv.amount)}</td>
            <td class="text-sm text-white-40 whitespace-nowrap">${inv.dateSent}</td>
            <td class="text-sm text-white-40 whitespace-nowrap">${inv.paymentDeadline}</td>
            <td>
                <span class="status-badge ${getStatusClass(inv.status)}">${inv.status}</span>
            </td>
        </tr>
     `).join('');
}

// --- Charts Setup ---
function initCharts() {
    Chart.defaults.color = 'rgba(255, 255, 255, 0.4)';
    Chart.defaults.font.family = "'Inter', sans-serif";

    // Monthly Revenue Area Chart
    const revCtx = document.getElementById('revenueChart').getContext('2d');
    const revGradient = revCtx.createLinearGradient(0, 0, 0, 300);
    revGradient.addColorStop(0, 'rgba(37, 99, 235, 0.3)');
    revGradient.addColorStop(1, 'rgba(37, 99, 235, 0)');

    new Chart(revCtx, {
        type: 'line',
        data: {
            labels: ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
            datasets: [{
                label: 'Revenue',
                data: [45000, 52000, 48000, 61000, 58000, 72000],
                borderColor: '#2563eb',
                borderWidth: 3,
                backgroundColor: revGradient,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#080808',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) { return '$' + context.parsed.y.toLocaleString(); }
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, border: { display: false } },
                y: { 
                    grid: { color: 'rgba(255, 255, 255, 0.05)', borderDash: [3, 3] },
                    border: { display: false },
                    ticks: { callback: function(val) { return '$' + (val/1000) + 'k'; } }
                }
            }
        }
    });

    // Hours per Client Bar Chart
    const hoursCtx = document.getElementById('hoursChart').getContext('2d');
    
    new Chart(hoursCtx, {
        type: 'bar',
        data: {
            labels: ['Acme Corp', 'Globex', 'Soylent Corp', 'Initech', 'Umbrella Corp'],
            datasets: [{
                label: 'Hours',
                data: [640, 320, 480, 800, 160],
                backgroundColor: function(context) {
                    return context.dataIndex % 2 === 0 ? 'rgba(37, 99, 235, 0.8)' : 'rgba(59, 130, 246, 0.8)';
                },
                borderRadius: 4,
                barPercentage: 0.5,
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
                    backgroundColor: '#080808',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255,255,255,0.1)',
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
                    ticks: { autoSkip: false, font: { size: 11 } }
                }
            }
        }
    });
}
