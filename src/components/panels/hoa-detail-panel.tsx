"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  MapPin,
  Building2,
  Calendar,
  Users,
  Copy,
  Phone,
  Globe,
  Briefcase,
  Hash,
  Layers,
} from "lucide-react";
import { HOA } from "@/types/hoa";
import { useToast } from "@/components/ui/toast-notification";

interface HOADetailPanelProps {
  hoa: HOA | null;
  onClose: () => void;
}

function getExteriorBadge(type: string) {
  switch (type) {
    case "stucco":
      return {
        bg: "bg-orange-500/20",
        text: "text-orange-400",
        border: "border-orange-500/30",
        label: "Stucco",
      };
    case "non-stucco":
      return {
        bg: "bg-blue-500/20",
        text: "text-blue-400",
        border: "border-blue-500/30",
        label: "Non-Stucco",
      };
    case "mixed":
      return {
        bg: "bg-purple-500/20",
        text: "text-purple-400",
        border: "border-purple-500/30",
        label: "Mixed",
      };
    default:
      return {
        bg: "bg-slate-500/20",
        text: "text-slate-400",
        border: "border-slate-500/30",
        label: "Unknown",
      };
  }
}

export function HOADetailPanel({ hoa, onClose }: HOADetailPanelProps) {
  const badge = hoa ? getExteriorBadge(hoa.exteriorType) : null;
  const { showToast } = useToast();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard`);
  };

  return (
    <AnimatePresence>
      {hoa && badge && (
        <>
          {/* Mobile overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-30 md:hidden"
            onClick={onClose}
          />

          <motion.div
            initial={{ x: 400, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 400, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed top-0 right-0 z-40 flex h-full w-full max-w-md flex-col bg-slate-900/95 backdrop-blur-2xl border-l border-slate-700/50 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between border-b border-slate-700/50 px-6 py-5">
              <div className="min-w-0 flex-1 pr-4">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold ${badge.bg} ${badge.text} ${badge.border}`}
                  >
                    {badge.label}
                  </span>
                  {hoa.nearbyStuccoCount ? (
                    <span className="inline-block rounded-md border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-400">
                      {hoa.nearbyStuccoCount} stucco nearby
                    </span>
                  ) : null}
                </div>
                <h2 className="text-lg font-bold text-white leading-tight">
                  {hoa.name}
                </h2>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                  <MapPin className="h-3 w-3" />
                  {hoa.municipality || hoa.city || "NJ"}, {hoa.county} County, NJ
                </p>
              </div>
              <button
                onClick={onClose}
                className="flex shrink-0 items-center justify-center rounded-xl bg-slate-800 p-2 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Quick stats grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium">County</span>
                  </div>
                  <p className="text-lg font-bold text-white">{hoa.county}</p>
                </div>
                <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                    <Calendar className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium">
                      {hoa.dateFormed ? "Formed" : "Year Built"}
                    </span>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {hoa.dateFormed || hoa.yearBuilt || "N/A"}
                  </p>
                </div>
                {hoa.entityType && (
                  <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-3">
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                      <Building2 className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Entity Type</span>
                    </div>
                    <p className="text-lg font-bold text-white">{hoa.entityType}</p>
                  </div>
                )}
                {hoa.entityId && (
                  <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-3">
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                      <Hash className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Entity ID</span>
                    </div>
                    <button
                      onClick={() => copyToClipboard(hoa.entityId!, "Entity ID")}
                      className="group flex items-center gap-1"
                    >
                      <p className="text-sm font-bold text-white">
                        {hoa.entityId}
                      </p>
                      <Copy className="h-3 w-3 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  </div>
                )}
                {(hoa.parcelCount ?? 0) > 0 && (
                  <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-3">
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                      <Layers className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Parcels</span>
                    </div>
                    <p className="text-lg font-bold text-white">
                      {hoa.parcelCount}
                    </p>
                  </div>
                )}
                {(hoa.unitCount ?? 0) > 0 && (
                  <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-3">
                    <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                      <Users className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Units</span>
                    </div>
                    <p className="text-lg font-bold text-white">
                      {hoa.unitCount}
                    </p>
                  </div>
                )}
              </div>

              {/* Management Company */}
              {hoa.managementCompany && (
                <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-4 space-y-3">
                  <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                    <Briefcase className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium uppercase tracking-wider">
                      Likely Management Company
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {hoa.managementCompany}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {hoa.managementPhone && (
                      <a
                        href={`tel:${hoa.managementPhone}`}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                      >
                        <Phone className="h-3 w-3" />
                        {hoa.managementPhone}
                      </a>
                    )}
                    {hoa.managementWebsite && (
                      <a
                        href={`https://${hoa.managementWebsite}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-500/20 transition-colors"
                      >
                        <Globe className="h-3 w-3" />
                        {hoa.managementWebsite}
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Exterior Details */}
              {hoa.nearbyStuccoCount != null && hoa.nearbyStuccoCount > 0 && (
                <div className="rounded-xl bg-orange-500/5 border border-orange-500/20 px-4 py-3">
                  <p className="text-xs text-orange-300">
                    <strong>{hoa.nearbyStuccoCount}</strong> confirmed stucco
                    properties within 2km based on NJ tax assessor BLDG_DESC
                    records. This HOA community may contain stucco units
                    requiring maintenance.
                  </p>
                </div>
              )}

              {/* Coordinates */}
              <div className="rounded-xl bg-slate-800/40 border border-slate-700/30 px-4 py-3">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">
                  Coordinates
                </p>
                <button
                  onClick={() =>
                    copyToClipboard(
                      `${hoa.lat.toFixed(6)}, ${hoa.lng.toFixed(6)}`,
                      "Coordinates"
                    )
                  }
                  className="group flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
                >
                  <span>
                    {hoa.lat.toFixed(6)}, {hoa.lng.toFixed(6)}
                  </span>
                  <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
                {hoa.geoSource && (
                  <p className="text-[10px] text-slate-600 mt-1">
                    Source: {hoa.geoSource}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
