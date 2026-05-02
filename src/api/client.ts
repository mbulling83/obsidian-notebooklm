export const BATCHEXECUTE_URL =
  "https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute";

export class NotebookLMAuthError extends Error {
  constructor(message = "NotebookLM auth expired — reconnect in settings") {
    super(message);
    this.name = "NotebookLMAuthError";
  }
}

export class NotebookLMRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotebookLMRpcError";
  }
}

export function encodeRpcRequest(methodId: string, params: unknown[]): unknown[][][] {
  const paramsJson = JSON.stringify(params);
  return [[[methodId, paramsJson, null, "generic"]]];
}

export function buildRequestBody(rpcRequest: unknown[][][], csrfToken?: string): string {
  const fReq = encodeURIComponent(JSON.stringify(rpcRequest));
  let body = `f.req=${fReq}`;
  if (csrfToken) body += `&at=${encodeURIComponent(csrfToken)}`;
  body += "&";
  return body;
}

export function buildUrl(methodId: string, sessionId: string, sourcePath = "/"): string {
  const params = new URLSearchParams({
    rpcids: methodId,
    "source-path": sourcePath,
    "f.sid": sessionId,
    "hl": "en",
    rt: "c",
  });
  return `${BATCHEXECUTE_URL}?${params.toString()}`;
}

export function parseRpcResponse(raw: string, methodId: string): unknown {
  // Strip )]}'\n anti-XSSI prefix
  const stripped = raw.replace(/^\)\]\}'\n/, "");

  // The real batchexecute chunked format (rt=c) interleaves byte-count lines
  // with JSON-array lines. We iterate all lines, skip integer byte-count lines,
  // and parse each remaining non-empty line as a JSON array of chunks.
  const allChunks: unknown[][] = [];
  for (const line of stripped.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    // Skip byte-count lines (pure integers)
    if (/^\d+$/.test(trimmed)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Skip unparseable lines (e.g. trailing newlines, protocol artifacts)
      continue;
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        allChunks.push(item as unknown[]);
      }
    }
  }

  if (allChunks.length === 0) {
    throw new NotebookLMRpcError(`Failed to parse response for ${methodId}`);
  }

  // Find wrb.fr entry matching our method ID
  for (const chunk of allChunks) {
    if (Array.isArray(chunk) && chunk[0] === "wrb.fr" && chunk[1] === methodId) {
      const innerJson = chunk[2];
      if (innerJson === null || innerJson === undefined) return null;
      return JSON.parse(innerJson as string);
    }
  }

  // Check for body-level RPC error envelope: ["er", methodId, ...]
  for (const chunk of allChunks) {
    if (Array.isArray(chunk) && chunk[0] === "er" && chunk[1] === methodId) {
      throw new NotebookLMRpcError(`RPC error for ${methodId}: ${JSON.stringify(chunk)}`);
    }
  }

  throw new NotebookLMRpcError(`No wrb.fr response found for ${methodId}`);
}
