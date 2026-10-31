const dir = import.meta.dir;

Bun.serve({
  port: 4173,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    const name = pathname === "/" ? "/landing.html" : pathname;
    if (name.includes("..")) return new Response("Not found", { status: 404 });
    const file = Bun.file(`${dir}${name}`);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    return new Response(file);
  },
});

console.log("Fixtures on http://localhost:4173");
