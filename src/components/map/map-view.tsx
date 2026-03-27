"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Satellite, Map as MapIcon, ZoomIn, ZoomOut } from "lucide-react";
import { HOA } from "@/types/hoa";

interface MapViewProps {
  hoas: HOA[];
  selectedHoa: HOA | null;
  onSelectHoa: (hoa: HOA) => void;
  onMapReady: () => void;
}

const MAPBOX_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "pk.placeholder_token_replace_me";

// Color mapping
const TYPE_COLORS: Record<string, string> = {
  stucco: "#F97316",
  "non-stucco": "#3B82F6",
  mixed: "#A855F7",
};

export function MapView({
  hoas,
  selectedHoa,
  onSelectHoa,
  onMapReady,
}: MapViewProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [isSatellite, setIsSatellite] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Build GeoJSON
  const geojson = useCallback((): GeoJSON.FeatureCollection => {
    return {
      type: "FeatureCollection",
      features: hoas.map((hoa) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [hoa.lng, hoa.lat],
        },
        properties: {
          id: hoa.id,
          name: hoa.name,
          exteriorType: hoa.exteriorType,
          unitCount: hoa.unitCount,
          city: hoa.city,
          county: hoa.county,
          color: TYPE_COLORS[hoa.exteriorType] || "#94A3B8",
        },
      })),
    };
  }, [hoas]);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const m = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-74.4057, 40.0583],
      zoom: 7.8,
      minZoom: 6,
      maxZoom: 17,
      attributionControl: false,
    });

    m.addControl(
      new mapboxgl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    m.on("load", () => {
      // Add the source
      m.addSource("hoas", {
        type: "geojson",
        data: geojson(),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 60,
      });

      // Cluster circles
      m.addLayer({
        id: "clusters",
        type: "circle",
        source: "hoas",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#F97316",
            10,
            "#A855F7",
            30,
            "#3B82F6",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            10,
            24,
            30,
            30,
          ],
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(255,255,255,0.15)",
        },
      });

      // Cluster count text
      m.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "hoas",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      // Individual HOA points
      m.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "hoas",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            5,
            12,
            8,
            16,
            12,
          ],
          "circle-opacity": 0.9,
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(255,255,255,0.2)",
        },
      });

      // Hover effect layer (larger, transparent)
      m.addLayer({
        id: "unclustered-point-hover",
        type: "circle",
        source: "hoas",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            10,
            12,
            14,
            16,
            18,
          ],
          "circle-opacity": 0.25,
        },
      });

      // Click on cluster to zoom
      m.on("click", "clusters", (e) => {
        const features = m.queryRenderedFeatures(e.point, {
          layers: ["clusters"],
        });
        if (!features.length) return;
        const clusterId = features[0].properties?.cluster_id;
        const source = m.getSource("hoas") as mapboxgl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          const geometry = features[0].geometry;
          if (geometry.type === "Point") {
            m.flyTo({
              center: geometry.coordinates as [number, number],
              zoom: zoom!,
              duration: 800,
            });
          }
        });
      });

      // Click on individual point
      m.on("click", "unclustered-point", (e) => {
        const features = m.queryRenderedFeatures(e.point, {
          layers: ["unclustered-point"],
        });
        if (!features.length) return;
        const feature = features[0];
        const hoaId = feature.properties?.id;
        const found = hoas.find((h) => h.id === hoaId);
        if (found) {
          onSelectHoa(found);
          const geometry = feature.geometry;
          if (geometry.type === "Point") {
            m.flyTo({
              center: geometry.coordinates as [number, number],
              zoom: Math.max(m.getZoom(), 13),
              duration: 1000,
              padding: { right: 400 },
            });
          }
        }
      });

      // Hover cursor
      m.on("mouseenter", "unclustered-point", (e) => {
        m.getCanvas().style.cursor = "pointer";
        const features = m.queryRenderedFeatures(e.point, {
          layers: ["unclustered-point"],
        });
        if (features.length) {
          m.setFilter("unclustered-point-hover", [
            "==",
            ["get", "id"],
            features[0].properties?.id || "",
          ]);
        }
      });

      m.on("mouseleave", "unclustered-point", () => {
        m.getCanvas().style.cursor = "";
        m.setFilter("unclustered-point-hover", [
          "==",
          ["get", "id"],
          "",
        ]);
      });

      m.on("mouseenter", "clusters", () => {
        m.getCanvas().style.cursor = "pointer";
      });

      m.on("mouseleave", "clusters", () => {
        m.getCanvas().style.cursor = "";
      });

      setMapLoaded(true);
      onMapReady();
    });

    map.current = m;

    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update data when hoas change
  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const source = map.current.getSource("hoas") as mapboxgl.GeoJSONSource;
    if (source) {
      source.setData(geojson());
    }
  }, [hoas, geojson, mapLoaded]);

  // Fly to selected HOA
  useEffect(() => {
    if (!map.current || !selectedHoa || !mapLoaded) return;
    map.current.flyTo({
      center: [selectedHoa.lng, selectedHoa.lat],
      zoom: Math.max(map.current.getZoom(), 13),
      duration: 1000,
      padding: { right: 400 },
    });
  }, [selectedHoa, mapLoaded]);

  // Toggle satellite
  const toggleSatellite = useCallback(() => {
    if (!map.current) return;
    const newStyle = isSatellite
      ? "mapbox://styles/mapbox/dark-v11"
      : "mapbox://styles/mapbox/satellite-streets-v12";

    map.current.setStyle(newStyle);

    // Re-add layers after style change
    map.current.once("style.load", () => {
      const m = map.current!;

      m.addSource("hoas", {
        type: "geojson",
        data: geojson(),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 60,
      });

      m.addLayer({
        id: "clusters",
        type: "circle",
        source: "hoas",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#F97316",
            10,
            "#A855F7",
            30,
            "#3B82F6",
          ],
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            10,
            24,
            30,
            30,
          ],
          "circle-opacity": 0.85,
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(255,255,255,0.15)",
        },
      });

      m.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "hoas",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["DIN Pro Medium", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      m.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "hoas",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            5,
            12,
            8,
            16,
            12,
          ],
          "circle-opacity": 0.9,
          "circle-stroke-width": 2,
          "circle-stroke-color": "rgba(255,255,255,0.2)",
        },
      });

      m.addLayer({
        id: "unclustered-point-hover",
        type: "circle",
        source: "hoas",
        filter: ["==", ["get", "id"], ""],
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            7,
            10,
            12,
            14,
            16,
            18,
          ],
          "circle-opacity": 0.25,
        },
      });
    });

    setIsSatellite(!isSatellite);
  }, [isSatellite, geojson]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainer} className="h-full w-full" />

      {/* Map controls */}
      <div className="absolute bottom-8 right-4 z-10 flex flex-col gap-2">
        <button
          onClick={toggleSatellite}
          className="flex items-center justify-center rounded-xl bg-slate-800/90 backdrop-blur-xl border border-slate-700/50 p-2.5 text-white hover:bg-slate-700/90 transition-colors shadow-lg"
          title={isSatellite ? "Switch to dark map" : "Switch to satellite"}
        >
          {isSatellite ? (
            <MapIcon className="h-5 w-5" />
          ) : (
            <Satellite className="h-5 w-5" />
          )}
        </button>
        <button
          onClick={() => map.current?.zoomIn({ duration: 300 })}
          className="flex items-center justify-center rounded-xl bg-slate-800/90 backdrop-blur-xl border border-slate-700/50 p-2.5 text-white hover:bg-slate-700/90 transition-colors shadow-lg"
          title="Zoom in"
        >
          <ZoomIn className="h-5 w-5" />
        </button>
        <button
          onClick={() => map.current?.zoomOut({ duration: 300 })}
          className="flex items-center justify-center rounded-xl bg-slate-800/90 backdrop-blur-xl border border-slate-700/50 p-2.5 text-white hover:bg-slate-700/90 transition-colors shadow-lg"
          title="Zoom out"
        >
          <ZoomOut className="h-5 w-5" />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-8 left-4 z-10 rounded-xl bg-slate-800/90 backdrop-blur-xl border border-slate-700/50 px-4 py-3 shadow-lg">
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
