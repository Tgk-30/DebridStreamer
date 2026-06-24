// Regression: the year-range inputs are permissive (typeable), so a draft can
// hold a partial/implausible year mid-edit. sanitizeFilters must clamp those to
// null when the draft is committed, so the live filters never carry a year that
// buildDiscoverParams would silently drop — which would show a "From 20" chip
// that doesn't actually filter.

import { describe, expect, it } from "vitest";
import { sanitizeFilters } from "./FilterSlideover";
import { emptyBrowseFilters } from "../data/browse";

describe("sanitizeFilters", () => {
  it("drops an implausible/partial year so the applied filter stays consistent", () => {
    const out = sanitizeFilters({
      ...emptyBrowseFilters(),
      yearGTE: 20, // mid-typed toward 2010
      yearLTE: 9999, // out of range
    });
    expect(out.yearGTE).toBeNull();
    expect(out.yearLTE).toBeNull();
  });

  it("keeps real 4-digit years", () => {
    const out = sanitizeFilters({
      ...emptyBrowseFilters(),
      yearGTE: 2000,
      yearLTE: 2012,
    });
    expect(out.yearGTE).toBe(2000);
    expect(out.yearLTE).toBe(2012);
  });

  it("preserves the other filter fields untouched", () => {
    const base = {
      ...emptyBrowseFilters(),
      genreIds: [28, 12],
      minRating: 7,
      yearGTE: 1850,
    };
    const out = sanitizeFilters(base);
    expect(out.genreIds).toEqual([28, 12]);
    expect(out.minRating).toBe(7);
    expect(out.yearGTE).toBeNull(); // 1850 < 1900 → dropped
  });
});
