import { describe, expect, test } from "bun:test";
import {
  type ClientPort,
  fetchViaWorker,
  type PortLike,
  readImage,
  serveImagePort,
} from "../image-fetch";

const ID = "ext-id";

/** A fetch that records its init and answers with `body`, in `pieces` reads. */
function fakeFetch(
  body: Uint8Array,
  opts: { status?: number; headers?: Record<string, string>; pieces?: number } = {}
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const pieces = opts.pieces ?? 1;
    const size = Math.ceil(body.length / pieces) || 1;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < body.length; i += size) c.enqueue(body.subarray(i, i + size));
        c.close();
      },
    });
    return new Response(stream, { status: opts.status ?? 200, headers: opts.headers });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** Two linked ports: what the page posts reaches the worker, and the other way round. */
function pair(sender: PortLike["sender"]) {
  const page = { msg: [] as Array<(m: unknown) => void>, dis: [] as Array<() => void> };
  const worker = { msg: [] as Array<(m: unknown) => void>, dis: [] as Array<() => void> };
  let closed = false;
  const close = (from: typeof page, to: typeof page) => {
    if (closed) return;
    closed = true;
    for (const f of to.dis) f();
    void from;
  };
  const workerPort: PortLike = {
    sender,
    postMessage: (m) => {
      if (!closed) for (const f of page.msg) f(structuredClone(m));
    },
    disconnect: () => close(worker, page),
    onMessage: { addListener: (f) => worker.msg.push(f) },
    onDisconnect: { addListener: (f) => worker.dis.push(f) },
  };
  const pagePort: ClientPort = {
    postMessage: (m) => {
      if (!closed) for (const f of worker.msg) f(structuredClone(m));
    },
    disconnect: () => close(page, worker),
    onMessage: { addListener: (f) => page.msg.push(f) },
    onDisconnect: { addListener: (f) => page.dis.push(f) },
  };
  return { workerPort, pagePort, isClosed: () => closed };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("readImage", () => {
  test("omits credentials and the referrer, and follows redirects", async () => {
    const f = fakeFetch(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
    const r = await readImage("https://cdn.example/a.png", { fetch: f.impl });
    expect(r.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(r.mime).toBe("image/png");
    expect(f.calls[0]?.init).toMatchObject({
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
    });
  });

  test("allows http and https only", async () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://x/a.png",
      "data:image/png;base64,AAAA",
      "chrome://x",
      "nope",
    ]) {
      const f = fakeFetch(new Uint8Array([1]));
      await expect(readImage(url, { fetch: f.impl })).rejects.toThrow("not allowed");
      expect(f.calls).toHaveLength(0);
    }
    const f = fakeFetch(new Uint8Array([1]));
    await readImage("http://cdn.example/a.png", { fetch: f.impl });
    expect(f.calls).toHaveLength(1);
  });

  test("caps one image, whatever Content-Length says", async () => {
    const big = fakeFetch(new Uint8Array(100), { pieces: 10, headers: { "content-length": "5" } });
    await expect(readImage("https://x/a", { fetch: big.impl, maxBytes: 50 })).rejects.toThrow(
      "larger than 32 MiB"
    );
    const declared = fakeFetch(new Uint8Array(10), { headers: { "content-length": "999" } });
    await expect(readImage("https://x/a", { fetch: declared.impl, maxBytes: 50 })).rejects.toThrow(
      "larger than 32 MiB"
    );
    const ok = fakeFetch(new Uint8Array(50), { pieces: 5 });
    expect((await readImage("https://x/a", { fetch: ok.impl, maxBytes: 50 })).bytes).toHaveLength(
      50
    );
  });

  test("an error message never carries the URL", async () => {
    const url = "https://secret.example/private/a.png?token=abc";
    const failing = (async () => {
      throw new Error(`failed to fetch ${url}`);
    }) as unknown as typeof fetch;
    await expect(readImage(url, { fetch: failing })).rejects.toThrow("could not be fetched");
    const f = fakeFetch(new Uint8Array(), { status: 404 });
    const err = await readImage(url, { fetch: f.impl }).catch((e) => e as Error);
    expect((err as Error).message).toBe("HTTP 404");
  });
});

describe("worker and page over a port", () => {
  const fromTab = { id: ID, tab: { id: 1 } };
  const deps = (f: ReturnType<typeof fakeFetch>, hasAccess = async () => true) => ({
    fetch: f.impl,
    extensionId: ID,
    hasAccess,
  });

  test("an image larger than one chunk arrives whole", async () => {
    // 13 MB is over the 12 MB asset step, so it travels as two chunks.
    const body = new Uint8Array(13_000_000).map((_, i) => i % 251);
    const f = fakeFetch(body, { pieces: 4, headers: { "content-type": "image/jpeg" } });
    const p = pair(fromTab);
    serveImagePort(p.workerPort, deps(f));
    const blob = await fetchViaWorker("https://cdn.example/big.jpg", undefined, () => p.pagePort);
    expect(blob.type).toBe("image/jpeg");
    expect(blob.size).toBe(body.length);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(body);
    expect(p.isClosed()).toBe(true);
  });

  test("a port with no tab, or from another extension, is refused", async () => {
    for (const sender of [{ id: ID }, { id: "other", tab: { id: 1 } }, undefined]) {
      const f = fakeFetch(new Uint8Array([1]));
      const p = pair(sender);
      serveImagePort(p.workerPort, deps(f));
      expect(p.isClosed()).toBe(true);
      expect(f.calls).toHaveLength(0);
    }
  });

  test("without the permission nothing is fetched", async () => {
    const f = fakeFetch(new Uint8Array([1]));
    const p = pair(fromTab);
    serveImagePort(
      p.workerPort,
      deps(f, async () => false)
    );
    await expect(fetchViaWorker("https://x/a.png", undefined, () => p.pagePort)).rejects.toThrow(
      "not allowed"
    );
    expect(f.calls).toHaveLength(0);
  });

  test("the worker's error reply does not include the URL", async () => {
    const url = "https://secret.example/a.png?token=abc";
    const failing = (async () => {
      throw new Error(url);
    }) as unknown as typeof fetch;
    const p = pair(fromTab);
    const seen: unknown[] = [];
    const post = p.workerPort.postMessage;
    p.workerPort.postMessage = (m) => {
      seen.push(m);
      post(m);
    };
    serveImagePort(p.workerPort, { fetch: failing, extensionId: ID, hasAccess: async () => true });
    await fetchViaWorker(url, undefined, () => p.pagePort).catch(() => {});
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain("secret.example");
  });

  test("aborting closes the port and stops the worker's fetch", async () => {
    let workerSignal: AbortSignal | undefined;
    const hang = ((_: string, init: RequestInit) => {
      workerSignal = init.signal ?? undefined;
      return new Promise(() => {});
    }) as unknown as typeof fetch;
    const p = pair(fromTab);
    serveImagePort(p.workerPort, { fetch: hang, extensionId: ID, hasAccess: async () => true });
    const abort = new AbortController();
    const result = fetchViaWorker("https://x/a.png", abort.signal, () => p.pagePort);
    await tick();
    abort.abort();
    await expect(result).rejects.toThrow("Aborted");
    expect(p.isClosed()).toBe(true);
    expect(workerSignal?.aborted).toBe(true);
  });

  test("a worker that goes away fails the fetch", async () => {
    const p = pair(fromTab);
    const result = fetchViaWorker("https://x/a.png", undefined, () => p.pagePort);
    p.workerPort.disconnect();
    await expect(result).rejects.toThrow();
  });
});
