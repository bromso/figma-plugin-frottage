const dir = import.meta.dir;

async function serveFile(pathname: string): Promise<Response> {
  if (pathname.includes("..")) return new Response("Not found", { status: 404 });
  const file = Bun.file(`${dir}${pathname}`);
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file);
}

Bun.serve({
  port: 4173,
  fetch(req) {
    const { pathname } = new URL(req.url);
    return serveFile(pathname === "/" ? "/landing.html" : pathname);
  },
});

// A second origin that serves the images and sends no CORS headers. A page on :4173 can show
// these in <img> but not fetch their bytes, which is the "blocked image" case.
Bun.serve({
  port: 4174,
  fetch(req) {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith("/assets/")) return new Response("Not found", { status: 404 });
    return serveFile(pathname);
  },
});

console.log("Fixtures on http://localhost:4173, images without CORS on http://localhost:4174");
