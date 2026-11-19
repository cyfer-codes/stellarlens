import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventRow, EventsPage } from "@/lib/api";
import { EventsTable } from "./EventsTable";

const { replaceMock, pushMock, searchParamsRef } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  pushMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() }
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/contracts/1",
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => searchParamsRef.current
}));

function makeEvent(id: number): EventRow {
  return {
    id,
    contractId: 1,
    ledger: 1000 + id,
    txHash: `hash-${id}`,
    topic: "topic",
    decodedData: null,
    createdAt: new Date().toISOString()
  };
}

function page(data: EventRow[], nextCursor: number | null): EventsPage {
  return { data, nextCursor };
}

describe("EventsTable URL state", () => {
  beforeEach(() => {
    searchParamsRef.current = new URLSearchParams();
    pushMock.mockReset();
    replaceMock.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => page([makeEvent(1)], 42)
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores page size from the URL on load", async () => {
    searchParamsRef.current = new URLSearchParams({ eventsPageSize: "50" });
    render(<EventsTable contractId={1} />);

    await waitFor(() => expect(screen.getByLabelText("Rows per page")).toHaveValue("50"));
  });

  it("pushes the next cursor into the URL when paging forward", async () => {
    render(<EventsTable contractId={1} />);
    await screen.findByText(/hash-1/);

    await userEvent.click(screen.getByLabelText("Next page of events"));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/contracts/1?eventsCursor=42&eventsPageSize=20", { scroll: false }));
  });

  it("replaces the URL (without a cursor) when the page size changes", async () => {
    render(<EventsTable contractId={1} />);
    await screen.findByText(/hash-1/);

    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "100");

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/contracts/1?eventsPageSize=100", { scroll: false }));
  });
});
