"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { HOA } from "@/types/hoa";
import { useFilters } from "@/hooks/use-filters";
import { exportToCSV } from "@/lib/export-csv";
import { StatsBar } from "@/components/panels/stats-bar";
import { FilterSidebar } from "@/components/panels/filter-sidebar";
import { HOADetailPanel } from "@/components/panels/hoa-detail-panel";
import { EmptyState } from "@/components/panels/empty-state";
import { MapLoadingSkeleton } from "@/components/map/loading-skeleton";

// Dynamic import for map (no SSR since Mapbox needs window)
const MapView = dynamic(
  () => import("@/components/map/map-view").then((mod) => mod.MapView),
  {
    ssr: false,
    loading: () => <MapLoadingSkeleton />,
  }
);

export default function HomePage() {
  const { filters, filteredHoas, filteredStats, updateFilter, resetFilters } =
    useFilters();
  const [selectedHoa, setSelectedHoa] = useState<HOA | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [showLoading, setShowLoading] = useState(true);

  const handleSelectHoa = useCallback((hoa: HOA) => {
    setSelectedHoa(hoa);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedHoa(null);
  }, []);

  const handleExport = useCallback(() => {
    exportToCSV(filteredHoas);
  }, [filteredHoas]);

  const handleMapReady = useCallback(() => {
    setMapReady(true);
    // Small delay for smooth transition
    setTimeout(() => setShowLoading(false), 500);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Esc to close detail panel
      if (e.key === "Escape") {
        if (selectedHoa) {
          handleCloseDetail();
          return;
        }
      }

      // S to toggle satellite (when not typing)
      if (
        e.key === "s" &&
        !e.ctrlKey &&
        !e.metaKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "SELECT"
      ) {
        // Toggle is handled inside MapView
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedHoa, handleCloseDetail]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0F172A]">
      {/* Loading overlay */}
      {showLoading && <MapLoadingSkeleton />}

      {/* Stats bar (top) */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 hidden md:flex">
        <StatsBar
          total={filteredStats.total}
          stucco={filteredStats.stucco}
          nonStucco={filteredStats.nonStucco}
          mixed={filteredStats.mixed}
        />
      </div>

      {/* Filter sidebar */}
      <FilterSidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((prev) => !prev)}
        filters={filters}
        onUpdateFilter={updateFilter}
        onReset={resetFilters}
        onExport={handleExport}
        resultCount={filteredStats.total}
      />

      {/* Map */}
      <div className="absolute inset-0">
        <MapView
          hoas={filteredHoas}
          selectedHoa={selectedHoa}
          onSelectHoa={handleSelectHoa}
          onMapReady={handleMapReady}
        />
      </div>

      {/* Empty state overlay */}
      {mapReady && filteredHoas.length === 0 && (
        <EmptyState onReset={resetFilters} />
      )}

      {/* HOA detail panel (right) */}
      <HOADetailPanel hoa={selectedHoa} onClose={handleCloseDetail} />

      {/* Mobile stats (bottom bar) */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex md:hidden justify-center pb-4 px-4">
        <div className="flex items-center gap-2 rounded-xl bg-slate-800/90 backdrop-blur-xl border border-slate-700/50 px-4 py-2 shadow-lg text-xs">
          <span className="text-slate-400">
            <span className="font-semibold text-white">{filteredStats.total}</span> HOAs
          </span>
          <span className="text-slate-700">|</span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-orange-500" />
            <span className="text-orange-400 font-medium">{filteredStats.stucco}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-blue-400 font-medium">{filteredStats.nonStucco}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-purple-500" />
            <span className="text-purple-400 font-medium">{filteredStats.mixed}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
