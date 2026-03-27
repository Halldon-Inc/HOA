"use client";

import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  RotateCcw,
  Download,
} from "lucide-react";
import { FilterState, DEFAULT_FILTERS } from "@/types/hoa";
import { allCounties } from "@/data/hoas";

interface FilterSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  filters: FilterState;
  onUpdateFilter: <K extends keyof FilterState>(
    key: K,
    value: FilterState[K]
  ) => void;
  onReset: () => void;
  onExport: () => void;
  resultCount: number;
}

export function FilterSidebar({
  isOpen,
  onToggle,
  filters,
  onUpdateFilter,
  onReset,
  onExport,
  resultCount,
}: FilterSidebarProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  // Expose search ref for keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        document.activeElement?.tagName !== "INPUT"
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const hasActiveFilters =
    filters.search !== DEFAULT_FILTERS.search ||
    filters.exteriorType !== DEFAULT_FILTERS.exteriorType ||
    filters.county !== DEFAULT_FILTERS.county ||
    filters.yearMin !== DEFAULT_FILTERS.yearMin ||
    filters.yearMax !== DEFAULT_FILTERS.yearMax ||
    filters.unitMin !== DEFAULT_FILTERS.unitMin ||
    filters.unitMax !== DEFAULT_FILTERS.unitMax;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="absolute top-4 left-4 z-20 flex items-center justify-center rounded-xl bg-slate-800/90 backdrop-blur-xl border border-slate-700/50 p-2.5 text-white hover:bg-slate-700/90 transition-colors md:hidden shadow-lg"
        aria-label={isOpen ? "Close filters" : "Open filters"}
      >
        {isOpen ? (
          <ChevronLeft className="h-5 w-5" />
        ) : (
          <Filter className="h-5 w-5" />
        )}
      </button>

      {/* Sidebar */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Mobile overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-30 md:hidden"
              onClick={onToggle}
            />

            <motion.div
              initial={{ x: -320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -320, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed top-0 left-0 z-40 flex h-full w-80 flex-col bg-slate-900/95 backdrop-blur-2xl border-r border-slate-700/50 shadow-2xl md:relative md:z-10"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-700/50 px-5 py-4">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-slate-400" />
                  <h2 className="text-sm font-semibold text-white">Filters</h2>
                  {hasActiveFilters && (
                    <span className="flex h-2 w-2 rounded-full bg-orange-500" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {hasActiveFilters && (
                    <button
                      onClick={onReset}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Reset
                    </button>
                  )}
                  <button
                    onClick={onToggle}
                    className="hidden md:flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Scrollable content */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {/* Search */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Search
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      ref={searchRef}
                      type="text"
                      placeholder="Name, city, or zip..."
                      value={filters.search}
                      onChange={(e) =>
                        onUpdateFilter("search", e.target.value)
                      }
                      className="w-full rounded-xl bg-slate-800/80 border border-slate-700/50 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all"
                    />
                    {filters.search && (
                      <button
                        onClick={() => onUpdateFilter("search", "")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-600">
                    Press / to focus
                  </p>
                </div>

                {/* Exterior Type */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Exterior Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { value: "all", label: "All", color: "bg-slate-700" },
                        {
                          value: "stucco",
                          label: "Stucco",
                          color: "bg-orange-500",
                        },
                        {
                          value: "non-stucco",
                          label: "Non-Stucco",
                          color: "bg-blue-500",
                        },
                        {
                          value: "mixed",
                          label: "Mixed",
                          color: "bg-purple-500",
                        },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() =>
                          onUpdateFilter("exteriorType", opt.value)
                        }
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
                          filters.exteriorType === opt.value
                            ? "border-slate-500 bg-slate-700/80 text-white"
                            : "border-slate-700/50 bg-slate-800/50 text-slate-400 hover:text-white hover:bg-slate-800"
                        }`}
                      >
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${opt.color}`}
                        />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* County */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    County
                  </label>
                  <select
                    value={filters.county}
                    onChange={(e) => onUpdateFilter("county", e.target.value)}
                    className="w-full rounded-xl bg-slate-800/80 border border-slate-700/50 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-orange-500/50 transition-all appearance-none cursor-pointer"
                  >
                    <option value="all">All Counties</option>
                    {allCounties.map((c) => (
                      <option key={c} value={c}>
                        {c} County
                      </option>
                    ))}
                  </select>
                </div>

                {/* Year Built Range */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Year Built
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1975}
                      max={2015}
                      value={filters.yearMin}
                      onChange={(e) =>
                        onUpdateFilter("yearMin", parseInt(e.target.value, 10) || 1975)
                      }
                      className="w-full rounded-xl bg-slate-800/80 border border-slate-700/50 px-3 py-2 text-sm text-white text-center focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all"
                    />
                    <span className="text-slate-500 text-xs">to</span>
                    <input
                      type="number"
                      min={1975}
                      max={2015}
                      value={filters.yearMax}
                      onChange={(e) =>
                        onUpdateFilter("yearMax", parseInt(e.target.value, 10) || 2015)
                      }
                      className="w-full rounded-xl bg-slate-800/80 border border-slate-700/50 px-3 py-2 text-sm text-white text-center focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all"
                    />
                  </div>
                </div>

                {/* Unit Count Range */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-400">
                    Unit Count
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={20}
                      max={500}
                      value={filters.unitMin}
                      onChange={(e) =>
                        onUpdateFilter("unitMin", parseInt(e.target.value, 10) || 20)
                      }
                      className="w-full rounded-xl bg-slate-800/80 border border-slate-700/50 px-3 py-2 text-sm text-white text-center focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all"
                    />
                    <span className="text-slate-500 text-xs">to</span>
                    <input
                      type="number"
                      min={20}
                      max={500}
                      value={filters.unitMax}
                      onChange={(e) =>
                        onUpdateFilter("unitMax", parseInt(e.target.value, 10) || 500)
                      }
                      className="w-full rounded-xl bg-slate-800/80 border border-slate-700/50 px-3 py-2 text-sm text-white text-center focus:outline-none focus:ring-2 focus:ring-orange-500/50 transition-all"
                    />
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="border-t border-slate-700/50 px-5 py-4 space-y-3">
                <div className="text-center">
                  <span className="text-xs text-slate-400">
                    Showing{" "}
                    <span className="font-semibold text-white">
                      {resultCount}
                    </span>{" "}
                    communities
                  </span>
                </div>
                <button
                  onClick={onExport}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 hover:bg-orange-600 px-4 py-2.5 text-sm font-medium text-white transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Collapsed toggle (desktop) */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="absolute top-4 left-4 z-20 hidden md:flex items-center justify-center rounded-xl bg-slate-800/90 backdrop-blur-xl border border-slate-700/50 p-2.5 text-white hover:bg-slate-700/90 transition-colors shadow-lg"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </>
  );
}
