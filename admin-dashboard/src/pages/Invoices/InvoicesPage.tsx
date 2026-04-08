import React from 'react';
import { invoices } from '../../mockData';
import { cn } from '../../utils/cn';
import { Download, Plus } from 'lucide-react';

export function InvoicesPage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Invoices</h2>
          <p className="text-white/40 mt-1">Track and manage client billing.</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)]">
          <Plus className="w-4 h-4" />
          Create Invoice
        </button>
      </div>

      <div className="bg-[#080808] border border-white/5 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-sm uppercase tracking-wider text-white/40 bg-white/[0.02]">
                <th className="p-4 font-semibold">ID / Date</th>
                <th className="p-4 font-semibold">Client</th>
                <th className="p-4 font-semibold">Amount</th>
                <th className="p-4 font-semibold">Deadline</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold w-12 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="p-4">
                    <p className="font-medium text-blue-400">#{inv.id}</p>
                    <p className="text-xs text-white/40">Sent: {inv.dateSent}</p>
                  </td>
                  <td className="p-4 font-medium text-white/80">{inv.clientName}</td>
                  <td className="p-4 font-bold text-lg">€{(inv.amount).toLocaleString()}</td>
                  <td className="p-4 text-white/60">{inv.paymentDeadline}</td>
                  <td className="p-4">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium",
                      inv.status === 'Paid' ? "bg-emerald-500/10 text-emerald-400" :
                      inv.status === 'Open' ? "bg-amber-500/10 text-amber-400" :
                      "bg-rose-500/10 text-rose-400"
                    )}>
                      {inv.status}
                    </span>
                  </td>
                  <td className="p-4 text-center">
                    <button className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/50 hover:text-white transition-colors">
                      <Download className="w-4 h-4" />
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
