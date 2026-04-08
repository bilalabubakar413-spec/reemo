import React from 'react';
import { UserRole } from '../../types';
import { timesheets } from '../../mockData';
import { cn } from '../../utils/cn';

interface TimesheetsPageProps {
  userRole?: UserRole;
}

export function TimesheetsPage({ userRole }: TimesheetsPageProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Timesheets</h2>
          <p className="text-white/40 mt-1">{userRole === 'admin' ? "Approve and manage developer hours." : "Log and track your worked hours."}</p>
        </div>
        {userRole === 'developer' && (
          <button className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)]">
            Log Hours
          </button>
        )}
      </div>

      <div className="bg-[#080808] border border-white/5 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-sm uppercase tracking-wider text-white/40 bg-white/[0.02]">
                <th className="p-4 font-semibold">Week / Date</th>
                {userRole === 'admin' && <th className="p-4 font-semibold">Developer</th>}
                <th className="p-4 font-semibold">Client</th>
                <th className="p-4 font-semibold">Hours</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
              {timesheets.map((ts) => (
                <tr key={ts.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="p-4">
                    <p className="font-medium text-white/80">{ts.week}</p>
                    <p className="text-xs text-white/40">{ts.date}</p>
                  </td>
                  {userRole === 'admin' && (
                    <td className="p-4 font-medium text-blue-400">{ts.developerName}</td>
                  )}
                  <td className="p-4 text-white/70">{ts.clientName}</td>
                  <td className="p-4 font-semibold text-lg">{ts.hoursWorked}</td>
                  <td className="p-4">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium",
                      ts.status === 'Approved' ? "bg-emerald-500/10 text-emerald-400" :
                      ts.status === 'Pending' ? "bg-amber-500/10 text-amber-400" :
                      "bg-rose-500/10 text-rose-400"
                    )}>
                      {ts.status}
                    </span>
                  </td>
                  <td className="p-4">
                    {userRole === 'admin' && ts.status === 'Pending' ? (
                      <div className="flex gap-2">
                        <button className="px-3 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-colors">Approve</button>
                        <button className="px-3 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition-colors">Reject</button>
                      </div>
                    ) : (
                      <button className="text-blue-400 hover:text-blue-300 font-medium">View</button>
                    )}
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
