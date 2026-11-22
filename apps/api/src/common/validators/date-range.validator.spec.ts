import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { FindEventsQueryDto } from "../../events/dto/find-events-query.dto";
import { StatsQueryDto } from "../../transfers/dto/stats-query.dto";
import { DATE_RANGE_ORDER_MESSAGE } from "./date-range.validator";

const EARLY = "2024-01-01T00:00:00.000Z";
const LATE = "2024-02-01T00:00:00.000Z";

describe.each([
  ["StatsQueryDto", StatsQueryDto],
  ["FindEventsQueryDto", FindEventsQueryDto],
] as const)("%s date range", (_name, dto) => {
  async function errorsFor(query: Record<string, unknown>) {
    return validate(plainToInstance(dto, query));
  }

  it("rejects from after to with a clear message", async () => {
    const errors = await errorsFor({ from: LATE, to: EARLY });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("to");
    expect(Object.values(errors[0].constraints ?? {})).toContain(DATE_RANGE_ORDER_MESSAGE);
  });

  it.each([
    ["a valid range", { from: EARLY, to: LATE }],
    ["equal bounds", { from: EARLY, to: EARLY }],
    ["only from", { from: LATE }],
    ["only to", { to: EARLY }],
    ["no bounds", {}],
  ])("accepts %s", async (_label, query) => {
    expect(await errorsFor(query)).toHaveLength(0);
  });

  it("still reports malformed dates through the ISO 8601 validator", async () => {
    const errors = await errorsFor({ from: "not-a-date", to: EARLY });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe("from");
    expect(errors[0].constraints).toHaveProperty("isIso8601");
  });
});
