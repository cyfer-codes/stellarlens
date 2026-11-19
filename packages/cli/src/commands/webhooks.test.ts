import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { signWebhookPayload } from "@stellarlens/sdk/webhooks";
import { afterEach, describe, expect, it } from "vitest";
import { startWebhookListener, type ListenOptions } from "./webhooks.js";

const SECRET = "whsec_local";
const BODY = JSON.stringify({ eventId: 7, contractId: 1, ledger: 100, txHash: "ab", topic: ["transfer"], value: "5" });

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

async function listen(options: Partial<ListenOptions> = {}) {
  const lines: string[] = [];
  const { server, port } = await startWebhookListener(
    { port: 0, secret: SECRET, ...options },
    { log: (line) => lines.push(line), now: () => new Date("2026-01-01T00:00:00Z") }
  );
  servers.push(server);
  return { url: `http://127.0.0.1:${port}/hooks`, lines };
}

/** A stand-in for the developer's local app that records what was forwarded to it. */
async function fakeApp(status = 204) {
  const received: { body: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ body: Buffer.concat(chunks).toString("utf8"), headers: req.headers });
      res.writeHead(status);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`, received };
}

function post(url: string, body: string, signature?: string) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature ? { "X-Webhook-Signature": signature } : {}) },
    body
  });
}

describe("webhooks listen", () => {
  it("accepts a correctly signed payload and pretty-prints it with a VALID marker", async () => {
    const { url, lines } = await listen();

    const response = await post(url, BODY, signWebhookPayload(BODY, SECRET));

    expect(response.status).toBe(200);
    expect(lines[0]).toBe("2026-01-01T00:00:00.000Z ✔ VALID POST /hooks");
    expect(lines[1]).toContain('  "eventId": 7');
    expect(lines[1]).toContain('    "transfer"');
  });

  it("rejects a payload signed with the wrong secret with 401 and an INVALID marker", async () => {
    const { url, lines } = await listen();

    const response = await post(url, BODY, signWebhookPayload(BODY, "wrong-secret"));

    expect(response.status).toBe(401);
    expect(lines[0]).toContain("✘ INVALID POST /hooks (signature mismatch)");
    expect(lines[1]).toContain('"eventId": 7');
  });

  it("flags a missing signature header", async () => {
    const { url, lines } = await listen();

    const response = await post(url, BODY);

    expect(response.status).toBe(401);
    expect(lines[0]).toContain("✘ INVALID POST /hooks (missing signature header)");
  });

  it("prints non-JSON bodies verbatim", async () => {
    const { url, lines } = await listen();

    await post(url, "not json", signWebhookPayload("not json", SECRET));

    expect(lines[1]).toBe("  not json");
  });

  it("only accepts POST", async () => {
    const { url } = await listen();

    const response = await fetch(url);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  describe("--forward-to", () => {
    it("re-POSTs the exact verified body and signature, mirroring the app's status", async () => {
      const app = await fakeApp(204);
      const { url, lines } = await listen({ forwardTo: app.url });
      const signature = signWebhookPayload(BODY, SECRET);

      const response = await post(url, BODY, signature);

      expect(response.status).toBe(204);
      expect(app.received).toHaveLength(1);
      expect(app.received[0].body).toBe(BODY);
      expect(app.received[0].headers["x-webhook-signature"]).toBe(signature);
      expect(app.received[0].headers["content-type"]).toBe("application/json");
      expect(lines).toContain(`  ↪ forwarded to ${app.url}: 204`);
    });

    it("never forwards a payload that fails verification", async () => {
      const app = await fakeApp();
      const { url } = await listen({ forwardTo: app.url });

      const response = await post(url, BODY, signWebhookPayload(BODY, "wrong-secret"));

      expect(response.status).toBe(401);
      expect(app.received).toHaveLength(0);
    });

    it("answers 502 when the local app is unreachable", async () => {
      const app = await fakeApp();
      const deadUrl = app.url;
      await new Promise((resolve) => servers.pop()!.close(resolve));
      const { url, lines } = await listen({ forwardTo: deadUrl });

      const response = await post(url, BODY, signWebhookPayload(BODY, SECRET));

      expect(response.status).toBe(502);
      expect(lines.some((line) => line.includes(`forward to ${deadUrl} failed`))).toBe(true);
    });
  });
});
