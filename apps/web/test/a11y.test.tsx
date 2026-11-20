/**
 * Component-level axe-core accessibility checks for the views that had
 * accessibility issues fixed by hand (#107-#109): login, contracts, contract
 * detail, transfers and settings. jsdom doesn't lay out or compute real
 * styles, so color-contrast can't be assessed here — that needs a real
 * browser — but every other WCAG rule axe-core ships (labels, roles, names,
 * table/landmark structure, etc.) runs against the real page components.
 */
import { render } from "@testing-library/react";
import { axe } from "vitest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { Contract, ContractStats, EventsPage, TransfersPage, Webhook } from "@/lib/api";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return {
    ...actual,
    useFormState: (
      action: (state: unknown, payload: FormData) => Promise<unknown>,
      initialState: unknown
    ) => [initialState, action],
    useFormStatus: () => ({ pending: false })
  };
});

const { pushMock, replaceMock, searchParamsRef } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParamsRef: { current: new URLSearchParams() }
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/contracts/1",
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
  useSearchParams: () => searchParamsRef.current,
  redirect: vi.fn(),
  notFound: vi.fn()
}));

const { getSessionMock, getCurrentUserMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getCurrentUserMock: vi.fn()
}));

vi.mock("@/lib/session", () => ({
  getSession: getSessionMock,
  SESSION_COOKIE_NAME: "stellarlens_session"
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));

const contract: Contract = { id: 1, address: "CDEMO...", name: "Demo contract", network: "testnet" };

const stats: ContractStats = {
  transferCount: 12,
  uniqueSenders: 3,
  uniqueReceivers: 4,
  volumeByAsset: [{ asset: "USDC", volume: "1000" }]
};

const eventsPage: EventsPage = { data: [], nextCursor: null };
const transfersPage: TransfersPage = { data: [], nextCursor: null };
const webhooks: Webhook[] = [];

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body) };
}

async function checkA11y(element: ReactElement) {
  const { container } = render(element);
  const results = await axe(container, {
    rules: { "color-contrast": { enabled: false } }
  });
  expect(results).toHaveNoViolations();
}

describe("accessibility", () => {
  beforeEach(() => {
    searchParamsRef.current = new URLSearchParams();
    getSessionMock.mockResolvedValue(null);
    getCurrentUserMock.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/events")) return jsonResponse(eventsPage);
        if (url.includes("/webhooks")) return jsonResponse(webhooks);
        if (url.includes("/api-keys")) return jsonResponse([]);
        if (url.includes("/api/users")) return jsonResponse([]);
        return jsonResponse([]);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("login view has no axe violations", async () => {
    const { LoginForm } = await import("@/components/LoginForm");
    await checkA11y(
      <main>
        <h1>stellarlens</h1>
        <LoginForm />
      </main>
    );
  });

  it("contracts view has no axe violations", async () => {
    vi.doMock("@/lib/api", () => ({ listContracts: vi.fn().mockResolvedValue([contract]) }));
    const { ContractsTable } = await import("@/components/ContractsTable");
    await checkA11y(
      <main>
        <h1>Contracts</h1>
        <ContractsTable contracts={[contract]} />
      </main>
    );
  });

  it("contract detail view has no axe violations", async () => {
    const { ContractHeader } = await import("@/components/ContractHeader");
    const { StatsCards } = await import("@/components/StatsCards");
    const { EventsTable } = await import("@/components/EventsTable");
    const { WebhooksManager } = await import("@/components/WebhooksManager");
    await checkA11y(
      <main>
        <ContractHeader contract={contract} authenticated={false} />
        <StatsCards stats={stats} contractId={contract.id} />
        <EventsTable contractId={contract.id} />
        <WebhooksManager contractId={contract.id} authenticated={false} />
      </main>
    );
  });

  it("transfers view has no axe violations", async () => {
    const { VolumeChart } = await import("@/components/VolumeChart");
    await checkA11y(
      <main>
        <h1>Transfers</h1>
        <VolumeChart transfers={transfersPage.data} />
      </main>
    );
  });

  it("settings view has no axe violations", async () => {
    getCurrentUserMock.mockResolvedValue({ id: 1, email: "admin@example.com", role: "admin" });
    const { ApiKeysManager } = await import("@/components/ApiKeysManager");
    const { ChangePasswordForm } = await import("@/components/ChangePasswordForm");
    const { UsersManager } = await import("@/components/UsersManager");
    await checkA11y(
      <main>
        <h1>Settings</h1>
        <ApiKeysManager />
        <ChangePasswordForm />
        <UsersManager />
      </main>
    );
  });
});
