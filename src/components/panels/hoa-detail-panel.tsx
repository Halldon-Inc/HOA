"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  MapPin,
  Building2,
  Calendar,
  DollarSign,
  Users,
  Copy,
  Mail,
  Phone,
  Briefcase,
} from "lucide-react";
import { HOA, BoardMember } from "@/types/hoa";
import { useToast } from "@/components/ui/toast-notification";

interface HOADetailPanelProps {
  hoa: HOA | null;
  onClose: () => void;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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
        label: type,
      };
  }
}

function getRoleBadgeColor(title: string) {
  switch (title) {
    case "President":
      return "bg-orange-500/20 text-orange-400";
    case "Vice President":
      return "bg-blue-500/20 text-blue-400";
    case "Secretary":
      return "bg-emerald-500/20 text-emerald-400";
    case "Treasurer":
      return "bg-amber-500/20 text-amber-400";
    default:
      return "bg-slate-500/20 text-slate-400";
  }
}

function BoardMemberCard({ member }: { member: BoardMember }) {
  const { showToast } = useToast();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard`);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl bg-slate-800/60 border border-slate-700/40 p-4 space-y-3"
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-700 text-sm font-bold text-white">
          {getInitials(member.name)}
        </div>

        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-white truncate">
            {member.name}
          </h4>
          <span
            className={`inline-block mt-0.5 rounded-md px-2 py-0.5 text-[10px] font-medium ${getRoleBadgeColor(
              member.title
            )}`}
          >
            {member.title}
          </span>
        </div>
      </div>

      {/* Contact info */}
      <div className="space-y-1.5">
        {member.email && (
          <button
            onClick={() => copyToClipboard(member.email!, "Email")}
            className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
          >
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{member.email}</span>
            <Copy className="ml-auto h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
        {member.phone && (
          <button
            onClick={() => copyToClipboard(member.phone!, "Phone")}
            className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
          >
            <Phone className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{member.phone}</span>
            <Copy className="ml-auto h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
        {!member.email && !member.phone && (
          <p className="px-2 text-xs text-slate-600 italic">
            No contact info available
          </p>
        )}
      </div>
    </motion.div>
  );
}

export function HOADetailPanel({ hoa, onClose }: HOADetailPanelProps) {
  const badge = hoa ? getExteriorBadge(hoa.exteriorType) : null;

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
                </div>
                <h2 className="text-lg font-bold text-white truncate">
                  {hoa.name}
                </h2>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                  <MapPin className="h-3 w-3" />
                  {hoa.address}, {hoa.city}, NJ {hoa.zip}
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
                    <Users className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium">Units</span>
                  </div>
                  <p className="text-lg font-bold text-white">{hoa.unitCount}</p>
                </div>
                <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                    <Calendar className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium">Year Built</span>
                  </div>
                  <p className="text-lg font-bold text-white">{hoa.yearBuilt}</p>
                </div>
                <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                    <DollarSign className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium">Monthly Fee</span>
                  </div>
                  <p className="text-lg font-bold text-white">
                    {hoa.monthlyFee ? `$${hoa.monthlyFee}` : "N/A"}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium">County</span>
                  </div>
                  <p className="text-lg font-bold text-white">{hoa.county}</p>
                </div>
              </div>

              {/* Management Company */}
              {hoa.managementCompany && (
                <div className="rounded-xl bg-slate-800/60 border border-slate-700/40 px-4 py-3">
                  <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                    <Briefcase className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium">
                      Management Company
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white">
                    {hoa.managementCompany}
                  </p>
                </div>
              )}

              {/* Board Members */}
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                  <Building2 className="h-4 w-4 text-slate-400" />
                  Board Members
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                    {hoa.boardMembers.length}
                  </span>
                </h3>
                <div className="space-y-2">
                  {hoa.boardMembers.length > 0 ? (
                    hoa.boardMembers.map((member) => (
                      <BoardMemberCard key={member.id} member={member} />
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 italic">
                      Board member data not yet available for this HOA
                    </p>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
