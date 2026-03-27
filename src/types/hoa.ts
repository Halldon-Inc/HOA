export type ExteriorType = "stucco" | "non-stucco" | "mixed";

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
  managementCompany: string | null;
  boardMembers: BoardMember[];
  monthlyFee: number | null;
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
