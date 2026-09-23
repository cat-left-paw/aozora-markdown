import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { pathToFileURL } from "node:url";
export async function createWebServer({
  root = "web-dist",
  prefix = "/",
  port = 0,
} = {}) {
  const directory = await realpath(root);
  if (!prefix.startsWith("/") || !prefix.endsWith("/"))
    throw Error("prefix must start/end with /");
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (!url.pathname.startsWith(prefix)) {
        res.writeHead(404).end();
        return;
      }
      const relative = decodeURIComponent(url.pathname.slice(prefix.length));
      if (
        relative.includes("\\") ||
        relative.includes("\0") ||
        relative.split("/").includes("..")
      ) {
        res.writeHead(403).end();
        return;
      }
      let path = resolve(directory, relative || "index.html");
      if (!path.startsWith(directory + sep)) {
        res.writeHead(403).end();
        return;
      }
      path = await realpath(path);
      if (!path.startsWith(directory + sep)) {
        res.writeHead(403).end();
        return;
      }
      if ((await stat(path)).isDirectory())
        path = await realpath(resolve(path, "index.html"));
      if (!path.startsWith(directory + sep)) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader(
        "content-type",
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".txt": "text/plain; charset=utf-8",
        }[extname(path)] ?? "application/octet-stream",
      );
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(port, "127.0.0.1", yes);
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}${prefix}`,
    close: () =>
      new Promise((yes, no) => server.close((e) => (e ? no(e) : yes()))),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const server = await createWebServer({ port: 4173 });
  console.log(`Aozora Markdown: ${server.url}\n停止: Ctrl+C`);
  const stop = () => {
    void server.close().then(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
