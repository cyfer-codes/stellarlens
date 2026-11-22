import { http, HttpResponse } from "msw";

export const TEST_RPC_URL = "http://localhost:9999/soroban/rpc";

interface JsonRpcRequestBody {
  jsonrpc: string;
  id: number;
  method: string;
  params?: unknown;
}

type MethodHandlers = Record<string, (params: unknown) => unknown>;

export interface RecordedJsonRpcCall {
  method: string;
  params: unknown;
}

export interface MockJsonRpcResult {
  /** All JSON-RPC calls observed by the mock, in arrival order. */
  calls: RecordedJsonRpcCall[];
  /** Convenience accessor for the params of every recorded `getEvents` call. */
  getEventsCalls: () => unknown[];
}

/** Mocks the single JSON-RPC endpoint, dispatching by request body `method`. */
export function mockJsonRpc(methodHandlers: MethodHandlers): MockJsonRpcResult {
  const calls: RecordedJsonRpcCall[] = [];

  const handler = http.post(TEST_RPC_URL, async ({ request }) => {
    const body = (await request.json()) as JsonRpcRequestBody;

    calls.push({ method: body.method, params: body.params });

    const methodHandler = methodHandlers[body.method];

    if (!methodHandler) {
      return HttpResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: `unmocked method: ${body.method}` }
      });
    }

    return HttpResponse.json({
      jsonrpc: "2.0",
      id: body.id,
      result: methodHandler(body.params)
    });
  });

  return {
    calls,
    getEventsCalls: () =>
      calls.filter((call) => call.method === "getEvents").map((call) => call.params)
  };
}