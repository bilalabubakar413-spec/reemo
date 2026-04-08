export type Screen = 'dashboard' | 'clients' | 'client-detail' | 'developers' | 'timesheets' | 'invoices' | 'cv-database' | 'login' | 'dev-dashboard' | 'dev-profile' | 'dev-documents';
export type UserRole = 'admin' | 'developer';

export interface Client {
  id: string;
  name: string;
  developersCount: number;
  totalHoursMonth: number;
  invoiceStatus: 'Paid' | 'Open' | 'Overdue';
  industry: string;
  contactPerson: string;
  email: string;
  logoUrl?: string;
  contractUrl?: string;
}

export interface Developer {
  id: string;
  name: string;
  activeProjects: number;
  hoursThisWeek: number;
  hourlyRate: number;
  role: string;
  email: string;
  avatar?: string;
  gender: 'male' | 'female' | 'other';
  isBooked: boolean;
  bookedForClient?: string;
  bookedAssignment?: string;
  bookedPeriodStart?: string;
  bookedPeriodEnd?: string;
  contractUrl?: string;
}

export interface CV {
  id: string;
  name: string;
  skills: string[];
  uploadDate: string;
  fileUrl: string;
  status: 'Original' | 'Reemo Format';
}

export interface Timesheet {
  id: string;
  developerId: string;
  developerName: string;
  clientId: string;
  clientName: string;
  week: string;
  hoursWorked: number;
  status: 'Approved' | 'Pending' | 'Rejected';
  date: string;
  description: string;
}

export interface Invoice {
  id: string;
  clientId: string;
  clientName: string;
  amount: number;
  status: 'Paid' | 'Open' | 'Overdue';
  dateSent: string;
  paymentDeadline: string;
}

export interface TimelineEvent {
  id: string;
  clientId: string;
  type: 'contract_created' | 'developer_assigned' | 'hours_registered' | 'invoice_sent' | 'payment_received';
  date: string;
  description: string;
}
