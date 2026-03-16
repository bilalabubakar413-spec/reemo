export interface Client {
  id: string;
  name: string;
  developersCount: number;
  totalHoursMonth: number;
  invoiceStatus: 'Paid' | 'Open' | 'Overdue';
  industry: string;
  contactPerson: string;
  email: string;
  imageUrl?: string;
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
