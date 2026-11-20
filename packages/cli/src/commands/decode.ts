import { tryDecodeScVal } from "@stellarlens/decode";

export class InvalidXdrError extends Error {
  constructor(reason: string) {
    super(`invalid XDR: ${reason}`);
    this.name = "InvalidXdrError";
  }
}

async function readStdin(stdin: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Decodes base64 `ScVal` XDR with the indexer's own rules (`@stellarlens/decode`), returning pretty JSON.
 * Whitespace is ignored so wrapped or newline-terminated input (e.g. from `echo` or a pasted explorer
 * value) works as-is.
 */
export function decodeXdr(input: string): string {
  const base64 = input.replace(/\s+/g, "");
  if (base64.length === 0) {
    throw new InvalidXdrError("input is empty");
  }

  const result = tryDecodeScVal(base64);
  if (!result.ok) {
    throw new InvalidXdrError(result.error);
  }
  return JSON.stringify(result.value, null, 2) ?? "null";
}

export interface DecodeIo {
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
  log?: (line: string) => void;
}

/** `stellarlens decode [xdr]`: reads the value from the argument, or from stdin when it's omitted or `-`. */
export async function runDecode(xdrArg: string | undefined, io: DecodeIo = {}): Promise<void> {
  const stdin = io.stdin ?? process.stdin;
  const log = io.log ?? ((line: string) => console.log(line));

  let input = xdrArg;
  if (input === undefined || input === "-") {
    if (stdin.isTTY) {
      throw new Error("pass base64 XDR as an argument or pipe it on stdin, e.g. `echo AAAA... | stellarlens decode`");
    }
    input = await readStdin(stdin);
  }

  log(decodeXdr(input));
}
