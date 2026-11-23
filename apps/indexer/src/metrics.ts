import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics for the StellarLens indexer.
 *
 * All metric names are prefixed with `stellarlens_indexer_` and follow
 * Prometheus naming conventions (base units, `_total` suffix for counters,
 * `_seconds` suffix for durations).
 *
 * Metrics:
 * - `stellarlens_indexer_events_indexed_total` (counter)
 *     Total number of contract events successfully indexed.
 * - `stellarlens_indexer_poll_duration_seconds` (histogram)
 *     Duration of a single indexer poll cycle, in seconds.
 * - `stellarlens_indexer_rpc_retries_total` (counter)
 *     Total number of RPC request retries performed by the indexer.
 * - `stellarlens_indexer_webhook_deliveries_total{outcome}` (counter)
 *     Total number of webhook delivery attempts, labelled by `outcome`
 *     (e.g. `success`, `failure`).
 * - `stellarlens_indexer_lag_ledgers` (gauge)
 *     Current lag between the chain head ledger and the last indexed ledger,
 *     measured in ledgers.
 */

export const registry = new Registry();

// Collect default Node.js process metrics (CPU, memory, event loop, etc.).
collectDefaultMetrics({ register: registry });

export const eventsIndexedTotal = new Counter({
  name: 'stellarlens_indexer_events_indexed_total',
  help: 'Total number of contract events successfully indexed.',
  registers: [registry],
});

export const pollDurationSeconds = new Histogram({
  name: 'stellarlens_indexer_poll_duration_seconds',
  help: 'Duration of a single indexer poll cycle, in seconds.',
  // Buckets tuned for typical poll cycles (sub-second to tens of seconds).
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const rpcRetriesTotal = new Counter({
  name: 'stellarlens_indexer_rpc_retries_total',
  help: 'Total number of RPC request retries performed by the indexer.',
  registers: [registry],
});

export const webhookDeliveriesTotal = new Counter({
  name: 'stellarlens_indexer_webhook_deliveries_total',
  help: 'Total number of webhook delivery attempts, labelled by outcome.',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const lagLedgers = new Gauge({
  name: 'stellarlens_indexer_lag_ledgers',
  help: 'Current lag between the chain head ledger and the last indexed ledger, in ledgers.',
  registers: [registry],
});

/** Increment the events-indexed counter. */
export function recordEventsIndexed(count = 1): void {
  if (count > 0) {
    eventsIndexedTotal.inc(count);
  }
}

/** Observe the duration of a poll cycle, in seconds. */
export function observePollDuration(seconds: number): void {
  pollDurationSeconds.observe(seconds);
}

/** Increment the RPC retries counter. */
export function recordRpcRetry(count = 1): void {
  if (count > 0) {
    rpcRetriesTotal.inc(count);
  }
}

/** Record a webhook delivery attempt by outcome (`success` or `failure`). */
export function recordWebhookDelivery(outcome: 'success' | 'failure'): void {
  webhookDeliveriesTotal.inc({ outcome });
}

/** Set the current indexer lag, in ledgers. */
export function setLagLedgers(lag: number): void {
  lagLedgers.set(lag);
}

/** Content type expected by Prometheus when scraping the metrics endpoint. */
export const metricsContentType = registry.contentType;

/** Render the current metrics in the Prometheus text exposition format. */
export async function renderMetrics(): Promise<string> {
  return registry.metrics();
}