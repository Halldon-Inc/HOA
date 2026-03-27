"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { HOA, FilterState, DEFAULT_FILTERS } from "@/types/hoa";
import { hoaData } from "@/data/hoas";

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return true;
  // Check each word in the query
  const words = q.split(/\s+/);
  return words.every((word) => lower.includes(word));
}

export function useFilters() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);

  // Read URL params on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const newFilters = { ...DEFAULT_FILTERS };
    if (params.get("search")) newFilters.search = params.get("search")!;
    if (params.get("type") && ["all", "stucco", "non-stucco", "mixed"].includes(params.get("type")!)) {
      newFilters.exteriorType = params.get("type") as FilterState["exteriorType"];
    }
    if (params.get("county")) newFilters.county = params.get("county")!;
    if (params.get("yearMin")) newFilters.yearMin = parseInt(params.get("yearMin")!, 10);
    if (params.get("yearMax")) newFilters.yearMax = parseInt(params.get("yearMax")!, 10);
    if (params.get("unitMin")) newFilters.unitMin = parseInt(params.get("unitMin")!, 10);
    if (params.get("unitMax")) newFilters.unitMax = parseInt(params.get("unitMax")!, 10);
    setFilters(newFilters);
  }, []);

  // Sync filters to URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.exteriorType !== "all") params.set("type", filters.exteriorType);
    if (filters.county !== "all") params.set("county", filters.county);
    if (filters.yearMin !== DEFAULT_FILTERS.yearMin) params.set("yearMin", String(filters.yearMin));
    if (filters.yearMax !== DEFAULT_FILTERS.yearMax) params.set("yearMax", String(filters.yearMax));
    if (filters.unitMin !== DEFAULT_FILTERS.unitMin) params.set("unitMin", String(filters.unitMin));
    if (filters.unitMax !== DEFAULT_FILTERS.unitMax) params.set("unitMax", String(filters.unitMax));

    const qs = params.toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, [filters]);

  const filteredHoas = useMemo(() => {
    return hoaData.filter((hoa) => {
      // Search filter
      if (filters.search) {
        const searchFields = `${hoa.name} ${hoa.city} ${hoa.zip} ${hoa.county} ${hoa.address}`;
        if (!fuzzyMatch(searchFields, filters.search)) return false;
      }

      // Exterior type filter
      if (filters.exteriorType !== "all" && hoa.exteriorType !== filters.exteriorType) {
        return false;
      }

      // County filter
      if (filters.county !== "all" && hoa.county !== filters.county) {
        return false;
      }

      // Year range filter
      if (hoa.yearBuilt < filters.yearMin || hoa.yearBuilt > filters.yearMax) {
        return false;
      }

      // Unit count range filter
      if (hoa.unitCount < filters.unitMin || hoa.unitCount > filters.unitMax) {
        return false;
      }

      return true;
    });
  }, [filters]);

  const updateFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const filteredStats = useMemo(
    () => ({
      total: filteredHoas.length,
      stucco: filteredHoas.filter((h) => h.exteriorType === "stucco").length,
      nonStucco: filteredHoas.filter((h) => h.exteriorType === "non-stucco").length,
      mixed: filteredHoas.filter((h) => h.exteriorType === "mixed").length,
    }),
    [filteredHoas]
  );

  return {
    filters,
    filteredHoas,
    filteredStats,
    updateFilter,
    resetFilters,
  };
}
