import { HOA } from "@/types/hoa";

export function exportToCSV(hoas: HOA[], filename = "nj-hoa-export.csv") {
  const headers = [
    "Name",
    "Address",
    "City",
    "County",
    "State",
    "Zip",
    "Exterior Type",
    "Unit Count",
    "Year Built",
    "Monthly Fee",
    "Management Company",
    "Board President",
    "President Email",
    "President Phone",
    "Board VP",
    "VP Email",
    "VP Phone",
    "Latitude",
    "Longitude",
  ];

  const rows = hoas.map((hoa) => {
    const president = hoa.boardMembers.find((m) => m.title === "President");
    const vp = hoa.boardMembers.find((m) => m.title === "Vice President");

    return [
      hoa.name,
      hoa.address,
      hoa.city,
      hoa.county,
      hoa.state,
      hoa.zip,
      hoa.exteriorType,
      hoa.unitCount,
      hoa.yearBuilt,
      hoa.monthlyFee || "",
      hoa.managementCompany || "",
      president?.name || "",
      president?.email || "",
      president?.phone || "",
      vp?.name || "",
      vp?.email || "",
      vp?.phone || "",
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
