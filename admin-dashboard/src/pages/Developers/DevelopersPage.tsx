import React from 'react';
import { Plus, Search, Filter, MoreVertical, Briefcase } from 'lucide-react';
import { cn } from '../../utils/cn';
import { developers } from '../../mockData';

interface DevelopersPageProps {
  showNotification: (m: string, t?: 'success' | 'error') => void;
}

export function DevelopersPage({ showNotification }: DevelopersPageProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Developers</h2>
          <p className="text-white/40 mt-1">Manage developers, assignments, and availability.</p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <button className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2.5 rounded-xl text-sm transition-all flex-1 sm:flex-none justify-center">
            <Filter className="w-4 h-4" />
            Filter
          </button>
          <button 
            onClick={() => showNotification('Invite developer modal')}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] flex-1 sm:flex-none justify-center"
          >
            <Plus className="w-4 h-4" />
            Add Developer
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
        <input 
          type="text" 
          placeholder="Search by name, role, or skills..."
          className="w-full bg-[#080808] border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-emerald-500/50 transition-all text-lg"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {developers.map((dev) => (
          <div 
            key={dev.id}
            onClick={() => {}}
            className="bg-[#080808] border border-white/5 rounded-3xl p-6 group hover:border-emerald-500/30 transition-all cursor-pointer relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            
            <div className="flex justify-between items-start mb-6">
              <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5 text-xl font-bold text-white/70">
                {dev.name.charAt(0)}
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); }}
                className="p-2 -mr-2 text-white/30 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>

            <h3 className="text-xl font-bold group-hover:text-emerald-400 transition-colors">{dev.name}</h3>
            <p className="text-sm text-white/40 mt-1">{dev.role}</p>

            <div className="mt-6 pt-4 border-t border-white/5 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Status</span>
                <span className={cn(
                  "font-medium. flex items-center gap-1.5",
                  dev.isBooked ? "text-emerald-400" : "text-amber-400"
                )}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", dev.isBooked ? "bg-emerald-400" : "bg-amber-400")}></span>
                  {dev.isBooked ? 'Booked' : 'Available'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Current Assignment</span>
                <span className="font-medium text-white/80">{dev.bookedForClient || 'None'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-white/40">Hourly Rate</span>
                <span className="font-medium text-white/80">€{dev.hourlyRate}/hr</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
