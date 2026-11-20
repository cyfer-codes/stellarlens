import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WEBHOOK_SIGNATURE_HEADER, verifyWebhookSignature } from "@stellarlens/sdk/webhooks";

/** Real deliveries are a few hundred bytes; anything far beyond that is not a stellarlens webhook. */
const MAX_BODY_BYTES = 1024 * 1024;

export interface ListenOptions {
  port: number;
  secret: string;
  /** Interface to bind to. Defaults to loopback so the listener isn't exposed on the network by accident. */
  host?: string;
  /** Re-POST verified payloads (raw body + signature header) to this url. */
  forwardTo?: string;
}

export interface ListenDeps {
  log?: (line: string) => void;
  fetch?: typeof fetch;
  now?: () => Date;
}

class BodyTooLargeError extends Error {}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function prettyBody(body: Buffer): string {
  const text = body.toString("utf8");
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text.length > 0 ? text : "(empty body)";
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function reply(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Builds (but does not start) a local webhook receiver: every POST is checked against `secret` with the
 * shared SDK verifier, pretty-printed with a VALID/INVALID marker, and — when valid and `forwardTo` is set —
 * re-POSTed byte-for-byte to the local app. Invalid deliveries get a 401 and are never forwarded.
 */
export function createWebhookListener(options: ListenOptions, deps: ListenDeps = {}): Server {
  const log = deps.log ?? ((line: string) => console.log(line));
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());

  return createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      reply(res, 405, { error: "method not allowed" });
      return;
    }

    let body: Buffer;
    try {
      body = await readRawBody(req);
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        log(`${now().toISOString()} ✘ REJECTED ${req.url ?? "/"} body exceeds ${MAX_BODY_BYTES} bytes`);
        reply(res, 413, { error: "payload too large" });
      }
      return;
    }

    const signature = headerValue(req.headers[WEBHOOK_SIGNATURE_HEADER]);
    const valid = verifyWebhookSignature(body, signature, options.secret);
    const reason = valid ? "" : signature ? " (signature mismatch)" : " (missing signature header)";

    log(`${now().toISOString()} ${valid ? "✔ VALID" : "✘ INVALID"} POST ${req.url ?? "/"}${reason}`);
    log(indent(prettyBody(body)));

    if (!valid) {
      reply(res, 401, { error: "invalid webhook signature" });
      return;
    }

    if (!options.forwardTo) {
      reply(res, 200, { ok: true });
      return;
    }

    try {
      const forwarded = await fetchImpl(options.forwardTo, {
        method: "POST",
        headers: {
          "Content-Type": headerValue(req.headers["content-type"]) ?? "application/json",
          "X-Webhook-Signature": signature!
        },
        body
      });
      log(`  ↪ forwarded to ${options.forwardTo}: ${forwarded.status}`);
      // Mirror the local app's status so the sender sees (and retries on) the app's real outcome.
      res.writeHead(forwarded.status, {
        "Content-Type": forwarded.headers.get("content-type") ?? "text/plain"
      });
      res.end(Buffer.from(await forwarded.arrayBuffer()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  ↪ forward to ${options.forwardTo} failed: ${message}`);
      reply(res, 502, { error: "forwarding failed" });
    }
  });
}

/** Starts the listener and resolves with the bound port (useful when `port` is 0). */
export async function startWebhookListener(
  options: ListenOptions,
  deps: ListenDeps = {}
): Promise<{ server: Server; port: number }> {
  const server = createWebhookListener(options, deps);
  const host = options.host ?? "127.0.0.1";

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  return { server, port: (server.address() as AddressInfo).port };
}

export async function listenForWebhooks(options: ListenOptions): Promise<void> {
  const { port } = await startWebhookListener(options);
  const host = options.host ?? "127.0.0.1";
  console.log(`listening for webhooks on http://${host}:${port} (ctrl+c to stop)`);
  if (options.forwardTo) {
    console.log(`forwarding verified payloads to ${options.forwardTo}`);
  }
}
