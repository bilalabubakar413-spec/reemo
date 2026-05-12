// ============================================================
//  REEMO – Persistent App State (localStorage-backed)
//  All data is saved after every mutation so nothing is lost
//  on page refresh. When the relational DB arrives later,
//  replace the load/save functions with API calls.
// ============================================================

const STORAGE_KEYS = {
    clients:    'reemo_clients',
    developers: 'reemo_developers',
    timesheets: 'reemo_timesheets',
    invoices:   'reemo_invoices',
    cvs:        'reemo_cvs',
    devTs:      'reemo_dev_timesheets',
    devDocs:    'reemo_dev_documents',
};

// ── Default seed data ─────────────────────────────────────────
const DEFAULT_CLIENTS = [
    { id: 'c1', name: 'Acme Corp',     developersCount: 4, totalHoursMonth: 640, invoiceStatus: 'Paid',    industry: 'E-commerce', contactPerson: 'John Doe',       email: 'john@acme.com'     },
    { id: 'c2', name: 'Globex',        developersCount: 2, totalHoursMonth: 320, invoiceStatus: 'Open',    industry: 'Fintech',    contactPerson: 'Jane Smith',      email: 'jane@globex.com'   },
    { id: 'c3', name: 'Soylent Corp',  developersCount: 3, totalHoursMonth: 480, invoiceStatus: 'Overdue', industry: 'Health',     contactPerson: 'Bob Brown',       email: 'bob@soylent.com'   },
    { id: 'c4', name: 'Initech',       developersCount: 5, totalHoursMonth: 800, invoiceStatus: 'Paid',    industry: 'Software',   contactPerson: 'Bill Lumbergh',   email: 'bill@initech.com'  },
    { id: 'c5', name: 'Umbrella Corp', developersCount: 1, totalHoursMonth: 160, invoiceStatus: 'Open',    industry: 'Biotech',    contactPerson: 'Albert Wesker',   email: 'albert@umbrella.com'},
];

const DEFAULT_DEVELOPERS = [
    { id: 'd1', name: 'Alex Rivera',   activeProjects: 2, hoursThisWeek: 38, hourlyRate: 85,  role: 'Senior Frontend',    email: 'alex@reemo.io'   },
    { id: 'd2', name: 'Sarah Chen',    activeProjects: 1, hoursThisWeek: 40, hourlyRate: 95,  role: 'Fullstack Engineer',  email: 'sarah@reemo.io'  },
    { id: 'd3', name: 'Marcus Thorne', activeProjects: 1, hoursThisWeek: 35, hourlyRate: 75,  role: 'Backend Developer',   email: 'marcus@reemo.io' },
    { id: 'd4', name: 'Elena Vance',   activeProjects: 3, hoursThisWeek: 42, hourlyRate: 110, role: 'DevOps Architect',    email: 'elena@reemo.io'  },
    { id: 'd5', name: 'Jordan Smith',  activeProjects: 1, hoursThisWeek: 40, hourlyRate: 65,  role: 'Junior Developer',    email: 'jordan@reemo.io' },
];

const DEFAULT_TIMESHEETS = [
    { id: 't1', developerName: 'Alex Rivera',   clientName: 'Acme Corp',   hoursWorked: 40, status: 'Approved', date: '2024-03-10', description: 'Developed new checkout flow'          },
    { id: 't2', developerName: 'Sarah Chen',    clientName: 'Globex',      hoursWorked: 38, status: 'Pending',  date: '2024-03-11', description: 'API integration for payment gateway'   },
    { id: 't3', developerName: 'Marcus Thorne', clientName: 'Soylent Corp',hoursWorked: 40, status: 'Approved', date: '2024-03-12', description: 'Database optimization'                 },
    { id: 't4', developerName: 'Elena Vance',   clientName: 'Acme Corp',   hoursWorked: 42, status: 'Rejected', date: '2024-03-13', description: 'Infrastructure setup'                  },
];

const DEFAULT_INVOICES = [
    { id: 'i1', clientName: 'Acme Corp',   amount: 12500, status: 'Paid',    dateSent: '2024-02-28', paymentDeadline: '2024-03-15' },
    { id: 'i2', clientName: 'Globex',      amount:  8400, status: 'Open',    dateSent: '2024-03-01', paymentDeadline: '2024-03-15' },
    { id: 'i3', clientName: 'Soylent Corp',amount: 15000, status: 'Overdue', dateSent: '2024-02-15', paymentDeadline: '2024-03-01' },
];

const DEFAULT_CVS = [
    { id: 'cv1', name: 'Thomas Anderson', skills: ['React', 'Node.js', 'TypeScript'], uploadDate: '2024-03-20', status: 'ORIGINAL'      },
    { id: 'cv2', name: 'Trinity Knight',  skills: ['Python', 'Django', 'AWS'],        uploadDate: '2024-03-21', status: 'REEMO FORMAT'  },
    { id: 'cv3', name: 'Morpheus Dream',  skills: ['Kubernetes', 'Docker', 'Go'],     uploadDate: '2024-03-22', status: 'ORIGINAL'      },
    { id: 'cv4', name: 'Niobe Captain',   skills: ['Java', 'Spring Boot', 'SQL'],     uploadDate: '2024-03-23', status: 'REEMO FORMAT'  },
    { id: 'cv5', name: 'Cypher Traitor',  skills: ['PHP', 'Laravel', 'Vue.js'],       uploadDate: '2024-03-24', status: 'ORIGINAL'      },
];

const DEFAULT_DEV_TS = [
    { id: 'dt1', date: '2024-03-22', project: 'Acme Corp — Checkout Redesign', hours: 8,   type: 'Regular',  status: 'Pending',  desc: 'Implemented checkout flow components' },
    { id: 'dt2', date: '2024-03-21', project: 'Acme Corp — Checkout Redesign', hours: 8,   type: 'Regular',  status: 'Approved', desc: 'Cart state management & API integration' },
    { id: 'dt3', date: '2024-03-20', project: 'Acme Corp — Checkout Redesign', hours: 8,   type: 'Regular',  status: 'Approved', desc: 'Unit tests for payment module' },
    { id: 'dt4', date: '2024-03-19', project: 'Globex — API Integration',      hours: 4.5, type: 'Overtime', status: 'Pending',  desc: 'Debugging webhook endpoints' },
    { id: 'dt5', date: '2024-03-18', project: 'Internal — R&D',                hours: 6,   type: 'Regular',  status: 'Approved', desc: 'Architecture review & documentation' },
];

const DEFAULT_DEV_DOCS = [
    { id: 'doc1', name: 'Alex_Rivera_CV.pdf',         type: 'CV',       date: '2024-03-19', size: '1.2 MB', icon: 'file-text',  color: '#60a5fa' },
    { id: 'doc2', name: 'NDA_Acme_Corp.pdf',          type: 'NDA',      date: '2024-03-01', size: '0.4 MB', icon: 'file-lock',  color: '#fbbf24' },
    { id: 'doc3', name: 'Service_Contract_2024.pdf',  type: 'Contract', date: '2024-01-15', size: '0.8 MB', icon: 'file-signature', color: '#a5b4fc' },
    { id: 'doc4', name: 'Tax_Form_2023.pdf',          type: 'Finance',  date: '2024-02-10', size: '0.3 MB', icon: 'receipt',    color: '#34d399' },
];

// ── Load / Save helpers ───────────────────────────────────────
function _load(key, defaults) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return JSON.parse(JSON.stringify(defaults));
        return JSON.parse(raw);
    } catch { return JSON.parse(JSON.stringify(defaults)); }
}

function _save(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ── Exported reactive state ────────────────────────────────────
// Each array is the live in-memory copy. Call save_X() after mutating.

let clients            = _load(STORAGE_KEYS.clients,    DEFAULT_CLIENTS);
let developers         = _load(STORAGE_KEYS.developers, DEFAULT_DEVELOPERS);
let timesheets         = _load(STORAGE_KEYS.timesheets, DEFAULT_TIMESHEETS);
let invoices           = _load(STORAGE_KEYS.invoices,   DEFAULT_INVOICES);
let cvs                = _load(STORAGE_KEYS.cvs,        DEFAULT_CVS);
let devTimesheetEntries= _load(STORAGE_KEYS.devTs,      DEFAULT_DEV_TS);
let devDocuments       = _load(STORAGE_KEYS.devDocs,    DEFAULT_DEV_DOCS);

function saveClients()    { _save(STORAGE_KEYS.clients,    clients);             }
function saveDevelopers() { _save(STORAGE_KEYS.developers, developers);          }
function saveTimesheets() { _save(STORAGE_KEYS.timesheets, timesheets);          }
function saveInvoices()   { _save(STORAGE_KEYS.invoices,   invoices);            }
function saveCVs()        { _save(STORAGE_KEYS.cvs,        cvs);                 }
function saveDevTs()      { _save(STORAGE_KEYS.devTs,      devTimesheetEntries); }
function saveDevDocs()    { _save(STORAGE_KEYS.devDocs,    devDocuments);        }

// ── ID generators ─────────────────────────────────────────────
function genId(prefix) { return prefix + Date.now() + Math.random().toString(36).slice(2,5); }
