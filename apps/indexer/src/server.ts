import http from "node:http";
import type { Database } from "@stellarlens/db";
import { REGISTRY_PORT } from "./config.js";
import { registerContract } from "./registry.js";

/**
 * Minimal stub for registering contracts to index. Not a full API — just
 * enough to unblock the registration flow without pulling in a web framework.
 */
export function startRegistryServer(db: Database, port: number = REGISTRY_PORT): http.Server {
  const server = http.createServer((req, res) => {
    // Liveness probe for container health checks (docker compose, orchestrators).
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method === "POST" && req.url === "/contracts") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        void handleRegister(db, body, res);
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.listen(port, () => {
    console.log(`contract registry listening on :${port}`);
  });

  return server;
}

async function handleRegister(db: Database, body: string, res: http.ServerResponse) {
  try {
    const parsed = JSON.parse(body) as { address?: unknown; name?: unknown; network?: unknown };

    if (typeof parsed.address !== "string" || typeof parsed.network !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "address and network are required strings" }));
      return;
    }

    const contract = await registerContract(db, {
      address: parsed.address,
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      network: parsed.network
    });

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(contract));
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "invalid request" }));
  }
}
