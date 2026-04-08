import React from 'react';
import { LayoutDashboard, Users, UserCircle, Clock, FileText, Settings, LogOut, Database } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Screen, UserRole } from '../../types';

interface SidebarProps {
  currentScreen: Screen;
  userRole: UserRole;
  onNavigate: (s: Screen) => void;
  onLogout: () => void;
}

export function Sidebar({ currentScreen, userRole, onNavigate, onLogout }: SidebarProps) {
  const adminMenuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'clients', label: 'Clients', icon: Users },
    { id: 'developers', label: 'Developers', icon: UserCircle },
    { id: 'cv-database', label: 'CV Database', icon: Database },
    { id: 'timesheets', label: 'Timesheets', icon: Clock },
    { id: 'invoices', label: 'Invoices', icon: FileText },
  ];

  const devMenuItems = [
    { id: 'dev-dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'dev-profile', label: 'My Profile', icon: UserCircle },
    { id: 'timesheets', label: 'Timesheets', icon: Clock },
    { id: 'dev-documents', label: 'Documents', icon: FileText },
  ];

  const menuItems = userRole === 'admin' ? adminMenuItems : devMenuItems;

  return (
    <aside className="w-64 border-r border-white/5 flex flex-col bg-[#080808]">
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
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group",
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
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-white/50 hover:text-white hover:bg-white/5 transition-all">
          <Settings className="w-5 h-5 text-white/30" />
          Settings
        </button>
        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-red-400/70 hover:text-red-400 hover:bg-red-400/5 transition-all"
        >
          <LogOut className="w-5 h-5" />
          Logout
        </button>
      </div>

      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5">
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center font-bold",
            userRole === 'admin' ? "bg-blue-600/20 text-blue-400" : "bg-emerald-600/20 text-emerald-400"
          )}>
            {userRole === 'admin' ? 'T1' : 'AR'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{userRole === 'admin' ? 'Test one' : 'Alex Rivera'}</p>
            <p className="text-[10px] text-white/40 truncate">{userRole === 'admin' ? 'Operations Lead' : 'Senior Developer'}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
