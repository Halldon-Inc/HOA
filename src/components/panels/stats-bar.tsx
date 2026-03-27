"use client";

import { motion } from "framer-motion";
import { Building2, CircleDot, Blend, LayoutGrid } from "lucide-react";

interface StatsBarProps {
  total: number;
  stucco: number;
  nonStucco: number;
  mixed: number;
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="flex items-center gap-3 rounded-xl bg-slate-800/80 backdrop-blur-xl border border-slate-700/50 px-4 py-2.5"
    >
      <div className={`flex items-center justify-center rounded-lg p-1.5 ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-slate-400 leading-none">{label}</p>
        <p className="text-lg font-semibold text-white leading-tight">{value.toLocaleString()}</p>
      </div>
    </motion.div>
  );
}

export function StatsBar({ total, stucco, nonStucco, mixed }: StatsBarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <StatCard
        icon={Building2}
        label="Total HOAs"
        value={total}
        color="bg-slate-700/60 text-slate-300"
        delay={0}
      />
      <StatCard
        icon={CircleDot}
        label="Stucco"
        value={stucco}
        color="bg-orange-500/20 text-orange-400"
        delay={0.05}
      />
      <StatCard
        icon={CircleDot}
        label="Non-Stucco"
        value={nonStucco}
        color="bg-blue-500/20 text-blue-400"
        delay={0.1}
      />
      <StatCard
        icon={Blend}
        label="Mixed"
        value={mixed}
        color="bg-purple-500/20 text-purple-400"
        delay={0.15}
      />
    </div>
  );
}
