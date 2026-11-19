import type { AddressInfo } from "node:net";
import type http from "node:http";
import { http as mswHttp, passthrough } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { startRegistryServer } from "../src/server.js";
import { getTestDb, mswServer } from "./setup.js";

let server: http.Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function listen(): Promise<string> {
  server = startRegistryServer(getTestDb(), 0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Let requests to the local server through msw's "error on unhandled request" guard.
  mswServer.use(mswHttp.all(`${baseUrl}/*`, () => passthrough()));
  return baseUrl;
}

describe("registry server", () => {
  it("answers GET /health for container health checks", async () => {
    const response = await fetch(`${await listen()}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("still returns 404 for unknown routes", async () => {
    const response = await fetch(`${await listen()}/nope`);

    expect(response.status).toBe(404);
  });
});
