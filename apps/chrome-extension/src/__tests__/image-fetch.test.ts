import { describe, expect, test } from "bun:test";
import { collectAssets } from "@repo/capture-dom";
import type { Capture } from "@repo/capture-schema";
import {
  type ClientPort,
  fetchViaWorker,
  isPrivateHost,
  makeFetchBytes,
  type PortLike,
  readImage,
  serveImagePort,
} from "../image-fetch";

const ID = "ext-id";

/** A fetch that records its init and answers with `body`, in `pieces` reads. */
function fakeFetch(
  body: Uint8Array,
  opts: {
    status?: number;
    headers?: Record<string, string>;
    pieces?: number;
    /** Reported as the response's final URL, as after a redirect. */
    finalUrl?: string;
  } = {}
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
    const res = new Response(stream, {
      status: opts.status ?? 200,
      headers: { "content-type": "image/png", ...opts.headers },
    });
    if (opts.finalUrl) Object.defineProperty(res, "url", { value: opts.finalUrl });
    return res;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** Two linked ports: what the page posts reaches the worker, and the other way round. */
function pair(sender: PortLike["sender"], name = "frottage-image:run1:n1") {
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
    name,
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
  const fromTab = { id: ID, tab: { id: 1 }, origin: "https://shop.example" };
  const deps = (f: ReturnType<typeof fakeFetch>, hasAccess = async () => true) => ({
    fetch: f.impl,
    extensionId: ID,
    hasAccess,
    runIsLive: async () => true,
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
    serveImagePort(p.workerPort, { ...deps(fakeFetch(new Uint8Array())), fetch: failing });
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
    serveImagePort(p.workerPort, { ...deps(fakeFetch(new Uint8Array())), fetch: hang });
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

describe("private addresses", () => {
  const blocked = [
    "http://localhost/a.png",
    "http://app.localhost/a.png",
    "http://printer.local/a.png",
    "http://127.0.0.1/a.png",
    "http://127.255.0.9/a.png",
    "http://2130706433/a.png",
    "http://0x7f.1/a.png",
    "http://10.0.0.5/a.png",
    "http://172.16.0.1/a.png",
    "http://172.31.255.1/a.png",
    "http://192.168.1.1/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/a.png",
    "http://100.64.0.1/a.png",
    "http://[::1]/a.png",
    "http://[fc00::1]/a.png",
    "http://[fd12:3456::1]/a.png",
    "http://[fe80::1]/a.png",
    "http://[::ffff:127.0.0.1]/a.png",
    "http://[::ffff:10.0.0.1]/a.png",
  ];
  const open = [
    "https://cdn.example/a.png",
    "http://8.8.8.8/a.png",
    "http://172.15.0.1/a.png",
    "http://172.32.0.1/a.png",
    "http://100.128.0.1/a.png",
    "http://169.253.0.1/a.png",
    "http://[2001:db8::1]/a.png",
    "http://[::ffff:8.8.8.8]/a.png",
    "https://localhost.example.com/a.png",
  ];

  test.each(blocked)("%s is private", (url) => {
    expect(isPrivateHost(new URL(url).hostname)).toBe(true);
  });
  test.each(open)("%s is public", (url) => {
    expect(isPrivateHost(new URL(url).hostname)).toBe(false);
  });

  test.each(blocked)("%s is refused before any request", async (url) => {
    const f = fakeFetch(new Uint8Array([1]));
    await expect(readImage(url, { fetch: f.impl, allowPrivate: false })).rejects.toThrow(
      "not allowed"
    );
    expect(f.calls).toHaveLength(0);
  });

  test("a redirect to a private address is refused before the body is read", async () => {
    const f = fakeFetch(new Uint8Array([1, 2]), { finalUrl: "http://169.254.169.254/latest" });
    await expect(
      readImage("https://cdn.example/a.png", { fetch: f.impl, allowPrivate: false })
    ).rejects.toThrow("not allowed");
  });

  test("a page on a private origin may fetch private addresses", async () => {
    for (const origin of ["http://localhost:3000", "http://192.168.1.20:8080"]) {
      const f = fakeFetch(new Uint8Array([1]));
      const p = pair({ id: ID, tab: { id: 1 }, origin });
      serveImagePort(p.workerPort, {
        fetch: f.impl,
        extensionId: ID,
        hasAccess: async () => true,
        runIsLive: async () => true,
      });
      const blob = await fetchViaWorker("http://127.0.0.1:3000/a.png", undefined, () => p.pagePort);
      expect(blob.size).toBe(1);
    }
  });

  test("a public page may not", async () => {
    const f = fakeFetch(new Uint8Array([1]));
    const p = pair({ id: ID, tab: { id: 1 }, origin: "https://shop.example" });
    serveImagePort(p.workerPort, {
      fetch: f.impl,
      extensionId: ID,
      hasAccess: async () => true,
      runIsLive: async () => true,
    });
    await expect(
      fetchViaWorker("http://127.0.0.1:3000/a.png", undefined, () => p.pagePort)
    ).rejects.toThrow("not allowed");
    expect(f.calls).toHaveLength(0);
  });

  test("a port with no readable origin is treated as public", async () => {
    const f = fakeFetch(new Uint8Array([1]));
    const p = pair({ id: ID, tab: { id: 1 } });
    serveImagePort(p.workerPort, {
      fetch: f.impl,
      extensionId: ID,
      hasAccess: async () => true,
      runIsLive: async () => true,
    });
    await expect(
      fetchViaWorker("http://localhost/a.png", undefined, () => p.pagePort)
    ).rejects.toThrow("not allowed");
  });
});

describe("only images are returned", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
  const run = (body: Uint8Array, type: string | null) => {
    const f = fakeFetch(body, {
      headers: type === null ? { "content-type": "" } : { "content-type": type },
    });
    return readImage("https://cdn.example/a", { fetch: f.impl });
  };

  test("image/* types pass", async () => {
    expect((await run(new Uint8Array([1]), "image/webp")).bytes).toHaveLength(1);
    expect((await run(new TextEncoder().encode("<svg/>"), "image/svg+xml")).bytes).toHaveLength(6);
  });

  test("other types are refused", async () => {
    for (const type of ["text/html", "application/json", "text/plain"]) {
      await expect(run(png, type)).rejects.toThrow("not allowed");
    }
  });

  test("no type, or octet-stream, needs image magic bytes", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]);
    const gif = new TextEncoder().encode("GIF89a....");
    const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
    const avif = new TextEncoder().encode("\0\0\0\x1cftypavif....");
    for (const body of [png, jpeg, gif, webp, avif]) {
      expect((await run(body, null)).bytes.length).toBe(body.length);
      expect((await run(body, "application/octet-stream")).bytes.length).toBe(body.length);
    }
    await expect(run(new TextEncoder().encode("<html>"), null)).rejects.toThrow("not allowed");
    await expect(run(new TextEncoder().encode("{}"), "application/octet-stream")).rejects.toThrow(
      "not allowed"
    );
  });

  test("SVG-looking bytes are an image only with an svg type", async () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="x"/>');
    await expect(run(svg, null)).rejects.toThrow("not allowed");
    await expect(run(svg, "application/octet-stream")).rejects.toThrow("not allowed");
    expect((await run(svg, "image/svg+xml")).bytes.length).toBe(svg.length);
  });

  test("a refused body is never posted", async () => {
    const f = fakeFetch(new TextEncoder().encode("<html>secret</html>"), {
      headers: { "content-type": "text/html" },
    });
    const p = pair({ id: ID, tab: { id: 1 }, origin: "https://shop.example" });
    const seen: unknown[] = [];
    const post = p.workerPort.postMessage;
    p.workerPort.postMessage = (m) => {
      seen.push(m);
      post(m);
    };
    serveImagePort(p.workerPort, {
      fetch: f.impl,
      extensionId: ID,
      hasAccess: async () => true,
      runIsLive: async () => true,
    });
    await fetchViaWorker("https://x/a", undefined, () => p.pagePort).catch(() => {});
    expect(JSON.stringify(seen)).not.toContain("secret");
    expect(seen).toEqual([{ type: "image-error", message: "Image access is not allowed" }]);
  });
});

describe("the run behind a port", () => {
  const sender = { id: ID, tab: { id: 1 }, origin: "https://shop.example" };
  const base = (f: ReturnType<typeof fakeFetch>, runIsLive: (id: string) => Promise<boolean>) => ({
    fetch: f.impl,
    extensionId: ID,
    hasAccess: async () => true,
    runIsLive,
  });

  test("the worker asks about the run named in the port, and fetches only when it is live", async () => {
    const asked: string[] = [];
    const f = fakeFetch(new Uint8Array([1]));
    const p = pair(sender, "frottage-image:run-42:abc");
    serveImagePort(
      p.workerPort,
      base(f, async (id) => {
        asked.push(id);
        return true;
      })
    );
    await fetchViaWorker("https://x/a.png", undefined, () => p.pagePort);
    expect(asked).toEqual(["run-42"]);
  });

  test("a run that is not live gets nothing fetched", async () => {
    const f = fakeFetch(new Uint8Array([1]));
    const p = pair(sender);
    serveImagePort(
      p.workerPort,
      base(f, async () => false)
    );
    await expect(fetchViaWorker("https://x/a.png", undefined, () => p.pagePort)).rejects.toThrow(
      "not allowed"
    );
    expect(f.calls).toHaveLength(0);
  });

  test("a port with no run id is refused", () => {
    const f = fakeFetch(new Uint8Array([1]));
    const p = pair(sender, "frottage-image:");
    serveImagePort(
      p.workerPort,
      base(f, async () => true)
    );
    expect(p.isClosed()).toBe(true);
  });
});

describe("port protocol guards", () => {
  const sender = { id: ID, tab: { id: 1 }, origin: "https://shop.example" };
  const serve = (f: ReturnType<typeof fakeFetch>) => {
    const p = pair(sender);
    serveImagePort(p.workerPort, {
      fetch: f.impl,
      extensionId: ID,
      hasAccess: async () => true,
      runIsLive: async () => true,
    });
    return p;
  };

  test("a port serves one request", async () => {
    const f = fakeFetch(new Uint8Array([1]));
    const p = serve(f);
    p.pagePort.postMessage({ type: "fetch-image", url: "https://x/a.png" });
    p.pagePort.postMessage({ type: "fetch-image", url: "https://x/b.png" });
    await tick();
    expect(f.calls.map((c) => c.url)).toEqual(["https://x/a.png"]);
  });

  test("a message of another type, or without a string URL, is ignored", async () => {
    const f = fakeFetch(new Uint8Array([1]));
    const p = serve(f);
    for (const m of [
      { type: "other", url: "https://x/a" },
      { type: "fetch-image" },
      { type: "fetch-image", url: 5 },
      null,
      "x",
    ]) {
      p.pagePort.postMessage(m);
    }
    await tick();
    expect(f.calls).toHaveLength(0);
    expect(p.isClosed()).toBe(false);
  });

  test("the page side refuses more than the cap", async () => {
    const f = fakeFetch(new Uint8Array(40));
    const p = serve(f);
    // The worker's cap is not lowered here; the page's own cap is.
    await expect(
      fetchViaWorker("https://x/a.png", undefined, () => p.pagePort, 10)
    ).rejects.toThrow("larger than 32 MiB");
    expect(p.isClosed()).toBe(true);
  });
});

describe("makeFetchBytes", () => {
  const fail = async () => {
    throw new Error("Failed to fetch");
  };
  const setup = (over: {
    pageFetch?: (u: string, s?: AbortSignal) => Promise<Blob>;
    imageAccess?: boolean;
  }) => {
    const connects: string[] = [];
    const urls: string[] = [];
    const f = makeFetchBytes({
      pageFetch: over.pageFetch ?? fail,
      imageAccess: over.imageAccess ?? false,
      fetchViaWorker: async (url) => {
        urls.push(url);
        return new Blob([new Uint8Array([9])]);
      },
    });
    return { f, connects, urls };
  };

  test("a page success never reaches the worker", async () => {
    const t = setup({ pageFetch: async () => new Blob([new Uint8Array([1])]), imageAccess: true });
    expect((await t.f("https://x/a.png")).size).toBe(1);
    expect(t.urls).toEqual([]);
  });

  test("a page failure without access stays a failure", async () => {
    const t = setup({ imageAccess: false });
    await expect(t.f("https://x/a.png")).rejects.toThrow("Failed to fetch");
    expect(t.urls).toEqual([]);
  });

  test("a page failure with access asks the worker", async () => {
    const t = setup({ imageAccess: true });
    expect((await t.f("https://x/a.png?t=1")).size).toBe(1);
    expect(t.urls).toEqual(["https://x/a.png?t=1"]);
  });

  test("an aborted fetch does not ask the worker", async () => {
    const abort = new AbortController();
    abort.abort();
    const t = setup({ imageAccess: true });
    await expect(t.f("https://x/a.png", abort.signal)).rejects.toThrow();
    expect(t.urls).toEqual([]);
  });

  test("through collectAssets the worker gets the full URL and the file only the clean one", async () => {
    const full = "https://cdn.example/a.png?token=secret#frag";
    const t = setup({ imageAccess: true });
    const side = { width: 0, color: { r: 0, g: 0, b: 0, a: 0 }, style: "none" };
    const node = {
      id: "i",
      kind: "image",
      box: { x: 0, y: 0, w: 10, h: 10 },
      sourceUrl: full,
      borders: { top: side, right: side, bottom: side, left: side },
    };
    const capture = {
      assets: [],
      warnings: [],
      root: {
        id: "r",
        kind: "element",
        box: node.box,
        style: { backgroundImages: [] },
        children: [node],
      },
    } as unknown as Capture;
    const r = await collectAssets(capture, {
      fetchBytes: t.f,
      normalise: async (blob) => ({
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: "image/png",
        width: 4,
        height: 3,
      }),
    });
    expect(t.urls).toEqual([full]);
    const stored = JSON.stringify(r.capture);
    expect(stored).not.toContain("secret");
    expect(stored).not.toContain("frag");
    expect(r.capture.assets[0]?.sourceUrl).toBe("https://cdn.example/a.png");
  });
});
