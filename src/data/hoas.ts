import { HOA } from "@/types/hoa";
import hoaJson from "../../public/data/hoas.json";

// Cast the imported JSON to HOA array
export const hoaData: HOA[] = hoaJson as HOA[];

// Pre-computed stats
export const allCounties = [...new Set(hoaData.map((h) => h.county))].sort();

export const stats = {
  total: hoaData.length,
  stucco: hoaData.filter((h) => h.exteriorType === "stucco").length,
  nonStucco: hoaData.filter((h) => h.exteriorType === "non-stucco").length,
  mixed: hoaData.filter((h) => h.exteriorType === "mixed").length,
};
