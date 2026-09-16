import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { FindEventsQueryDto } from "../src/events/dto/find-events-query.dto";
import { StatsQueryDto } from "../src/transfers/dto/stats-query.dto";

describe("date-range query validation", () => {
  describe("StatsQueryDto", () => {
    it("fails validation when 'from' is after 'to'", async () => {
      const dto = plainToInstance(StatsQueryDto, {
        from: "2026-02-01T00:00:00Z",
        to: "2026-01-01T00:00:00Z"
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe("from");
      expect(errors[0].constraints?.isBefore).toBe("'from' must be before or equal to 'to'");
    });

    it("passes validation when 'from' is before 'to'", async () => {
      const dto = plainToInstance(StatsQueryDto, {
        from: "2026-01-01T00:00:00Z",
        to: "2026-02-01T00:00:00Z"
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it("passes validation when 'from' equals 'to'", async () => {
      const dto = plainToInstance(StatsQueryDto, {
        from: "2026-01-01T00:00:00Z",
        to: "2026-01-01T00:00:00Z"
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it("passes validation when only 'from' is provided", async () => {
      const dto = plainToInstance(StatsQueryDto, {
        from: "2026-01-01T00:00:00Z"
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it("passes validation when only 'to' is provided", async () => {
      const dto = plainToInstance(StatsQueryDto, {
        to: "2026-01-01T00:00:00Z"
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });

  describe("FindEventsQueryDto", () => {
    it("fails validation when 'from' is after 'to'", async () => {
      const dto = plainToInstance(FindEventsQueryDto, {
        from: "2026-05-10T12:00:00Z",
        to: "2026-05-01T12:00:00Z"
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe("from");
      expect(errors[0].constraints?.isBefore).toBe("'from' must be before or equal to 'to'");
    });

    it("passes validation with valid range", async () => {
      const dto = plainToInstance(FindEventsQueryDto, {
        from: "2026-05-01T12:00:00Z",
        to: "2026-05-10T12:00:00Z"
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });
  });
});
