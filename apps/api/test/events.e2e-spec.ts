import { events } from "@stellarlens/db";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { contractAddress, createApiKey, openSseStream } from "./helpers";
import { getApp, getTestDb } from "./setup";

async function registerContract(apiKey: string, address: string): Promise<number> {
  const response = await request(getApp().getHttpServer())
    .post("/contracts")
    .set("x-api-key", apiKey)
    .send({ address: contractAddress(address), network: "testnet" });
  return response.body.id;
}

async function seedEvents(contractId: number, count: number) {
  const db = getTestDb();
  for (let i = 0; i < count; i += 1) {
    await db.insert(events).values({
      contractId,
      ledger: 1000 + i,
      txHash: i.toString().repeat(64).slice(0, 64),
      topic: JSON.stringify(["fee"])
    });
  }
}

describe("events (e2e)", () => {
  let apiKey: string;

  beforeEach(async () => {
    apiKey = await createApiKey(getTestDb());
  });

  it("paginates events for a contract using the cursor", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_A");
    await seedEvents(contractId, 5);

    const firstPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ limit: 2 })
      .set("x-api-key", apiKey);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.data[0].ledger).toBe(1000);
    expect(firstPage.body.data[1].ledger).toBe(1001);
    expect(firstPage.body.nextCursor).toBe(firstPage.body.data[1].id);

    const secondPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ limit: 2, cursor: firstPage.body.nextCursor })
      .set("x-api-key", apiKey);

    expect(secondPage.body.data).toHaveLength(2);
    expect(secondPage.body.data[0].ledger).toBe(1002);
    expect(secondPage.body.data[1].ledger).toBe(1003);
    expect(secondPage.body.nextCursor).toBe(secondPage.body.data[1].id);

    const thirdPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ limit: 2, cursor: secondPage.body.nextCursor })
      .set("x-api-key", apiKey);

    expect(thirdPage.body.data).toHaveLength(1);
    expect(thirdPage.body.data[0].ledger).toBe(1004);
    expect(thirdPage.body.nextCursor).toBeNull();
  });

  it("pages newest-first with order=desc", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_DESC");
    await seedEvents(contractId, 5);

    const latest = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ order: "desc", limit: 1 })
      .set("x-api-key", apiKey);

    expect(latest.status).toBe(200);
    expect(latest.body.data).toHaveLength(1);
    expect(latest.body.data[0].ledger).toBe(1004);
    expect(latest.body.nextCursor).toBe(latest.body.data[0].id);

    const older = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ order: "desc", limit: 10, cursor: latest.body.nextCursor })
      .set("x-api-key", apiKey);

    expect(older.body.data.map((event: { ledger: number }) => event.ledger)).toEqual([1003, 1002, 1001, 1000]);
    expect(older.body.nextCursor).toBeNull();
  });

  it("rejects an unknown order", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_BAD_ORDER");
    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ order: "sideways" })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(400);
  it("returns recent events across contracts newest first with contract names", async () => {
    const contractA = await registerContract(apiKey, "CONTRACT_RECENT_A");
    const contractB = await registerContract(apiKey, "CONTRACT_RECENT_B");
    const db = getTestDb();
    await db.insert(events).values([
      { contractId: contractA, ledger: 1000, txHash: "a".repeat(64), topic: JSON.stringify(["old"]) },
      { contractId: contractB, ledger: 1002, txHash: "b".repeat(64), topic: JSON.stringify(["new"]) },
      { contractId: contractA, ledger: 1001, txHash: "c".repeat(64), topic: JSON.stringify(["middle"]) }
    ]);

    const response = await request(getApp().getHttpServer())
      .get("/events")
      .query({ limit: 2 })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.map((event: { ledger: number }) => event.ledger)).toEqual([1002, 1001]);
    expect(response.body[0].contractId).toBe(contractB);
    expect(response.body[0].contractName).toBeNull();
  });

  it("scopes events to the requested contract only", async () => {
    const contractA = await registerContract(apiKey, "CONTRACT_EVENTS_B");
    const contractB = await registerContract(apiKey, "CONTRACT_EVENTS_C");
    await seedEvents(contractA, 2);
    await seedEvents(contractB, 3);

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractA}/events`)
      .set("x-api-key", apiKey);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.every((event: { contractId: number }) => event.contractId === contractA)).toBe(true);
  });

  it("returns 404 when the contract does not exist", async () => {
    const response = await request(getApp().getHttpServer()).get("/contracts/999999/events").set("x-api-key", apiKey);
    expect(response.status).toBe(404);
  });

  it("filters events by any of multiple topics", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_TOPICS");
    const db = getTestDb();
    const topicSets = [["fee"], ["transfer"], ["mint"], ["burn"]];
    for (let i = 0; i < topicSets.length; i += 1) {
      await db.insert(events).values({
        contractId,
        ledger: 2000 + i,
        txHash: i.toString().repeat(64).slice(0, 64),
        topic: JSON.stringify(topicSets[i]),
        decodedData: { decoded: { topic: topicSets[i], value: null } }
      });
    }

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ topics: "fee,transfer" })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    const ledgers = response.body.data.map((event: { ledger: number }) => event.ledger).sort();
    expect(ledgers).toEqual([2000, 2001]);
  });

  it("pages events newest-first with order=desc and follows the cursor without overlap", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_DESC");
    await seedEvents(contractId, 5);

    const firstPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ limit: 2, order: "desc" })
      .set("x-api-key", apiKey);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.data[0].ledger).toBe(1004);
    expect(firstPage.body.data[1].ledger).toBe(1003);
    expect(firstPage.body.nextCursor).toBe(firstPage.body.data[1].id);

    const secondPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ limit: 2, order: "desc", cursor: firstPage.body.nextCursor })
      .set("x-api-key", apiKey);

    expect(secondPage.body.data).toHaveLength(2);
    expect(secondPage.body.data[0].ledger).toBe(1002);
    expect(secondPage.body.data[1].ledger).toBe(1001);
    expect(secondPage.body.nextCursor).toBe(secondPage.body.data[1].id);

    const thirdPage = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ limit: 2, order: "desc", cursor: secondPage.body.nextCursor })
      .set("x-api-key", apiKey);

    expect(thirdPage.body.data).toHaveLength(1);
    expect(thirdPage.body.data[0].ledger).toBe(1000);
    expect(thirdPage.body.nextCursor).toBeNull();

    const seen = [...firstPage.body.data, ...secondPage.body.data, ...thirdPage.body.data].map(
      (event: { id: number }) => event.id
    );
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("defaults to ascending order when order is omitted", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_DEFAULT_ORDER");
    await seedEvents(contractId, 3);

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data.map((event: { ledger: number }) => event.ledger)).toEqual([1000, 1001, 1002]);
  });

  it("looks up events by transaction hash", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_TX_HASH");
    const db = getTestDb();
    const txHash = "a".repeat(64);
    await db.insert(events).values({
      contractId,
      ledger: 4000,
      txHash,
      topic: JSON.stringify(["fee"])
    });

    const response = await request(getApp().getHttpServer()).get(`/transactions/${txHash}`).set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0].txHash).toBe(txHash);
    expect(response.body.transfers).toEqual([]);
  });

  it("rejects a malformed transaction hash", async () => {
    const response = await request(getApp().getHttpServer()).get("/transactions/not-a-hash").set("x-api-key", apiKey);
    expect(response.status).toBe(400);
  });

  it("returns empty results for an unknown transaction hash", async () => {
    const response = await request(getApp().getHttpServer())
      .get(`/transactions/${"b".repeat(64)}`)
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.events).toEqual([]);
    expect(response.body.transfers).toEqual([]);
  });

  it("still filters events by a single topic", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_SINGLE_TOPIC");
    const db = getTestDb();
    const topicSets = [["fee"], ["transfer"], ["mint"]];
    for (let i = 0; i < topicSets.length; i += 1) {
      await db.insert(events).values({
        contractId,
        ledger: 3000 + i,
        txHash: i.toString().repeat(64).slice(0, 64),
        topic: JSON.stringify(topicSets[i]),
        decodedData: { decoded: { topic: topicSets[i], value: null } }
      });
    }

    const response = await request(getApp().getHttpServer())
      .get(`/contracts/${contractId}/events`)
      .query({ topic: "transfer" })
      .set("x-api-key", apiKey);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].ledger).toBe(3001);
  });

  it("pushes new events over the SSE stream", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_STREAM");
    await seedEvents(contractId, 1);

    const stream = await openSseStream(`/contracts/${contractId}/events/stream`, apiKey);
    try {
      const db = getTestDb();
      const [inserted] = await db
        .insert(events)
        .values({
          contractId,
          ledger: 5000,
          txHash: "a".repeat(64),
          topic: JSON.stringify(["stream"]),
          decodedData: { decoded: { topic: ["stream"], value: null } }
        })
        .returning();

      const message = await stream.nextEvent();
      expect(message.id).toBe(String(inserted.id));
      expect(message.event).toBe("event");
      const payload = JSON.parse(message.data);
      expect(payload.id).toBe(inserted.id);
      expect(payload.ledger).toBe(5000);
      expect(payload.contractId).toBe(contractId);
    } finally {
      stream.close();
    }
  });

  it("resumes the SSE stream from Last-Event-ID", async () => {
    const contractId = await registerContract(apiKey, "CONTRACT_EVENTS_STREAM_RESUME");
    await seedEvents(contractId, 3);
    const db = getTestDb();
    const existing = await db.select().from(events);
    const lastSeen = existing
      .filter((event) => event.contractId === contractId)
      .sort((a, b) => a.id - b.id)[1];

    const stream = await openSseStream(`/contracts/${contractId}/events/stream`, apiKey, {
      lastEventId: String(lastSeen.id)
    });
    try {
      const message = await stream.nextEvent();
      expect(message.id).toBe(String(lastSeen.id + 1));
      const payload = JSON.parse(message.data);
      expect(payload.ledger).toBe(1002);
    } finally {
      stream.close();
    }
  });
});
