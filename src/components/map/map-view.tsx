"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { HOA } from "@/types/hoa";
import dynamic from "next/dynamic";

interface MapViewProps {
  hoas: HOA[];
  selectedHoa: HOA | null;
  onSelectHoa: (hoa: HOA) => void;
  onMapReady: () => void;
}

// Color mapping
const TYPE_COLORS: Record<string, string> = {
  stucco: "#F97316",
  "non-stucco": "#3B82F6",
  mixed: "#A855F7",
};

// Leaflet must be client-only (no SSR)
const LeafletMap = dynamic(() => import("./leaflet-map"), { ssr: false });

export function MapView({
  hoas,
  selectedHoa,
  onSelectHoa,
  onMapReady,
}: MapViewProps) {
  return (
    <div className="relative h-full w-full">
      <LeafletMap
        hoas={hoas}
        selectedHoa={selectedHoa}
        onSelectHoa={onSelectHoa}
        onMapReady={onMapReady}
        typeColors={TYPE_COLORS}
      />

      {/* Legend */}
      <div className="absolute bottom-8 left-4 z-[1000] rounded-xl bg-slate-800/90 backdrop-blur-xl border border-slate-700/50 px-4 py-3 shadow-lg">
        <p className="text-[10px] font-medium text-slate-400 mb-2">Legend</p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-orange-500" />
            <span className="text-xs text-slate-300">Stucco</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-blue-500" />
            <span className="text-xs text-slate-300">Non-Stucco</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-purple-500" />
            <span className="text-xs text-slate-300">Mixed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
