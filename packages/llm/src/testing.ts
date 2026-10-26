import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export type StubRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: unknown;
};

export type StubResponse =
  | { status?: number; headers?: Record<string, string>; json: unknown; delayMs?: number }
  /** Each entry is written as one SSE frame; `event` adds an `event:` line. */
  | { sse: { event?: string; data: unknown }[]; done?: string }
  /** Sends headers and the first frames, then never finishes (abort tests). */
  | { hang: true; sse?: { event?: string; data: unknown }[] };

type Handler = (req: StubRequest) => StubResponse;

/** Local stand-in for a provider API; adapters reach it through `baseUrl`. */
export async function startStub() {
  let handler: Handler = () => ({ status: 500, json: { error: "no handler" } });
  const requests: StubRequest[] = [];
  let closedEarly = 0;

  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      const request: StubRequest = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body: raw ? JSON.parse(raw) : undefined,
      };
      requests.push(request);
      const response = handler(request);

      const frame = (f: { event?: string; data: unknown }) =>
        `${f.event ? `event: ${f.event}\n` : ""}data: ${typeof f.data === "string" ? f.data : JSON.stringify(f.data)}\n\n`;

      if ("json" in response) {
        setTimeout(() => {
          res.writeHead(response.status ?? 200, {
            "content-type": "application/json",
            ...response.headers,
          });
          res.end(JSON.stringify(response.json));
        }, response.delayMs ?? 0);
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      for (const f of response.sse ?? []) res.write(frame(f));
      if ("hang" in response) {
        res.on("close", () => {
          closedEarly++;
        });
        return;
      }
      if (response.done) res.write(`data: ${response.done}\n\n`);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    /** Connections the client closed before the response finished. */
    closedEarly: () => closedEarly,
    handle(next: Handler) {
      handler = next;
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type Stub = Awaited<ReturnType<typeof startStub>>;

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

export const SECRET_KEY = "sk-test-SECRET-abcdefghijklmnop1234";
