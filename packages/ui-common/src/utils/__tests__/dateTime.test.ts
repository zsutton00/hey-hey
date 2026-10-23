import { describe, expect, it } from "vitest";
import {
  formatLocalDateInputValue,
  localDateInputToISOString,
  parseDateForLocalPicker,
} from "../dateTime";

describe("dateTime", () => {
  it("serializes a date input as the instant for local midnight", () => {
    const expected = new Date(2026, 6, 31).toISOString();

    expect(localDateInputToISOString("2026-07-31")).toBe(expected);
    expect(new Date(expected).getDate()).toBe(31);
  });

  it("rejects invalid local date input values", () => {
    expect(localDateInputToISOString("2026-02-31")).toBeNull();
    expect(localDateInputToISOString("not-a-date")).toBeNull();
  });

  it("round-trips an ISO timestamp through local picker presentation", () => {
    const timestamp = new Date(2026, 6, 31).toISOString();

    expect(formatLocalDateInputValue(timestamp)).toBe("2026-07-31");
    expect(parseDateForLocalPicker(timestamp)?.getDate()).toBe(31);
  });

  it("parses legacy date-only values as local calendar dates", () => {
    const date = parseDateForLocalPicker("2026-07-31");

    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(6);
    expect(date?.getDate()).toBe(31);
  });
});
