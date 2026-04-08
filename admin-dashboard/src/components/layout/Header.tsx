import React from 'react';
import { Search, Bell } from 'lucide-react';
import { cn } from '../../utils/cn';
import { UserRole } from '../../types';

interface HeaderProps {
  userRole: UserRole;
  onOpenInfo: () => void;
}

export function Header({ userRole, onOpenInfo }: HeaderProps) {
  return (
    <header className="h-16 border-b border-white/5 flex items-center justify-between px-8 sticky top-0 bg-[#050505]/90 backdrop-blur-md z-10">
      <div className="relative w-96">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
        <input 
          type="text" 
          placeholder={userRole === 'admin' ? "Search clients, developers, invoices..." : "Search my tasks, timesheets..."}
          className="w-full bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-blue-500/50 transition-all"
        />
      </div>
      <div className="flex items-center gap-4">
        <button className="p-2 rounded-full hover:bg-white/5 text-white/50 transition-all relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2 w-2 h-2 bg-blue-500 rounded-full border-2 border-[#050505]"></span>
        </button>
        <div className="h-8 w-[1px] bg-white/10 mx-2"></div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium">{userRole === 'admin' ? 'Test' : 'Alex'}</p>
            <p className="text-xs text-white/40 capitalize">{userRole}</p>
          </div>
          <div className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
            userRole === 'admin' ? "bg-blue-600/20 text-blue-400" : "bg-emerald-600/20 text-emerald-400"
          )}>
            {userRole === 'admin' ? 'T' : 'A'}
          </div>
        </div>
      </div>
    </header>
  );
}
