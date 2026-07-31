import type { Industry, RunState } from "../types";
import type { IndustrySpec } from "../portfolio";
import type { Activity } from "../activities";

import FOOD, { ACTIVITIES as FOOD_ACTS } from "./food";
import ECOM, { ACTIVITIES as ECOM_ACTS } from "./ecom";
import TECH, { ACTIVITIES as TECH_ACTS } from "./tech";
import CONTENT, { ACTIVITIES as CONTENT_ACTS } from "./content";
import FASHION, { ACTIVITIES as FASHION_ACTS } from "./fashion";
import GAMING, { ACTIVITIES as GAMING_ACTS } from "./gaming";
import FITNESS, { ACTIVITIES as FITNESS_ACTS } from "./fitness";
import BEAUTY, { ACTIVITIES as BEAUTY_ACTS } from "./beauty";
import EDTECH, { ACTIVITIES as EDTECH_ACTS } from "./edtech";
import SUSTAIN, { ACTIVITIES as SUSTAIN_ACTS } from "./sustain";
import TOYS, { ACTIVITIES as TOYS_ACTS } from "./toys";
import PET, { ACTIVITIES as PET_ACTS } from "./pet";

/**
 * The twelve lenses, in one place.
 *
 * `Record<Industry, …>` rather than a lookup with a fallback on purpose: adding a
 * thirteenth industry to the `Industry` union now fails the typecheck here until
 * someone writes its lens. A `?? FOOD` default would let a half-added industry
 * ship silently playing as a restaurant.
 */
export const SPECS: Record<Industry, IndustrySpec> = {
  FOOD,
  ECOM,
  TECH,
  CONTENT,
  FASHION,
  GAMING,
  FITNESS,
  BEAUTY,
  EDTECH,
  SUSTAIN,
  TOYS,
  PET,
};

export const INDUSTRY_ACTIVITIES: Record<Industry, Activity[]> = {
  FOOD: FOOD_ACTS,
  ECOM: ECOM_ACTS,
  TECH: TECH_ACTS,
  CONTENT: CONTENT_ACTS,
  FASHION: FASHION_ACTS,
  GAMING: GAMING_ACTS,
  FITNESS: FITNESS_ACTS,
  BEAUTY: BEAUTY_ACTS,
  EDTECH: EDTECH_ACTS,
  SUSTAIN: SUSTAIN_ACTS,
  TOYS: TOYS_ACTS,
  PET: PET_ACTS,
};

/** The lens for a code. Total — every industry has one or the build fails. */
export const specFor = (code: Industry): IndustrySpec => SPECS[code];

/** The lens for the run in progress. */
export const specForRun = (state: RunState): IndustrySpec => SPECS[state.industry];

/**
 * The activities this run can see: the twelve-industry-agnostic set plus the
 * ones that only exist because of what business you chose.
 *
 * A FOOD player never sees "Sunset a plan" and a TECH player never sees "Cut
 * prep waste". That asymmetry is the entire point of the addendum — before it,
 * every one of the fifteen activities was identical whether you ran a taco truck
 * or a game studio.
 */
export const activitiesForIndustry = (state: RunState): Activity[] =>
  INDUSTRY_ACTIVITIES[state.industry] ?? [];

/** Every activity in the game, for validation and coverage counting. */
export const ALL_INDUSTRY_ACTIVITIES: Activity[] = Object.values(INDUSTRY_ACTIVITIES).flat();
