import {
  assertPublicWebhookUrl,
  ipIsPublic,
  ipv4IsPublic,
  NonPublicWebhookUrlError
} from "@stellarlens/db";
import { describe, expect, it } from "vitest";

describe("webhook URL IP validation", () => {
  describe("ipv4IsPublic", () => {
    it("identifies private and reserved ranges as non-public", () => {
      expect(ipv4IsPublic("127.0.0.1")).toBe(false);
      expect(ipv4IsPublic("10.0.0.1")).toBe(false);
      expect(ipv4IsPublic("10.255.255.255")).toBe(false);
      expect(ipv4IsPublic("172.16.0.1")).toBe(false);
      expect(ipv4IsPublic("172.31.255.255")).toBe(false);
      expect(ipv4IsPublic("192.168.0.1")).toBe(false);
      expect(ipv4IsPublic("169.254.1.1")).toBe(false);
      expect(ipv4IsPublic("0.0.0.0")).toBe(false);
      expect(ipv4IsPublic("224.0.0.1")).toBe(false);
    });

    it("identifies routable public IPv4 addresses", () => {
      expect(ipv4IsPublic("8.8.8.8")).toBe(true);
      expect(ipv4IsPublic("1.1.1.1")).toBe(true);
      expect(ipv4IsPublic("93.184.216.34")).toBe(true);
    });
  });

  describe("ipIsPublic", () => {
    it("handles IPv4 mapped IPv6 addresses", () => {
      expect(ipIsPublic("::ffff:127.0.0.1")).toBe(false);
      expect(ipIsPublic("::ffff:10.0.0.1")).toBe(false);
      expect(ipIsPublic("::ffff:8.8.8.8")).toBe(true);
    });

    it("handles native IPv6 addresses", () => {
      expect(ipIsPublic("::1")).toBe(false); // loopback
      expect(ipIsPublic("fe80::1")).toBe(false); // link-local
      expect(ipIsPublic("2001:db8::1")).toBe(false); // documentation
      expect(ipIsPublic("2607:f8b0:4005:805::200e")).toBe(true); // Google public IPv6
    });

    it("returns false for invalid IP strings", () => {
      expect(ipIsPublic("not-an-ip")).toBe(false);
    });
  });

  describe("assertPublicWebhookUrl", () => {
    it("accepts valid public URLs with IP literals", async () => {
      await expect(assertPublicWebhookUrl("http://93.184.216.34/webhook")).resolves.toBeUndefined();
    });

    it("rejects private IPv4 literals", async () => {
      await expect(assertPublicWebhookUrl("http://127.0.0.1:8080/webhook")).rejects.toThrow(
        NonPublicWebhookUrlError
      );
      await expect(assertPublicWebhookUrl("http://10.0.0.5/webhook")).rejects.toThrow(
        NonPublicWebhookUrlError
      );
      await expect(assertPublicWebhookUrl("http://192.168.1.100/webhook")).rejects.toThrow(
        NonPublicWebhookUrlError
      );
    });

    it("resolves hostname using injected DNS resolver", async () => {
      const mockPrivateResolver = async () => [{ address: "10.0.0.1" }];
      await expect(
        assertPublicWebhookUrl("https://internal.corp/webhook", mockPrivateResolver)
      ).rejects.toThrow(NonPublicWebhookUrlError);

      const mockPublicResolver = async () => [{ address: "93.184.216.34" }];
      await expect(
        assertPublicWebhookUrl("https://api.example.com/webhook", mockPublicResolver)
      ).resolves.toBeUndefined();
    });

    it("rejects when DNS resolves to empty address list", async () => {
      const mockEmptyResolver = async () => [];
      await expect(
        assertPublicWebhookUrl("https://empty.example/webhook", mockEmptyResolver)
      ).rejects.toThrow(NonPublicWebhookUrlError);
    });
  });
});
