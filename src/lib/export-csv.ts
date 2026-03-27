import { HOA } from "@/types/hoa";

export function exportToCSV(hoas: HOA[], filename = "nj-hoa-export.csv") {
  const headers = [
    "Name",
    "Municipality",
    "County",
    "Exterior Type",
    "Nearby Stucco",
    "Entity ID",
    "Entity Type",
    "Date Formed",
    "Management Company",
    "Management Phone",
    "Management Website",
    "Year Built",
    "Parcel Count",
    "Latitude",
    "Longitude",
  ];

  const rows = hoas.map((hoa) => {
    return [
      hoa.name,
      hoa.municipality || hoa.city || "",
      hoa.county,
      hoa.exteriorType,
      hoa.nearbyStuccoCount || 0,
      hoa.entityId || "",
      hoa.entityType || "",
      hoa.dateFormed || "",
      hoa.managementCompany || "",
      hoa.managementPhone || "",
      hoa.managementWebsite || "",
      hoa.yearBuilt || "",
      hoa.parcelCount || "",
      hoa.lat,
      hoa.lng,
    ]
      .map((val) => {
        const str = String(val);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
