"use client";

import { useEffect, useRef, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { HOA } from "@/types/hoa";

interface LeafletMapProps {
  hoas: HOA[];
  selectedHoa: HOA | null;
  onSelectHoa: (hoa: HOA) => void;
  onMapReady: () => void;
  typeColors: Record<string, string>;
}

function createCircleIcon(color: string, size: number = 18) {
  return L.divIcon({
    className: "custom-marker",
    html: `<div style="
      width: ${size}px; height: ${size}px;
      border-radius: 50%;
      background: ${color};
      border: 2px solid rgba(255,255,255,0.5);
      box-shadow: 0 0 10px ${color}, 0 0 20px ${color}60;
      opacity: 0.95;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function LeafletMap({
  hoas,
  selectedHoa,
  onSelectHoa,
  onMapReady,
  typeColors,
}: LeafletMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [40.0583, -74.4057],
      zoom: 8,
      minZoom: 7,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: true,
    });

    // Dark tile layer (CartoDB dark matter)
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 20,
      }
    ).addTo(map);

    // Zoom control top-right
    L.control.zoom({ position: "topright" }).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    onMapReady();

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers
  useEffect(() => {
    if (!mapRef.current || !markersRef.current) return;

    markersRef.current.clearLayers();

    // For performance with many markers, use canvas rendering
    for (const hoa of hoas) {
      if (!hoa.lat || !hoa.lng) continue;

      const color = typeColors[hoa.exteriorType] || "#94A3B8";
      const icon = createCircleIcon(color);

      const marker = L.marker([hoa.lat, hoa.lng], { icon }).addTo(
        markersRef.current!
      );

      marker.on("click", () => {
        onSelectHoa(hoa);
      });

      // Tooltip on hover
      marker.bindTooltip(
        `<div style="font-size:12px;font-weight:600;">${hoa.name}</div>
         <div style="font-size:11px;opacity:0.7;">${hoa.municipality || ""} ${hoa.county ? "/ " + hoa.county : ""}</div>
         <div style="font-size:11px;color:${color};font-weight:600;">${hoa.exteriorType}</div>`,
        {
          direction: "top",
          offset: [0, -8],
          className: "hoa-tooltip",
        }
      );
    }
  }, [hoas, onSelectHoa, typeColors]);

  // Fly to selected
  useEffect(() => {
    if (!mapRef.current || !selectedHoa) return;
    mapRef.current.flyTo([selectedHoa.lat, selectedHoa.lng], 14, {
      duration: 1,
    });
  }, [selectedHoa]);

  return (
    <>
      <style jsx global>{`
        .hoa-tooltip {
          background: rgba(15, 23, 42, 0.95) !important;
          border: 1px solid rgba(51, 65, 85, 0.5) !important;
          border-radius: 8px !important;
          padding: 6px 10px !important;
          color: #e2e8f0 !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
        }
        .hoa-tooltip::before {
          border-top-color: rgba(15, 23, 42, 0.95) !important;
        }
        .leaflet-control-zoom a {
          background: rgba(30, 41, 59, 0.9) !important;
          color: #e2e8f0 !important;
          border: 1px solid rgba(51, 65, 85, 0.5) !important;
        }
        .leaflet-control-zoom a:hover {
          background: rgba(51, 65, 85, 0.9) !important;
        }
        .custom-marker {
          background: none !important;
          border: none !important;
        }
      `}</style>
      <div ref={containerRef} className="h-full w-full" />
    </>
  );
}
