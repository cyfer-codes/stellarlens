import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

import { WebhooksManager } from "./WebhooksManager";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

const webhook = {
  id: 1,
  url: "https://example.com/hook",
  eventTypes: ["transfer"],
  createdAt: "2026-01-01T00:00:00.000Z"
};

const secondWebhook = {
  id: 2,
  url: "https://example.com/other",
  eventTypes: null,
  createdAt: "2026-01-02T00:00:00.000Z"
};

function delivery(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    status: "delivered",
    attempts: 1,
    lastError: null,
    deliveredAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("WebhooksManager", () => {
  beforeEach(() => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/webhooks/1/deliveries")) {
        return Promise.resolve(jsonResponse({ data: [delivery(10)], nextCursor: 9 }));
      }
      if (url.endsWith("/webhooks/1/deliveries?cursor=9")) {
        return Promise.resolve(jsonResponse({ data: [delivery(9)], nextCursor: null }));
      }
      if (url.endsWith("/webhooks")) {
        return Promise.resolve(jsonResponse([webhook]));
      }
      return Promise.resolve(jsonResponse({ error: "unexpected url" }, 500));
    });
  });

  it("expands a webhook and shows its deliveries", async () => {
    render(<WebhooksManager contractId={1} authenticated={false} />);

    const toggle = await screen.findByRole("button", { name: /show deliveries/i });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/contracts/1/webhooks/1/deliveries",
        expect.any(Object)
      )
    );
    expect(await screen.findByText("delivered")).toBeInTheDocument();
  });

  it("loads more deliveries", async () => {
    render(<WebhooksManager contractId={1} authenticated={false} />);

    const toggle = await screen.findByRole("button", { name: /show deliveries/i });
    await userEvent.click(toggle);

    const loadMore = await screen.findByRole("button", { name: /load more/i });
    await userEvent.click(loadMore);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/contracts/1/webhooks/1/deliveries?cursor=9",
        expect.any(Object)
      )
    );
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
    });
  });

  it("renders a delivery error message when present", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/webhooks/1/deliveries")) {
        return Promise.resolve(
          jsonResponse({
            data: [delivery(10, { status: "failed", attempts: 3, lastError: "connection refused" })],
            nextCursor: null
          })
        );
      }
      return Promise.resolve(jsonResponse([webhook]));
    });

    render(<WebhooksManager contractId={1} authenticated={false} />);
    const toggle = await screen.findByRole("button", { name: /show deliveries/i });
    await userEvent.click(toggle);

    expect(await screen.findByText("connection refused")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("shows an error if the deliveries request fails", async () => {
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/webhooks/1/deliveries")) {
        return Promise.resolve(jsonResponse({ error: "boom" }, 502));
      }
      return Promise.resolve(jsonResponse([webhook]));
    });

    render(<WebhooksManager contractId={1} authenticated={false} />);
    const toggle = await screen.findByRole("button", { name: /show deliveries/i });
    await userEvent.click(toggle);

    expect(await screen.findByText(/request failed with 502/i)).toBeInTheDocument();
  });

  function rotateMock() {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/webhooks/1/rotate-secret") && init?.method === "POST") {
        return Promise.resolve(
          jsonResponse({
            id: 1,
            contractId: 1,
            url: webhook.url,
            eventTypes: webhook.eventTypes,
            secret: "new-secret-value",
            createdAt: webhook.createdAt
          })
        );
      }
      if (url.endsWith("/webhooks")) {
        return Promise.resolve(jsonResponse([webhook]));
      }
      return Promise.resolve(jsonResponse({ error: "unexpected url" }, 500));
    });
  }

  it("rotates a webhook secret and reveals it once", async () => {
    rotateMock();

    render(<WebhooksManager contractId={1} authenticated={true} />);
    await userEvent.click(await screen.findByRole("button", { name: /^rotate$/i }));

    expect(screen.getByText(/stop working immediately/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /rotate secret/i }));
    expect(await screen.findByText("new-secret-value")).toBeInTheDocument();
  });

  it("dismissing the revealed secret removes it from the DOM", async () => {
    rotateMock();

    render(<WebhooksManager contractId={1} authenticated={true} />);
    await userEvent.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await userEvent.click(screen.getByRole("button", { name: /rotate secret/i }));

    expect(await screen.findByText("new-secret-value")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText("new-secret-value")).not.toBeInTheDocument();
  });

  it("shows an error state with retry when the webhook list fails to load", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 502));

    render(<WebhooksManager contractId={1} authenticated={false} />);

    expect(await screen.findByText(/couldn't load webhooks/i)).toBeInTheDocument();
    expect(screen.getByText(/request failed with 502/i)).toBeInTheDocument();
    expect(screen.queryByText(/no webhooks yet/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(await screen.findByText("https://example.com/hook")).toBeInTheDocument();
    expect(screen.queryByText(/couldn't load webhooks/i)).not.toBeInTheDocument();
  });

  it("copy button copies the revealed secret", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    rotateMock();

    render(<WebhooksManager contractId={1} authenticated={true} />);
    await userEvent.click(await screen.findByRole("button", { name: /^rotate$/i }));
    await userEvent.click(screen.getByRole("button", { name: /rotate secret/i }));

    const copyButton = await screen.findByRole("button", { name: /copy/i });
    await userEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith("new-secret-value");
  });

  function editMock(
    patchResponse: { status: number; body: unknown } = { status: 200, body: { ...webhook, url: "https://example.com/updated" } }
  ) {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/webhooks/1") && init?.method === "PATCH") {
        return Promise.resolve(jsonResponse(patchResponse.body, patchResponse.status));
      }
      if (url.endsWith("/webhooks")) {
        return Promise.resolve(
          jsonResponse([
            patchResponse.status === 200
              ? { ...webhook, url: "https://example.com/updated" }
              : webhook
          ])
        );
      }
      return Promise.resolve(jsonResponse({ error: "unexpected url" }, 500));
    });
  }

  it("edits a webhook's url inline", async () => {
    editMock();

    render(<WebhooksManager contractId={1} authenticated={true} />);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));

    const urlInput = document.getElementById("edit-url-1") as HTMLInputElement;
    expect(urlInput).not.toBeNull();
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, "https://example.com/updated");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/contracts/1/webhooks/1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ url: "https://example.com/updated", eventTypes: ["transfer"] })
        })
      )
    );
    expect(await screen.findByText("https://example.com/updated")).toBeInTheDocument();
  });

  it("shows a 409 duplicate-url error inline", async () => {
    editMock({ status: 409, body: { error: "webhook 2 is already registered for https://example.com/dup on contract 1" } });

    render(<WebhooksManager contractId={1} authenticated={true} />);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/already exists on this contract/i)).toBeInTheDocument();
    // edit form still open
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("shows a 400 validation error inline", async () => {
    editMock({ status: 400, body: { error: "url must be a URL address" } });

    render(<WebhooksManager contractId={1} authenticated={true} />);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("url must be a URL address")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
  });

  it("cancel closes the edit form without patching", async () => {
    editMock();

    render(<WebhooksManager contractId={1} authenticated={true} />);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(document.getElementById("edit-url-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/contracts/1/webhooks/1",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("shows the client-side error when saving an empty URL", async () => {
    editMock();

    render(<WebhooksManager contractId={1} authenticated={true} />);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    const urlInput = document.getElementById("edit-url-1") as HTMLInputElement;
    await userEvent.clear(urlInput);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText("URL is required")).toBeInTheDocument();
  });
});