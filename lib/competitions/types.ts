import type { Prize } from "./rules";
export interface Competition {
  id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  enrollment: "automatic" | "opt_in";
  audience: "all" | "selected";
  settled_at: string | null;
  cancelled_at: string | null;
  joinedAt: string | null;
  competition_prizes: Prize[];
}
export interface Board {
  leaders: Array<{
    handle: string;
    company_name: string;
    peak_valuation: number;
    place: number;
    isYou: boolean;
  }>;
  yourRank: number | null;
  rankedCount: number;
  yourPrize: Prize | null;
}
export interface Student {
  profile_id: string;
  name: string;
  email: string;
  companies: number;
  runs_completed: number;
  best_year: number;
  peak_valuation: number;
  last_active: string | null;
  companiesDetail: Array<{
    name: string;
    industry: string;
    year: number;
    month: number;
    alive: boolean;
    valuation: number;
    peakValuation: number;
    updatedAt: string;
  }>;
}
