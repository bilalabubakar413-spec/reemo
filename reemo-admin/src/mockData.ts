import { Client, Developer, Timesheet, Invoice, TimelineEvent } from './types';

export const clients: Client[] = [
  { id: 'c1', name: 'Acme Corp', developersCount: 4, totalHoursMonth: 640, invoiceStatus: 'Paid', industry: 'E-commerce', contactPerson: 'John Doe', email: 'john@acme.com', imageUrl: '' },
  { id: 'c2', name: 'Globex', developersCount: 2, totalHoursMonth: 320, invoiceStatus: 'Open', industry: 'Fintech', contactPerson: 'Jane Smith', email: 'jane@globex.com', imageUrl: '' },
  { id: 'c3', name: 'Soylent Corp', developersCount: 3, totalHoursMonth: 480, invoiceStatus: 'Overdue', industry: 'Health', contactPerson: 'Bob Brown', email: 'bob@soylent.com', imageUrl: '' },
  { id: 'c4', name: 'Initech', developersCount: 5, totalHoursMonth: 800, invoiceStatus: 'Paid', industry: 'Software', contactPerson: 'Bill Lumbergh', email: 'bill@initech.com', imageUrl: '' },
  { id: 'c5', name: 'Umbrella Corp', developersCount: 1, totalHoursMonth: 160, invoiceStatus: 'Open', industry: 'Biotech', contactPerson: 'Albert Wesker', email: 'albert@umbrella.com', imageUrl: '' },
];

export const developers: Developer[] = [
  { id: 'd1', name: 'Alex Rivera', activeProjects: 2, hoursThisWeek: 38, hourlyRate: 85, role: 'Senior Frontend', email: 'alex@reemo.io', avatar: '' },
  { id: 'd2', name: 'Sarah Chen', activeProjects: 1, hoursThisWeek: 40, hourlyRate: 95, role: 'Fullstack Engineer', email: 'sarah@reemo.io', avatar: '' },
  { id: 'd3', name: 'Marcus Thorne', activeProjects: 1, hoursThisWeek: 35, hourlyRate: 75, role: 'Backend Developer', email: 'marcus@reemo.io', avatar: '' },
  { id: 'd4', name: 'Elena Vance', activeProjects: 3, hoursThisWeek: 42, hourlyRate: 110, role: 'DevOps Architect', email: 'elena@reemo.io', avatar: '' },
  { id: 'd5', name: 'Jordan Smith', activeProjects: 1, hoursThisWeek: 40, hourlyRate: 65, role: 'Junior Developer', email: 'jordan@reemo.io', avatar: '' },
];

export const timesheets: Timesheet[] = [
  { id: 't1', developerId: 'd1', developerName: 'Alex Rivera', clientId: 'c1', clientName: 'Acme Corp', week: 'Week 10', hoursWorked: 40, status: 'Approved', date: '2024-03-10', description: 'Developed new checkout flow' },
  { id: 't2', developerId: 'd2', developerName: 'Sarah Chen', clientId: 'c2', clientName: 'Globex', week: 'Week 10', hoursWorked: 38, status: 'Pending', date: '2024-03-11', description: 'API integration for payment gateway' },
  { id: 't3', developerId: 'd3', developerName: 'Marcus Thorne', clientId: 'c3', clientName: 'Soylent Corp', week: 'Week 10', hoursWorked: 40, status: 'Approved', date: '2024-03-12', description: 'Database optimization' },
  { id: 't4', developerId: 'd4', developerName: 'Elena Vance', clientId: 'c1', clientName: 'Acme Corp', week: 'Week 10', hoursWorked: 42, status: 'Rejected', date: '2024-03-13', description: 'Infrastructure setup' },
];

export const invoices: Invoice[] = [
  { id: 'i1', clientId: 'c1', clientName: 'Acme Corp', amount: 12500, status: 'Paid', dateSent: '2024-02-28', paymentDeadline: '2024-03-15' },
  { id: 'i2', clientId: 'c2', clientName: 'Globex', amount: 8400, status: 'Open', dateSent: '2024-03-01', paymentDeadline: '2024-03-15' },
  { id: 'i3', clientId: 'c3', clientName: 'Soylent Corp', amount: 15000, status: 'Overdue', dateSent: '2024-02-15', paymentDeadline: '2024-03-01' },
];

export const timelineEvents: TimelineEvent[] = [
  { id: 'e1', clientId: 'c1', type: 'contract_created', date: '2023-12-01', description: 'Annual service agreement signed' },
  { id: 'e2', clientId: 'c1', type: 'developer_assigned', date: '2023-12-05', description: 'Alex Rivera assigned to project' },
  { id: 'e3', clientId: 'c1', type: 'hours_registered', date: '2024-01-31', description: '160 hours registered for January' },
  { id: 'e4', clientId: 'c1', type: 'invoice_sent', date: '2024-02-01', description: 'Invoice #INV-001 sent' },
  { id: 'e5', clientId: 'c1', type: 'payment_received', date: '2024-02-10', description: 'Payment for #INV-001 received' },
];

export const revenueData = [
  { month: 'Oct', revenue: 45000 },
  { month: 'Nov', revenue: 52000 },
  { month: 'Dec', revenue: 48000 },
  { month: 'Jan', revenue: 61000 },
  { month: 'Feb', revenue: 58000 },
  { month: 'Mar', revenue: 72000 },
];

export const hoursPerClientData = [
  { name: 'Acme Corp', hours: 640 },
  { name: 'Globex', hours: 320 },
  { name: 'Soylent Corp', hours: 480 },
  { name: 'Initech', hours: 800 },
  { name: 'Umbrella Corp', hours: 160 },
];
