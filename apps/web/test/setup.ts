import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
import "vitest-axe/extend-expect";
import { cleanup } from "@testing-library/react";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect } from "vitest";

expect.extend(matchers);
afterEach(cleanup);
import "@testing-library/jest-dom/vitest";
