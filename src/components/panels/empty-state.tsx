"use client";

import { motion } from "framer-motion";
import { SearchX } from "lucide-react";

interface EmptyStateProps {
  onReset: () => void;
}

export function EmptyState({ onReset }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-4 rounded-2xl bg-slate-800/90 backdrop-blur-xl border border-slate-700/50 px-8 py-10 shadow-2xl text-center max-w-sm"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-700/60">
        <SearchX className="h-8 w-8 text-slate-400" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white">No Results Found</h3>
        <p className="mt-1 text-sm text-slate-400">
          No HOA communities match your current filters. Try adjusting your
          search criteria or reset all filters.
        </p>
      </div>
      <button
        onClick={onReset}
        className="rounded-xl bg-orange-500 hover:bg-orange-600 px-6 py-2.5 text-sm font-medium text-white transition-colors"
      >
        Reset Filters
      </button>
    </motion.div>
  );
}
