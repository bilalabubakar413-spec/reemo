import React from 'react';
import { motion } from 'framer-motion';
import { UserRole } from '../../types';

interface LoginScreenProps {
  onLogin: (e: React.FormEvent, role: UserRole) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#050505] text-white p-8">
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

        <div className="space-y-4">
          <button 
            onClick={(e) => onLogin(e, 'admin')}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-4 rounded-xl shadow-[0_0_30px_rgba(37,99,235,0.3)] transition-all active:scale-[0.98] flex flex-col items-center justify-center"
          >
            <span className="text-lg">Login as Admin</span>
            <span className="text-xs text-white/60 font-normal">Manage clients, devs, and invoices</span>
          </button>

          <button 
            onClick={(e) => onLogin(e, 'developer')}
            className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold py-4 rounded-xl transition-all active:scale-[0.98] flex flex-col items-center justify-center"
          >
            <span className="text-lg">Login as Developer</span>
            <span className="text-xs text-white/40 font-normal">View my projects and log hours</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
