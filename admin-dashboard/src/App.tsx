import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, AlertCircle } from 'lucide-react';

import { Screen, UserRole } from './types';
import { cn } from './utils/cn';

import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { LoginScreen } from './pages/Login/LoginScreen';
import { DashboardOverview } from './pages/Dashboard/DashboardOverview';
import { ClientsPage } from './pages/Clients/ClientsPage';
import { ClientDetailPage } from './pages/Clients/ClientDetailPage';
import { DevelopersPage } from './pages/Developers/DevelopersPage';
import { TimesheetsPage } from './pages/Timesheets/TimesheetsPage';
import { InvoicesPage } from './pages/Invoices/InvoicesPage';
import { CVDatabasePage } from './pages/CVDatabase/CVDatabasePage';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('login');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<UserRole>('admin');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleLogin = (e: React.FormEvent, role: UserRole = 'admin') => {
    e.preventDefault();
    setIsAuthenticated(true);
    setUserRole(role);
    setCurrentScreen(role === 'admin' ? 'dashboard' : 'dev-dashboard');
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentScreen('login');
  };

  const navigateToClientDetail = (id: string) => {
    setSelectedClientId(id);
    setCurrentScreen('client-detail');
  };

  if (currentScreen === 'login' || !isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="flex h-screen bg-[#050505] text-white font-sans selection:bg-blue-500/30">
      <Sidebar 
        currentScreen={currentScreen} 
        userRole={userRole}
        onNavigate={(screen) => setCurrentScreen(screen)} 
        onLogout={handleLogout}
      />

      <main className="flex-1 overflow-y-auto bg-[#050505]">
        <Header userRole={userRole} onOpenInfo={() => {}} />
        <div className="p-8 max-w-7xl mx-auto relative">
          <AnimatePresence>
            {notification && (
              <motion.div
                initial={{ opacity: 0, y: -20, x: '-50%' }}
                animate={{ opacity: 1, y: 0, x: '-50%' }}
                exit={{ opacity: 0, y: -20, x: '-50%' }}
                className={cn(
                  "fixed top-20 left-1/2 z-50 px-6 py-3 rounded-2xl shadow-2xl border flex items-center gap-3 backdrop-blur-md",
                  notification.type === 'success' ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                )}
              >
                {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <span className="text-sm font-medium">{notification.message}</span>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentScreen + (selectedClientId || '')}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            >
              {currentScreen === 'dashboard' && <DashboardOverview onNavigateToClients={() => setCurrentScreen('clients')} />}
              {currentScreen === 'dev-dashboard' && <div className="p-8 text-white/50 text-center">Developer Dashboard</div>}
              {currentScreen === 'dev-profile' && <div className="p-8 text-white/50 text-center">My Profile</div>}
              {currentScreen === 'dev-documents' && <div className="p-8 text-white/50 text-center">My Documents</div>}
              {currentScreen === 'clients' && <ClientsPage onSelectClient={navigateToClientDetail} showNotification={showNotification} />}
              {currentScreen === 'client-detail' && selectedClientId && (
                <ClientDetailPage clientId={selectedClientId} onBack={() => setCurrentScreen('clients')} />
              )}
              {currentScreen === 'developers' && <DevelopersPage showNotification={showNotification} />}
              {currentScreen === 'timesheets' && <TimesheetsPage userRole={userRole} />}
              {currentScreen === 'invoices' && <InvoicesPage />}
              {currentScreen === 'cv-database' && <CVDatabasePage showNotification={showNotification} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
