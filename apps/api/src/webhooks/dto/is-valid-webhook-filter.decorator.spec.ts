import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { CreateWebhookDto } from "./create-webhook.dto";
import { isValidWebhookFilter } from "./is-valid-webhook-filter.decorator";

describe("isValidWebhookFilter helper", () => {
  it("allows undefined or null", () => {
    expect(isValidWebhookFilter(undefined)).toBe(true);
    expect(isValidWebhookFilter(null)).toBe(true);
  });

  it("rejects non-object shapes", () => {
    expect(isValidWebhookFilter("not-an-object")).toBe(false);
    expect(isValidWebhookFilter(123)).toBe(false);
    expect(isValidWebhookFilter(true)).toBe(false);
    expect(isValidWebhookFilter(["array-not-object"])).toBe(false);
  });

  it("allows empty object or object without topics", () => {
    expect(isValidWebhookFilter({})).toBe(true);
  });

  it("rejects non-array topics property", () => {
    expect(isValidWebhookFilter({ topics: "transfer" })).toBe(false);
    expect(isValidWebhookFilter({ topics: 123 })).toBe(false);
  });

  it("allows array of strings and nulls", () => {
    expect(isValidWebhookFilter({ topics: [] })).toBe(true);
    expect(isValidWebhookFilter({ topics: ["transfer", null, "GABC"] })).toBe(true);
    expect(isValidWebhookFilter({ topics: [null, null] })).toBe(true);
    expect(isValidWebhookFilter({ topics: ["fee"] })).toBe(true);
  });

  it("rejects array with non-string non-null items", () => {
    expect(isValidWebhookFilter({ topics: [123] })).toBe(false);
    expect(isValidWebhookFilter({ topics: [true] })).toBe(false);
    expect(isValidWebhookFilter({ topics: [{}] })).toBe(false);
    expect(isValidWebhookFilter({ topics: ["transfer", 99] })).toBe(false);
  });
});

describe("CreateWebhookDto with IsValidWebhookFilter", () => {
  it("passes validation with a valid filter", async () => {
    const dto = new CreateWebhookDto();
    dto.url = "https://example.com/webhook";
    dto.filter = { topics: ["transfer", null, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"] };

    const errors = await validate(dto);
    expect(errors.filter((e) => e.property === "filter")).toHaveLength(0);
  });

  it("fails validation with an invalid filter shape", async () => {
    const dto = new CreateWebhookDto();
    dto.url = "https://example.com/webhook";
    dto.filter = { topics: [12345 as unknown as string] };

    const errors = await validate(dto);
    const filterErrors = errors.filter((e) => e.property === "filter");
    expect(filterErrors.length).toBeGreaterThan(0);
    expect(filterErrors[0].constraints?.isValidWebhookFilter).toContain("filter must be an object with an optional topics array");
  });
});
