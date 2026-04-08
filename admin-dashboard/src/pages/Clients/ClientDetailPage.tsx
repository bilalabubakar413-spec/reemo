import React from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Filter, Download, Plus, Clock, FileText, CheckCircle2, ArrowUpRight } from 'lucide-react';
import { cn } from '../../utils/cn';
import { clients, developers, invoices, timesheets } from '../../mockData';

interface ClientDetailPageProps {
  clientId: string;
  onBack: () => void;
}

export function ClientDetailPage({ clientId, onBack }: ClientDetailPageProps) {
  const client = clients.find(c => c.id === clientId);
  if (!client) return <div>Client not found</div>;

  const clientDevs = developers.filter(d => d.bookedForClient === client.name);
  const clientInvoices = invoices.filter(i => i.clientId === clientId);
  const clientTimesheets = timesheets.filter(t => t.clientId === clientId);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm text-white/50 mb-4">
        <button onClick={onBack} className="hover:text-white transition-colors">Clients</button>
        <ChevronRight className="w-4 h-4" />
        <span className="text-white">{client.name}</span>
      </div>

      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-4xl font-bold tracking-tight">{client.name}</h2>
          <p className="text-white/40 mt-2 text-lg">{client.industry} · Contact: {client.contactPerson} ({client.email})</p>
        </div>
        <div className="flex gap-3">
          <button className="bg-white/5 hover:bg-white/10 px-4 py-2 rounded-xl text-sm transition-all border border-white/10">
            Edit Details
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-[#080808] border border-white/5 p-6 rounded-3xl col-span-2">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Active Developers ({clientDevs.length})
            </h3>
            <button className="text-sm text-blue-400 hover:text-blue-300 font-medium">Assign Dev</button>
          </div>
          <div className="space-y-4">
            {clientDevs.length === 0 ? (
              <p className="text-white/30 text-center py-8">No active developers assigned.</p>
            ) : (
              clientDevs.map(dev => (
                <div key={dev.id} className="flex items-center justify-between p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-all border border-white/5">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold">
                      {dev.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium">{dev.name}</p>
                      <p className="text-xs text-white/40">{dev.role} · {dev.bookedAssignment}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{dev.hoursThisWeek} hrs this week</p>
                    <p className="text-xs text-emerald-400">Rate: €{dev.hourlyRate}/hr</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-[#080808] border border-white/5 p-6 rounded-3xl">
            <h3 className="font-semibold text-lg mb-4">Financial Overview</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-end pb-4 border-b border-white/5">
                <div>
                  <p className="text-xs text-white/40 mb-1">Total Billed YTD</p>
                  <p className="text-2xl font-bold">€45,200</p>
                </div>
                <ArrowUpRight className="text-emerald-400 w-5 h-5 mb-1" />
              </div>
              <div className="flex justify-between items-end pb-4 border-b border-white/5">
                <div>
                  <p className="text-xs text-white/40 mb-1">Outstanding</p>
                  <p className="text-2xl font-bold text-amber-400">€{clientInvoices.filter(i => i.status !== 'Paid').reduce((sum, i) => sum + i.amount, 0)}</p>
                </div>
              </div>
            </div>
            <button className="w-full mt-6 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 py-3 rounded-xl text-sm font-medium transition-colors">
              Generate Invoice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
