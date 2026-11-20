import { describe, expect, it } from "vitest";
import { escapeCsvCell, toCsv, toCsvRows } from "./csv.js";

describe("escapeCsvCell", () => {
  it("leaves plain values alone", () => {
    expect(escapeCsvCell("transfer")).toBe("transfer");
    expect(escapeCsvCell("")).toBe("");
  });

  it("quotes cells containing commas, quotes or line breaks", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line\nbreak")).toBe('"line\nbreak"');
  });

  it.each(["=SUM(A1)", "+cmd", "-cmd|' /C calc'!A0", "@SUM(A1)", "\tx", "\rx"])(
    "prefixes the formula-like cell %j with a quote",
    (cell) => {
      expect(escapeCsvCell(cell).replace(/^"/, "")).toMatch(/^'/);
    }
  );

  it("does not mangle negative or signed numbers", () => {
    expect(escapeCsvCell("-9741")).toBe("-9741");
    expect(escapeCsvCell("+1.5")).toBe("+1.5");
  });

  it("quotes after neutralizing when both apply", () => {
    expect(escapeCsvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
  });
});

describe("toCsv", () => {
  it("joins headers and rows with CRLF and no trailing newline", () => {
    expect(toCsv(["a", "b"], [["1", "x,y"]])).toBe('a,b\r\n1,"x,y"');
    expect(toCsvRows([])).toBe("");
  });
});
