import { Client, Developer, Timesheet, Invoice, CV, TimelineEvent } from './types';

export const clients: Client[] = [
  {
    id: 'c1',
    name: 'Acme Corp',
    industry: 'E-commerce',
    contactPerson: 'Jane Doe',
    email: 'jane@acme.com',
    developersCount: 3,
    totalHoursMonth: 120,
    invoiceStatus: 'Paid'
  },
  {
    id: 'c2',
    name: 'TechFlow',
    industry: 'SaaS',
    contactPerson: 'John Smith',
    email: 'john@techflow.io',
    developersCount: 1,
    totalHoursMonth: 40,
    invoiceStatus: 'Open'
  }
];

export const developers: Developer[] = [
  {
    id: 'd1',
    name: 'Alex Rivera',
    role: 'Senior Frontend Developer',
    email: 'alex@reemo.io',
    hourlyRate: 85,
    gender: 'male',
    activeProjects: 2,
    hoursThisWeek: 38,
    isBooked: true,
    bookedAssignment: 'Checkout Redesign',
    bookedForClient: 'Acme Corp',
    bookedPeriodStart: 'Jan 2024',
    bookedPeriodEnd: 'Jun 2024'
  },
  {
    id: 'd2',
    name: 'Sarah Jenkins',
    role: 'Backend Developer',
    email: 'sarah@reemo.io',
    hourlyRate: 90,
    gender: 'female',
    activeProjects: 1,
    hoursThisWeek: 40,
    isBooked: true,
    bookedAssignment: 'API Integration',
    bookedForClient: 'TechFlow',
    bookedPeriodStart: 'Feb 2024',
    bookedPeriodEnd: 'Dec 2024'
  }
];

export const timesheets: Timesheet[] = [
  {
    id: 'ts1',
    developerId: 'd1',
    developerName: 'Alex Rivera',
    clientId: 'c1',
    clientName: 'Acme Corp',
    week: 'Week 13 (Mar 24 - Mar 30)',
    hoursWorked: 38,
    status: 'Approved',
    date: '2024-03-30',
    description: 'Frontend development for checkout'
  }
];

export const invoices: Invoice[] = [
  {
    id: 'inv001',
    clientId: 'c1',
    clientName: 'Acme Corp',
    amount: 10200,
    status: 'Paid',
    dateSent: '2024-03-01',
    paymentDeadline: '2024-03-15'
  }
];

export const timelineEvents: TimelineEvent[] = [];

export const cvs: CV[] = [
  {
    id: 'cv1',
    name: 'Alex Rivera',
    skills: ['React', 'TypeScript', 'Tailwind'],
    uploadDate: '2024-01-15',
    fileUrl: '#',
    status: 'Reemo Format'
  }
];

export const revenueData = [
  { month: 'Jan', revenue: 45000 },
  { month: 'Feb', revenue: 52000 },
  { month: 'Mar', revenue: 61000 },
  { month: 'Apr', revenue: 58000 },
  { month: 'May', revenue: 68000 },
  { month: 'Jun', revenue: 72400 },
];

export const hoursPerClientData = [
  { name: 'Acme Corp', hours: 450 },
  { name: 'TechFlow', hours: 280 },
  { name: 'Nexus', hours: 150 },
  { name: 'Quantum', hours: 90 },
];
