import React from 'react';
import { motion } from 'framer-motion';
import { Users, UserCircle, Clock, ArrowUpRight } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { cn } from '../../utils/cn';
import { revenueData, hoursPerClientData } from '../../mockData';

interface DashboardProps {
  onNavigateToClients: () => void;
}

export function DashboardOverview({ onNavigateToClients }: DashboardProps) {
  const stats = [
    { label: 'Active Clients', value: '12', trend: '+2', icon: Users, color: 'text-blue-400' },
    { label: 'Developers', value: '48', trend: '+5', icon: UserCircle, color: 'text-emerald-400' },
    { label: 'Hours Registered', value: '2,450', trend: '+12%', icon: Clock, color: 'text-amber-400' },
    { label: 'Revenue (MTD)', value: '$72,400', trend: '+8.4%', icon: ArrowUpRight, color: 'text-blue-500' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-white/40 mt-1">Welcome back, Test. Here's what's happening today.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onNavigateToClients}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all"
          >
            Manage Clients
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div 
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-[#080808] border border-white/5 p-5 rounded-2xl hover:border-white/10 transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <div className={cn("p-2 rounded-xl bg-white/5 group-hover:bg-white/10 transition-all", stat.color)}>
                <stat.icon className="w-5 h-5" />
              </div>
              <span className={cn(
                "text-xs font-medium px-2 py-1 rounded-full",
                stat.trend.startsWith('+') ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
              )}>
                {stat.trend}
              </span>
            </div>
            <p className="text-white/40 text-sm font-medium">{stat.label}</p>
            <p className="text-2xl font-bold mt-1">{stat.value}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#080808] border border-white/5 p-6 rounded-3xl">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-semibold text-lg">Monthly Revenue</h3>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#ffffff40', fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#ffffff40', fontSize: 12 }} tickFormatter={(val) => `$${val/1000}k`} />
                <RechartsTooltip contentStyle={{ backgroundColor: '#080808', border: '1px solid #ffffff10', borderRadius: '12px' }} itemStyle={{ color: '#fff' }} />
                <Area type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#080808] border border-white/5 p-6 rounded-3xl">
          <div className="flex justify-between items-center mb-8">
            <h3 className="font-semibold text-lg">Hours Worked per Client</h3>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hoursPerClientData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" horizontal={false} />
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#ffffff60', fontSize: 11 }} width={100} />
                <RechartsTooltip cursor={{ fill: '#ffffff05' }} contentStyle={{ backgroundColor: '#080808', border: '1px solid #ffffff10', borderRadius: '12px' }} />
                <Bar dataKey="hours" radius={[0, 4, 4, 0]} barSize={20}>
                  {hoursPerClientData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#2563eb' : '#3b82f6'} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
