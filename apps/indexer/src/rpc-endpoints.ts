import { rpc } from "@stellar/stellar-sdk";
import { logger } from "./logger.js";

export interface RpcEndpointManagerOptions {
  urls: string[];
  failoverThreshold: number;
  primaryProbeIntervalMs: number;
  serverOptions?: rpc.Server.Options;
  allowHttp?: boolean;
}

interface EndpointState {
  url: string;
  server: rpc.Server;
  consecutiveFailures: number;
}

/**
 * Manages a list of Soroban RPC endpoints with automatic failover and failback.
 *
 * - Tracks consecutive failures per endpoint.
 * - After `failoverThreshold` consecutive failures, rotates to the next endpoint
 *   and logs the switch.
 * - Periodically probes the primary endpoint (every `primaryProbeIntervalMs`)
 *   and fails back to it once it recovers.
 */
export class RpcEndpointManager {
  private readonly endpoints: EndpointState[];
  private readonly failoverThreshold: number;
  private readonly primaryProbeIntervalMs: number;
  private activeIndex = 0;
  private lastProbeAt = 0;
  private probing = false;

  constructor(options: RpcEndpointManagerOptions) {
    const { urls, failoverThreshold, primaryProbeIntervalMs, serverOptions, allowHttp } = options;

    if (!urls || urls.length === 0) {
      throw new Error("RpcEndpointManager requires at least one RPC URL");
    }

    this.failoverThreshold = Math.max(1, failoverThreshold);
    this.primaryProbeIntervalMs = Math.max(0, primaryProbeIntervalMs);

    this.endpoints = urls.map((url) => ({
      url,
      server: new rpc.Server(url, { ...serverOptions, allowHttp }),
      consecutiveFailures: 0,
    }));
  }

  /** Returns the currently active RPC server. */
  getServer(): rpc.Server {
    return this.endpoints[this.activeIndex].server;
  }

  /** Returns the currently active RPC URL. */
  getActiveUrl(): string {
    return this.endpoints[this.activeIndex].url;
  }

  /** Returns the number of configured endpoints. */
  get size(): number {
    return this.endpoints.length;
  }

  /**
   * Runs `fn` against the active endpoint. On failure, records a consecutive
   * failure for the active endpoint and rethrows. On success, resets the
   * active endpoint's failure counter.
   *
   * `label` is used for structured logging.
   */
  async call<T>(label: string, fn: (server: rpc.Server) => Promise<T>): Promise<T> {
    const endpoint = this.endpoints[this.activeIndex];

    try {
      const result = await fn(endpoint.server);
      endpoint.consecutiveFailures = 0;
      return result;
    } catch (err) {
      endpoint.consecutiveFailures += 1;

      logger.warn(
        {
          label,
          url: endpoint.url,
          consecutiveFailures: endpoint.consecutiveFailures,
          threshold: this.failoverThreshold,
          err: err instanceof Error ? err.message : String(err),
        },
        "RPC call failed",
      );

      if (endpoint.consecutiveFailures >= this.failoverThreshold) {
        this.rotate(label);
      }

      throw err;
    }
  }

  /**
   * Periodically probes the primary endpoint and fails back to it when it
   * recovers. Should be called from the event loop tick. Safe to call often;
   * probing is throttled by `primaryProbeIntervalMs`.
   */
  async maybeProbePrimary(): Promise<void> {
    if (this.activeIndex === 0) return;
    if (this.probing) return;

    const now = Date.now();
    if (now - this.lastProbeAt < this.primaryProbeIntervalMs) return;

    this.lastProbeAt = now;
    this.probing = true;

    const primary = this.endpoints[0];
    const previousUrl = this.getActiveUrl();

    try {
      // Lightweight probe: fetch the latest ledger.
      await primary.server.getLatestLedger();
      primary.consecutiveFailures = 0;
      this.activeIndex = 0;

      logger.info(
        { from: previousUrl, to: primary.url },
        "RPC primary endpoint recovered; failing back",
      );
    } catch (err) {
      logger.debug(
        {
          url: primary.url,
          err: err instanceof Error ? err.message : String(err),
        },
        "RPC primary endpoint probe failed; staying on fallback",
      );
    } finally {
      this.probing = false;
    }
  }

  private rotate(label: string): void {
    const from = this.endpoints[this.activeIndex];
    const nextIndex = (this.activeIndex + 1) % this.endpoints.length;

    if (nextIndex === this.activeIndex) {
      // Only one endpoint configured; nothing to rotate to.
      logger.warn(
        { label, url: from.url },
        "RPC endpoint exceeded failure threshold but no fallback is configured",
      );
      from.consecutiveFailures = 0;
      return;
    }

    const to = this.endpoints[nextIndex];
    this.activeIndex = nextIndex;
    from.consecutiveFailures = 0;

    logger.warn(
      { label, from: from.url, to: to.url },
      "Rotating to next RPC endpoint after consecutive failures",
    );
  }
}