import React from 'react';
import { Upload, Download, Search, Filter } from 'lucide-react';
import { cn } from '../../utils/cn';
import { cvs } from '../../mockData';

interface CVDatabaseProps {
  showNotification: (m: string, t?: 'success' | 'error') => void;
}

export function CVDatabasePage({ showNotification }: CVDatabaseProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">CV Database</h2>
          <p className="text-white/40 mt-1">Manage and format developer resumes.</p>
        </div>
        <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)]">
          <Upload className="w-4 h-4" />
          Upload CV
        </button>
      </div>

      <div className="bg-[#080808] border border-white/5 rounded-3xl p-6">
        <div className="flex gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/30" />
            <input 
              type="text" 
              placeholder="Search by name or skills (e.g. React, Node)..."
              className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-blue-500/50 transition-all text-sm"
            />
          </div>
          <button className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 px-4 py-3 rounded-xl text-sm transition-all">
            <Filter className="w-4 h-4" />
            Filter
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-sm uppercase tracking-wider text-white/40 bg-white/[0.02]">
                <th className="p-4 font-semibold">Developer</th>
                <th className="p-4 font-semibold">Skills</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold">Uploaded</th>
                <th className="p-4 font-semibold text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-sm">
              {cvs.map((cv) => (
                <tr key={cv.id} className="hover:bg-white/[0.02] transition-colors group">
                  <td className="p-4 font-medium text-white/90">{cv.name}</td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-2">
                      {cv.skills.slice(0, 3).map((skill, index) => (
                        <span key={index} className="px-2 py-0.5 rounded-md bg-white/5 text-white/50 text-xs border border-white/5">
                          {skill}
                        </span>
                      ))}
                      {cv.skills.length > 3 && (
                        <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/40 text-xs border border-white/5 text-[10px] flex items-center">
                          +{cv.skills.length - 3}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium",
                      cv.status === 'Reemo Format' ? "bg-blue-500/10 text-blue-400" : "bg-white/10 text-white/60"
                    )}>
                      {cv.status}
                    </span>
                  </td>
                  <td className="p-4 text-white/40">{cv.uploadDate}</td>
                  <td className="p-4 text-center">
                    <div className="flex gap-2 justify-center">
                      <button className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-white/50 hover:text-white transition-colors">
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {cvs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-white/40">No CVs found. Upload one to get started.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
