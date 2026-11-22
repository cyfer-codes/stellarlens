import { randomBytes } from "node:crypto";
import { StrKey } from "@stellar/stellar-sdk";
import { expect, test } from "@playwright/test";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@stellarlens.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (!ADMIN_PASSWORD) {
    throw new Error("SEED_ADMIN_PASSWORD must be set (see CONTRIBUTING.md for the e2e setup).");
  }
});

/**
 * One end-to-end pass over the core dashboard flow: log in, add a contract,
 * view its events/transfers, create and delete a webhook, then create and
 * revoke an api key. Steps build on each other (same page, same contract),
 * so they run as a single serial test rather than independent ones.
 */
test("core dashboard flow", async ({ page }) => {
  const contractAddress = StrKey.encodeContract(randomBytes(32));
  const contractName = `e2e-contract-${Date.now()}`;
  const webhookUrl = `http://localhost:9001/e2e-webhook-${Date.now()}`;
  const apiKeyName = `e2e-key-${Date.now()}`;

  await test.step("log in", async () => {
    await page.goto("/login");
    await page.locator("#email").fill(ADMIN_EMAIL);
    await page.locator("#password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/contracts$/);
  });

  await test.step("add a contract", async () => {
    await page.locator("#address").fill(contractAddress);
    await page.locator("#network").fill("testnet");
    await page.locator("#name").fill(contractName);
    await page.getByRole("button", { name: "Register contract" }).click();
    await expect(page).toHaveURL(/\/contracts$/);

    await page.getByPlaceholder("Filter by address or name").fill(contractName);
    await page.getByRole("link", { name: contractAddress }).click();
    await expect(page).toHaveURL(/\/contracts\/\d+$/);
  });

  await test.step("view events and transfers", async () => {
    await expect(page.getByText("No events found")).toBeVisible();

    await page.getByRole("link", { name: /View transfers/ }).click();
    await expect(page).toHaveURL(/\/transfers$/);
    await expect(page.getByText("No transfers yet")).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/contracts\/\d+$/);
  });

  await test.step("create and delete a webhook", async () => {
    await page.locator("#webhook-url").fill(webhookUrl);
    await page.getByRole("button", { name: "Add webhook" }).click();

    const row = page.getByRole("row", { name: webhookUrl });
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No webhooks yet")).toBeVisible();
  });

  await test.step("create and revoke an api key", async () => {
    await page.goto("/settings");
    await page.locator("#key-name").fill(apiKeyName);
    await page.getByRole("button", { name: "Generate key" }).click();

    await expect(page.getByText(/New api key generated/)).toBeVisible();
    const row = page.getByRole("row", { name: apiKeyName });
    await expect(row).toContainText("Active");

    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(row).toContainText("Revoked");
  });
});
