import React from 'react';
import { Plus, Search, Filter, MoreVertical, Building2 } from 'lucide-react';
import { cn } from '../../utils/cn';
import { clients } from '../../mockData';

interface ClientsPageProps {
  onSelectClient: (id: string) => void;
  showNotification: (m: string, t?: 'success' | 'error') => void;
}

export function ClientsPage({ onSelectClient, showNotification }: ClientsPageProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Clients</h2>
          <p className="text-white/40 mt-1">Manage your client relationships and contracts.</p>
        </div>
        <div className="flex gap-3 w-full sm:w-auto">
          <button className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-2.5 rounded-xl text-sm transition-all flex-1 sm:flex-none justify-center">
            <Filter className="w-4 h-4" />
            Filter
          </button>
          <button 
            onClick={() => showNotification('New client modal would open')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)] flex-1 sm:flex-none justify-center"
          >
            <Plus className="w-4 h-4" />
            Add Client
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
        <input 
          type="text" 
          placeholder="Search by name, industry, or contact..."
          className="w-full bg-[#080808] border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:border-blue-500/50 transition-all text-lg"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {clients.map((client) => (
          <div 
            key={client.id}
            onClick={() => onSelectClient(client.id)}
            className="bg-[#080808] border border-white/5 rounded-3xl p-6 group hover:border-blue-500/30 transition-all cursor-pointer relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-emerald-400 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            
            <div className="flex justify-between items-start mb-6">
              <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5">
                <Building2 className="w-6 h-6 text-white/50" />
              </div>
              <button 
                onClick={(e) => { e.stopPropagation(); }}
                className="p-2 -mr-2 text-white/30 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
            </div>

            <h3 className="text-xl font-bold group-hover:text-blue-400 transition-colors">{client.name}</h3>
            <p className="text-sm text-white/40 mt-1">{client.industry}</p>

            <div className="mt-8 pt-6 border-t border-white/5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-1">Active Devs</p>
                <p className="font-medium text-lg">{client.developersCount}</p>
              </div>
              <div>
                <p className="text-[10px] text-white/30 uppercase tracking-wider font-semibold mb-1">Hours / Mo</p>
                <p className="font-medium text-lg">{client.totalHoursMonth}</p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <span className="text-sm text-white/40">{client.contactPerson}</span>
              <span className={cn(
                "text-xs px-2.5 py-1 rounded-full font-medium",
                client.invoiceStatus === 'Paid' ? "bg-emerald-500/10 text-emerald-400" :
                client.invoiceStatus === 'Open' ? "bg-amber-500/10 text-amber-400" :
                "bg-rose-500/10 text-rose-400"
              )}>
                {client.invoiceStatus}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
