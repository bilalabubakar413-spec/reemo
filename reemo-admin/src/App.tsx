import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  Users, 
  UserCircle, 
  Clock, 
  FileText, 
  Settings, 
  LogOut, 
  Search, 
  Bell, 
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertCircle,
  History,
  MoreVertical
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Types and Mock Data
import { clients, developers, timesheets, invoices, revenueData, hoursPerClientData, timelineEvents } from './mockData';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Screen = 'dashboard' | 'clients' | 'client-detail' | 'developers' | 'timesheets' | 'invoices' | 'login';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('login');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsAuthenticated(true);
    setCurrentScreen('dashboard');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentScreen('login');
  };

  const navigateToClientDetail = (id: string) => {
    setSelectedClientId(id);
    setCurrentScreen('client-detail');
  };

  if (currentScreen === 'login') {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-screen bg-[#050505] text-white font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Sidebar */}
      <Sidebar 
        currentScreen={currentScreen} 
        onNavigate={(screen) => setCurrentScreen(screen)} 
        onLogout={handleLogout}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-[#050505] relative w-full h-full">
        <Header onOpenInfo={() => {}} />
        <div className="p-8 max-w-7xl mx-auto w-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentScreen + (selectedClientId || '')}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {currentScreen === 'dashboard' && <DashboardOverview onNavigateToClients={() => setCurrentScreen('clients')} />}
              {currentScreen === 'clients' && <ClientsPage onSelectClient={navigateToClientDetail} />}
              {currentScreen === 'client-detail' && selectedClientId && (
                <ClientDetailPage clientId={selectedClientId} onBack={() => setCurrentScreen('clients')} />
              )}
              {currentScreen === 'developers' && <DevelopersPage />}
              {currentScreen === 'timesheets' && <TimesheetsPage />}
              {currentScreen === 'invoices' && <InvoicesPage />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

// --- Components ---

function Sidebar({ currentScreen, onNavigate, onLogout }: { 
  currentScreen: Screen, 
  onNavigate: (s: Screen) => void,
  onLogout: () => void
}) {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'clients', label: 'Clients', icon: Users },
    { id: 'developers', label: 'Developers', icon: UserCircle },
    { id: 'timesheets', label: 'Timesheets', icon: Clock },
    { id: 'invoices', label: 'Invoices', icon: FileText },
  ];

  return (
    <aside className="w-64 border-r border-white/5 flex flex-col bg-[#080808] shrink-0 z-20 h-full overflow-y-auto">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.4)]">
          <span className="font-bold text-lg">R</span>
        </div>
        <h1 className="font-bold text-xl tracking-tight">Reemo Admin</h1>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id as Screen)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group cursor-pointer",
              currentScreen === item.id || (currentScreen === 'client-detail' && item.id === 'clients')
                ? "bg-blue-600/10 text-blue-400 font-medium" 
                : "text-white/50 hover:text-white hover:bg-white/5"
            )}
          >
            <item.icon className={cn(
              "w-5 h-5",
              currentScreen === item.id || (currentScreen === 'client-detail' && item.id === 'clients')
                ? "text-blue-400" 
                : "text-white/30 group-hover:text-white/60"
            )} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-white/5 space-y-1">
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/50 hover:text-white hover:bg-white/5 transition-all cursor-pointer">
          <Settings className="w-5 h-5 text-white/30" />
          Settings
        </button>
        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-red-400/70 hover:text-red-400 hover:bg-red-400/5 transition-all cursor-pointer"
        >
          <LogOut className="w-5 h-5" />
          Logout
        </button>
      </div>

      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
          <div className="w-10 h-10 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-400 font-bold shrink-0">
            T1
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">Test one</p>
            <p className="text-[10px] text-white/40 truncate">Operations Lead</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Header({ onOpenInfo }: { onOpenInfo: () => void }) {
  return (
    <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 sticky top-0 bg-[#050505]/80 backdrop-blur-md z-10 w-full">
      <div className="relative w-96">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input 
          type="text" 
          placeholder="Search clients, developers, invoices..." 
          className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-blue-500/50 transition-all text-white placeholder-white/30"
        />
      </div>
      <div className="flex items-center gap-4">
        <button className="p-2 rounded-full hover:bg-white/5 text-white/50 transition-all relative cursor-pointer">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-blue-500 rounded-full border-2 border-[#050505]"></span>
        </button>
        <div className="h-8 w-[1px] bg-white/10 mx-2"></div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium">Test</p>
            <p className="text-xs text-white/40">Admin</p>
          </div>
          <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-400 text-xs font-bold shrink-0">
            T
          </div>
        </div>
      </div>
    </header>
  );
}

function LoginScreen({ onLogin }: { onLogin: (e: React.FormEvent) => void }) {
  return (
    <div className="min-h-[100vh] w-[100vw] flex items-center justify-center bg-[#050505] text-white p-8 overflow-hidden">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.5)] mx-auto mb-6">
            <span className="font-bold text-3xl">R</span>
          </div>
          <h2 className="text-4xl font-bold tracking-tight mb-3">Reemo Admin</h2>
          <p className="text-white/40">Centralized operations for software development.</p>
        </div>

        <form onSubmit={onLogin} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/60 block text-left">Email Address</label>
            <input 
              type="email" 
              required
              defaultValue="admin@reemo.io"
              className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-blue-500/50 transition-all text-white placeholder-white/30"
              placeholder="name@reemo.io"
            />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium text-white/60">Password</label>
              <button type="button" className="text-xs text-blue-400 hover:text-blue-300 transition-all cursor-pointer">Forgot password?</button>
            </div>
            <input 
              type="password" 
              required
              defaultValue="password"
              className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 focus:outline-none focus:border-blue-500/50 transition-all text-white placeholder-white/30"
              placeholder="••••••••"
            />
          </div>

          <button 
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl shadow-[0_0_30px_rgba(37,99,235,0.3)] transition-all active:scale-[0.98] cursor-pointer"
          >
            Sign In
          </button>
        </form>

        <div className="mt-12 pt-8 border-t border-white/5 text-center">
          <p className="text-xs text-white/30">© 2026 Reemo Operations</p>
        </div>
      </motion.div>
    </div>
  );
}

function DashboardOverview({ onNavigateToClients }: { onNavigateToClients: () => void }) {
  const stats = [
    { label: 'Active Clients', value: '12', trend: '+2', icon: Users, color: 'text-blue-400' },
    { label: 'Developers', value: '48', trend: '+5', icon: UserCircle, color: 'text-emerald-400' },
    { label: 'Hours Registered', value: '2,450', trend: '+12%', icon: Clock, color: 'text-amber-400' },
    { label: 'Revenue (MTD)', value: '$72,400', trend: '+8.4%', icon: ArrowUpRight, color: 'text-blue-500' },
    { label: 'Open Invoices', value: '8', trend: '-2', icon: FileText, color: 'text-rose-400' },
  ];

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-white/40 mt-1">Welcome back, Test. Here's what's happening today.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onNavigateToClients}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all cursor-pointer"
          >
            Manage Clients
          </button>
          <button className="bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2 rounded-xl text-sm font-medium transition-all text-white cursor-pointer">
            Generate Report
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {stats.map((stat, i) => (
          <motion.div 
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-[#080808] border border-white/5 p-5 rounded-2xl hover:border-white/10 transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className={cn("p-2 rounded-xl bg-white/5 group-hover:bg-white/10 transition-all", stat.color)}>
                <stat.icon className="w-5 h-5" />
              </div>
              <span className={cn(
                "text-xs font-medium px-2 py-1 rounded-full",
                stat.trend.startsWith('+') ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
              )}>
                {stat.trend}
              </span>
            </div>
            <p className="text-white/40 text-sm font-medium">{stat.label}</p>
            <p className="text-2xl font-bold mt-1 text-white">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#080808] border border-white/5 p-6 rounded-3xl min-h-[400px]">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-semibold text-lg text-white">Monthly Revenue</h3>
            <select className="bg-white/5 border border-white/10 rounded-lg text-xs px-2 py-1 focus:outline-none text-white cursor-pointer">
              <option className="bg-[#080808]">Last 6 Months</option>
              <option className="bg-[#080808]">Last Year</option>
            </select>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                <XAxis 
                  dataKey="month" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#ffffff40', fontSize: 12 }} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#ffffff40', fontSize: 12 }} 
                  tickFormatter={(val) => `$${val/1000}k`}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#080808', border: '1px solid #ffffff10', borderRadius: '12px' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="revenue" 
                  stroke="#2563eb" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorRev)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#080808] border border-white/5 p-6 rounded-3xl min-h-[400px]">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-semibold text-lg text-white">Hours Worked per Client</h3>
            <button onClick={onNavigateToClients} className="text-xs text-blue-400 hover:underline cursor-pointer">View all</button>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hoursPerClientData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#ffffff60', fontSize: 11 }} 
                  width={100}
                />
                <Tooltip 
                  cursor={{ fill: '#ffffff05' }}
                  contentStyle={{ backgroundColor: '#080808', border: '1px solid #ffffff10', borderRadius: '12px' }}
                />
                <Bar dataKey="hours" radius={[0, 4, 4, 0]} barSize={20}>
                  {hoursPerClientData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#2563eb' : '#3b82f6'} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Activity / Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#080808] border border-white/5 rounded-3xl overflow-hidden">
          <div className="p-6 border-b border-white/5 flex justify-between items-center">
            <h3 className="font-semibold text-white">Recent Timesheets</h3>
            <button className="text-xs text-white/40 hover:text-white transition-all cursor-pointer">View all</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-xs text-white/30 uppercase tracking-wider border-b border-white/5">
                  <th className="px-6 py-4 font-medium whitespace-nowrap">Developer</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">Client</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">Hours</th>
                  <th className="px-6 py-4 font-medium whitespace-nowrap">Status</th>
                </tr>
              </thead>
            <tbody className="divide-y divide-white/5">
                {timesheets.slice(0, 4).map((ts) => (
                  <tr key={ts.id} className="hover:bg-white/5 transition-all group cursor-pointer">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-bold shrink-0">
                          {ts.developerName.split(' ').map(n => n[0]).join('')}
                        </div>
                        <span className="text-sm font-medium text-white">{ts.developerName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-white/60 whitespace-nowrap">{ts.clientName}</td>
                    <td className="px-6 py-4 text-sm font-mono text-white whitespace-nowrap">{ts.hoursWorked}h</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md",
                        ts.status === 'Approved' ? "bg-emerald-500/10 text-emerald-400" :
                        ts.status === 'Pending' ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"
                      )}>
                        {ts.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-[#080808] border border-white/5 p-6 rounded-3xl">
          <h3 className="font-semibold mb-6 text-white">Quick Actions</h3>
          <div className="space-y-3">
            {[
              { label: 'Generate Monthly Invoice', icon: FileText, color: 'bg-blue-500' },
              { label: 'Approve All Timesheets', icon: CheckCircle2, color: 'bg-emerald-500' },
              { label: 'Add New Developer', icon: Plus, color: 'bg-indigo-500' },
              { label: 'Review Overdue Payments', icon: AlertCircle, color: 'bg-rose-500' },
            ].map((action) => (
              <button 
                key={action.label}
                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all group cursor-pointer text-left"
              >
                <div className={cn("p-2 rounded-xl text-white", action.color)}>
                  <action.icon className="w-4 h-4" />
                </div>
                <span className="text-sm font-medium text-white/80 group-hover:text-white">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ClientsPage({ onSelectClient }: { onSelectClient: (id: string) => void }) {
  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Clients</h2>
          <p className="text-white/40 mt-1">Manage your active client portfolio and contracts.</p>
        </div>
        <button className="bg-blue-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-500 transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20 cursor-pointer">
          <Plus className="w-4 h-4" />
          Add Client
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 text-white">
        {clients.map((client, i) => (
          <motion.div 
            key={client.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            onClick={() => onSelectClient(client.id)}
            className="bg-[#080808] border border-white/5 rounded-2xl p-6 cursor-pointer group hover:border-blue-500/30 transition-all"
          >
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-xl font-bold group-hover:text-blue-400 transition-colors">{client.name}</h3>
                <p className="text-xs text-white/40 mt-1">{client.industry}</p>
              </div>
              <div className={cn(
                "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest shrink-0",
                client.invoiceStatus === 'Paid' ? "bg-emerald-500/10 text-emerald-400" :
                client.invoiceStatus === 'Open' ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"
              )}>
                {client.invoiceStatus}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/5">
              <div>
                <p className="text-[10px] text-white/30 uppercase font-bold tracking-wider">Developers</p>
                <p className="text-lg font-bold">{client.developersCount}</p>
              </div>
              <div>
                <p className="text-[10px] text-white/30 uppercase font-bold tracking-wider">Monthly Hours</p>
                <p className="text-lg font-bold">{client.totalHoursMonth}h</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function ClientDetailPage({ clientId, onBack }: { clientId: string, onBack: () => void }) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return null;

  const clientTimesheets = timesheets.filter(ts => ts.clientId === clientId);
  const clientInvoices = invoices.filter(i => i.clientId === clientId);

  return (
    <div className="space-y-8 pb-8 text-white">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all cursor-pointer"
          >
            <ArrowDownRight className="w-5 h-5 rotate-135" />
          </button>
          <div>
            <h2 className="text-3xl font-bold tracking-tight">{client.name}</h2>
            <p className="text-white/40 mt-1">{client.industry} • {client.contactPerson}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button className="bg-white/5 border border-white/10 px-6 py-3 rounded-2xl font-medium hover:bg-white/10 transition-all cursor-pointer">
            Edit Client
          </button>
          <button className="bg-blue-600 px-6 py-3 rounded-2xl font-medium hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20 cursor-pointer">
            Create Invoice
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Left Column: Info & Stats */}
        <div className="xl:col-span-1 space-y-6">
          <div className="bg-[#080808] border border-white/5 p-6 rounded-3xl space-y-6">
            <h3 className="font-semibold text-lg border-b border-white/5 pb-4">Client Information</h3>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-white/30 uppercase font-bold tracking-wider mb-1">Industry</p>
                <p className="text-sm">{client.industry}</p>
              </div>
              <div>
                <p className="text-xs text-white/30 uppercase font-bold tracking-wider mb-1">Contact Person</p>
                <p className="text-sm">{client.contactPerson}</p>
              </div>
              <div>
                <p className="text-xs text-white/30 uppercase font-bold tracking-wider mb-1">Email Address</p>
                <p className="text-sm text-blue-400 break-all">{client.email}</p>
              </div>
              <div>
                <p className="text-xs text-white/30 uppercase font-bold tracking-wider mb-1">Billing Status</p>
                <span className={cn(
                  "inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md mt-1",
                  client.invoiceStatus === 'Paid' ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
                )}>
                  {client.invoiceStatus}
                </span>
              </div>
            </div>
            <button className="w-full py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 text-sm font-medium transition-all cursor-pointer">
              Edit Client Profile
            </button>
          </div>

          <div className="bg-[#080808] border border-white/5 p-6 rounded-3xl">
            <h3 className="font-semibold text-lg mb-6">Timeline</h3>
            <div className="space-y-6">
              {timelineEvents.filter(e => e.clientId === clientId).map((event, i, arr) => (
                <div key={event.id} className="flex gap-4 relative">
                  {i !== arr.length - 1 && <div className="absolute left-[11px] top-6 bottom-[-24px] w-[1px] bg-white/10"></div>}
                  <div className={cn(
                    "w-6 h-6 rounded-full bg-white/5 flex items-center justify-center relative z-10 shrink-0",
                    event.type === 'payment_received' ? "text-emerald-400" :
                    event.type === 'invoice_sent' ? "text-blue-400" :
                    event.type === 'hours_registered' ? "text-amber-400" : "text-indigo-400"
                  )}>
                    {event.type === 'payment_received' ? <CheckCircle2 className="w-3 h-3" /> :
                     event.type === 'invoice_sent' ? <FileText className="w-3 h-3" /> :
                     event.type === 'hours_registered' ? <Clock className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium capitalize">{event.type.replace('_', ' ')}</p>
                    <p className="text-xs text-white/30 mb-1">{event.date}</p>
                    <p className="text-xs text-white/50 leading-relaxed">{event.description}</p>
                  </div>
                </div>
              ))}
              {timelineEvents.filter(e => e.clientId === clientId).length === 0 && (
                <p className="text-xs text-white/20 italic">No events recorded yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Tables */}
        <div className="xl:col-span-2 space-y-8">
          {/* Registered Hours Table */}
          <div className="bg-[#080808] border border-white/5 rounded-3xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex justify-between items-center">
              <h3 className="font-semibold">Registered Hours</h3>
              <button className="text-xs text-blue-400 hover:underline cursor-pointer">Export CSV</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs text-white/30 uppercase tracking-wider border-b border-white/5">
                    <th className="px-6 py-4 font-medium whitespace-nowrap">Developer</th>
                    <th className="px-6 py-4 font-medium whitespace-nowrap">Date</th>
                    <th className="px-6 py-4 font-medium whitespace-nowrap">Hours</th>
                    <th className="px-6 py-4 font-medium min-w-[200px]">Task Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {clientTimesheets.map((ts) => (
                    <tr key={ts.id} className="hover:bg-white/5 transition-all">
                      <td className="px-6 py-4 text-sm font-medium whitespace-nowrap">{ts.developerName}</td>
                      <td className="px-6 py-4 text-sm text-white/40 whitespace-nowrap">{ts.date}</td>
                      <td className="px-6 py-4 text-sm font-mono whitespace-nowrap">{ts.hoursWorked}h</td>
                      <td className="px-6 py-4 text-sm text-white/60 max-w-xs">{ts.description}</td>
                    </tr>
                  ))}
                  {clientTimesheets.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-white/20 italic">No hours registered for this period.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Invoices Table */}
          <div className="bg-[#080808] border border-white/5 rounded-3xl overflow-hidden">
            <div className="p-6 border-b border-white/5 flex justify-between items-center">
              <h3 className="font-semibold">Invoices</h3>
              <button className="bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl text-xs font-medium hover:bg-white/10 transition-all cursor-pointer">
                Create Invoice
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs text-white/30 uppercase tracking-wider border-b border-white/5">
                    <th className="px-6 py-4 font-medium whitespace-nowrap">Invoice ID</th>
                    <th className="px-6 py-4 font-medium whitespace-nowrap">Amount</th>
                    <th className="px-6 py-4 font-medium whitespace-nowrap">Sent Date</th>
                    <th className="px-6 py-4 font-medium whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {clientInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-white/5 transition-all">
                      <td className="px-6 py-4 text-sm font-mono text-blue-400 whitespace-nowrap">#INV-{inv.id.toUpperCase()}</td>
                      <td className="px-6 py-4 text-sm font-bold whitespace-nowrap">${inv.amount.toLocaleString()}</td>
                      <td className="px-6 py-4 text-sm text-white/40 whitespace-nowrap">{inv.dateSent}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={cn(
                          "text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md",
                          inv.status === 'Paid' ? "bg-emerald-500/10 text-emerald-400" :
                          inv.status === 'Open' ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"
                        )}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {clientInvoices.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-white/20 italic">No invoices found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DevelopersPage() {
  return (
    <div className="space-y-8 pb-8 text-white">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Developers</h2>
          <p className="text-white/40 mt-1">Monitor allocation and performance of your engineering team.</p>
        </div>
        <button className="bg-blue-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-500 transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20 cursor-pointer">
          <Plus className="w-4 h-4" />
          Onboard Developer
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
        {developers.map((dev, i) => (
          <motion.div 
            key={dev.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-[#080808] border border-white/5 rounded-2xl p-6 group hover:border-blue-500/30 transition-all"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-blue-600/20 flex items-center justify-center text-blue-400 font-bold text-lg shrink-0">
                {dev.name.split(' ').map(n => n[0]).join('')}
              </div>
              <div className="min-w-0">
                <h3 className="text-xl font-bold group-hover:text-blue-400 transition-colors truncate">{dev.name}</h3>
                <p className="text-xs text-white/40 mt-1 truncate">{dev.role}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-[10px] text-white/30 uppercase font-bold tracking-wider">Projects</p>
                <p className="text-lg font-bold">{dev.activeProjects}</p>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-[10px] text-white/30 uppercase font-bold tracking-wider">Rate</p>
                <p className="text-lg font-bold">${dev.hourlyRate}/h</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
                <span className="text-white/30">Weekly Capacity</span>
                <span className="text-blue-400">{dev.hoursThisWeek} / 40h</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <motion.div 
                  initial={{ width: 0 }}
                  animate={{ width: `${(dev.hoursThisWeek / 40) * 100}%` }}
                  transition={{ duration: 1, ease: "easeOut" }}
                  className={cn(
                    "h-full rounded-full",
                    dev.hoursThisWeek > 35 ? "bg-rose-500" : "bg-blue-600"
                  )}
                ></motion.div>
              </div>
            </div>

            <button className="w-full mt-8 py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 text-sm font-medium transition-all group-hover:bg-blue-600 group-hover:border-blue-600 group-hover:text-white cursor-pointer">
              View Profile
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function TimesheetsPage() {
  return (
    <div className="space-y-8 pb-8 text-white">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Timesheets</h2>
          <p className="text-white/40 mt-1">Centralized view of all developer work logs.</p>
        </div>
        <div className="flex gap-3">
          <button className="bg-white/5 border border-white/10 px-4 py-2 rounded-xl text-sm font-medium hover:bg-white/10 transition-all flex items-center gap-2 cursor-pointer">
            <History className="w-4 h-4" />
            History
          </button>
          <button className="bg-emerald-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-emerald-500 transition-all flex items-center gap-2 shadow-lg shadow-emerald-600/20 cursor-pointer">
            <CheckCircle2 className="w-4 h-4" />
            Approve All
          </button>
        </div>
      </div>

      <div className="bg-[#080808] border border-white/5 rounded-3xl overflow-hidden">
        <div className="p-6 border-b border-white/5 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <input 
              type="text" 
              placeholder="Filter by developer or client..." 
              className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-blue-500/50 transition-all text-white placeholder-white/30"
            />
          </div>
          <select className="bg-white/5 border border-white/10 rounded-xl text-sm px-4 py-2 focus:outline-none text-white cursor-pointer">
            <option className="bg-[#080808]">All Statuses</option>
            <option className="bg-[#080808]">Pending</option>
            <option className="bg-[#080808]">Approved</option>
            <option className="bg-[#080808]">Rejected</option>
          </select>
        </div>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left min-w-[800px]">
            <thead>
              <tr className="text-xs text-white/30 uppercase tracking-wider border-b border-white/5">
                <th className="px-8 py-5 font-medium whitespace-nowrap">Developer</th>
                <th className="px-8 py-5 font-medium whitespace-nowrap">Client</th>
                <th className="px-8 py-5 font-medium whitespace-nowrap">Week</th>
                <th className="px-8 py-5 font-medium whitespace-nowrap">Hours</th>
                <th className="px-8 py-5 font-medium whitespace-nowrap">Status</th>
                <th className="px-8 py-5 font-medium text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {timesheets.map((ts) => (
                <tr key={ts.id} className="hover:bg-white/5 transition-all group">
                  <td className="px-8 py-5 text-sm font-medium whitespace-nowrap">{ts.developerName}</td>
                  <td className="px-8 py-5 text-sm text-white/60 whitespace-nowrap">{ts.clientName}</td>
                  <td className="px-8 py-5 text-sm text-white/40 whitespace-nowrap">{ts.week}</td>
                  <td className="px-8 py-5 text-sm font-mono font-bold whitespace-nowrap">{ts.hoursWorked}h</td>
                  <td className="px-8 py-5 whitespace-nowrap">
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md",
                      ts.status === 'Approved' ? "bg-emerald-500/10 text-emerald-400" :
                      ts.status === 'Pending' ? "bg-amber-500/10 text-amber-400" : "bg-rose-500/10 text-rose-400"
                    )}>
                      {ts.status}
                    </span>
                  </td>
                  <td className="px-8 py-5 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-all">
                      <button className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-all cursor-pointer">
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button className="p-1.5 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer">
                        <AlertCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InvoicesPage() {
  return (
    <div className="space-y-8 pb-8 text-white">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Invoices</h2>
          <p className="text-white/40 mt-1">Track payments, billing, and financial status.</p>
        </div>
        <button className="bg-blue-600 px-4 py-2 rounded-xl text-sm font-medium hover:bg-blue-500 transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20 cursor-pointer">
          <Plus className="w-4 h-4" />
          New Invoice
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-[#080808] border border-white/5 p-5 rounded-2xl">
          <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">Total Outstanding</p>
          <p className="text-2xl font-bold">$23,400</p>
          <div className="mt-2 flex items-center gap-1 text-rose-400 text-[10px] font-bold">
            <AlertCircle className="w-3 h-3" />
            3 Overdue Invoices
          </div>
        </div>
        <div className="bg-[#080808] border border-white/5 p-5 rounded-2xl">
          <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">Paid This Month</p>
          <p className="text-2xl font-bold">$48,200</p>
          <div className="mt-2 flex items-center gap-1 text-emerald-400 text-[10px] font-bold">
            <CheckCircle2 className="w-3 h-3" />
            +12% from last month
          </div>
        </div>
        <div className="bg-[#080808] border border-white/5 p-5 rounded-2xl">
          <p className="text-white/40 text-xs font-bold uppercase tracking-wider mb-1">Projected Revenue</p>
          <p className="text-2xl font-bold">$85,000</p>
          <div className="mt-2 flex items-center gap-1 text-blue-400 text-[10px] font-bold">
            <History className="w-3 h-3" />
            Based on active contracts
          </div>
        </div>
      </div>

      <div className="bg-[#080808] border border-white/5 rounded-3xl overflow-hidden w-full">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left min-w-[900px]">
            <thead>
              <tr className="text-xs text-white/30 uppercase tracking-wider border-b border-white/5">
                <th className="px-8 py-5 font-medium whitespace-nowrap">Client</th>
                <th className="px-8 py-5 font-medium whitespace-nowrap">Amount</th>
                <th className="px-8 py-5 font-medium whitespace-nowrap">Status</th>
                <th className="px-8 py-5 font-medium whitespace-nowrap">Date Sent</th>
                <th className="px-8 py-5 font-medium whitespace-nowrap">Deadline</th>
                <th className="px-8 py-5 font-medium text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-white/5 transition-all group">
                  <td className="px-8 py-5 whitespace-nowrap">
                    <p className="text-sm font-bold">{inv.clientName}</p>
                    <p className="text-[10px] font-mono text-white/30">#INV-{inv.id.toUpperCase()}</p>
                  </td>
                  <td className="px-8 py-5 text-sm font-bold whitespace-nowrap">${inv.amount.toLocaleString()}</td>
                  <td className="px-8 py-5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        inv.status === 'Paid' ? "bg-emerald-500" :
                        inv.status === 'Open' ? "bg-amber-500" : "bg-rose-500"
                      )}></div>
                      <span className={cn(
                        "text-xs font-medium",
                        inv.status === 'Paid' ? "text-emerald-400" :
                        inv.status === 'Open' ? "text-amber-400" : "text-rose-400"
                      )}>
                        {inv.status}
                      </span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-sm text-white/40 whitespace-nowrap">{inv.dateSent}</td>
                  <td className="px-8 py-5 text-sm text-white/40 whitespace-nowrap">{inv.paymentDeadline}</td>
                  <td className="px-8 py-5 text-right whitespace-nowrap">
                    <button className="p-2 rounded-xl hover:bg-white/10 text-white/30 hover:text-white transition-all cursor-pointer">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

