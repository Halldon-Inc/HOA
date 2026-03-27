export type ExteriorType = "stucco" | "non-stucco" | "mixed" | "unknown";

export type HOAType = "condo" | "townhouse" | "coop" | "community" | "civic" | "hoa";

export type BoardTitle =
  | "President"
  | "Vice President"
  | "Secretary"
  | "Treasurer"
  | "Member at Large";

export interface BoardMember {
  id: string;
  name: string;
  title: BoardTitle;
  email: string | null;
  phone: string | null;
}

export interface HOA {
  id: string;
  name: string;
  address: string;
  city: string;
  county: string;
  state: "NJ";
  zip: string;
  lat: number;
  lng: number;
  unitCount: number;
  yearBuilt: number;
  exteriorType: ExteriorType;
  exteriorConfidence?: number;
  exteriorSource?: string;
  nearbyStuccoCount?: number;
  hoaType?: HOAType;
  managementCompany: string | null;
  boardMembers: BoardMember[];
  monthlyFee: number | null;
  registeredAgent?: string | null;
  principalOffice?: string | null;
}

export interface StuccoProperty {
  owner: string;
  address: string;
  city: string;
  county: string;
  bldgDesc: string;
  yearBuilt: number | null;
  lat: number;
  lng: number;
}

export interface FilterState {
  search: string;
  exteriorType: ExteriorType | "all";
  county: string;
  yearMin: number;
  yearMax: number;
  unitMin: number;
  unitMax: number;
}

export const DEFAULT_FILTERS: FilterState = {
  search: "",
  exteriorType: "all",
  county: "all",
  yearMin: 1960,
  yearMax: 2025,
  unitMin: 1,
  unitMax: 500,
};
