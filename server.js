const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

// Buscador web para MOON LIGHT (puede usarse desde tu PC, donde no aplica el bloqueo de navegador)
async function ddgSearch(q) {
  const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q) + "&kl=es-es";
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120" }
  });
  if (!r.ok) return null;
  const html = await r.text();
  const out = [];
  const re = /result__a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?result__snippet[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 5) {
    let u = m[1];
    const ud = u.match(/uddg=([^&]+)/);
    if (ud) u = decodeURIComponent(ud[1]);
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    const snippet = (m[3] || "").replace(/<[^>]+>/g, "").trim();
    if (title && u) out.push({ title, url: u, snippet: snippet.slice(0, 180) });
  }
  return out.length ? out : null;
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // API de búsqueda web (real, desde el servidor local)
  if (urlPath === "/api/search") {
    const q = new URL(req.url, "http://localhost").searchParams.get("q") || "";
    if (q.trim().length < 2) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: "Parámetro q requerido" }));
      return;
    }
    ddgSearch(q)
      .then((data) => {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ q, results: data || [] }));
      })
      .catch(() => {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" });
        res.end(JSON.stringify({ error: "Búsqueda fallida" }));
      });
    return;
  }

  const safePath = path.normalize(path.join(ROOT, urlPath));
  if (!safePath.startsWith(ROOT)) {
    res.writeHead(403).end("Acceso denegado");
    return;
  }

  fs.readFile(safePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 - No encontrado");
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(data);
  });
});

function lanIP() {
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return "127.0.0.1";
}

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("  ================================================");
  console.log("   MOON LIGHT en línea");
  console.log("");
  console.log(`   Local:        http://localhost:${PORT}`);
  console.log(`   En tu red:    http://${lanIP()}:${PORT}`);
  console.log("");
  console.log("   Para que funcione 'para todos' usa un túnel:");
  console.log("     npx localtunnel --port 3000   (o ngrok http 3000)");
  console.log("  ================================================");
  console.log("");
});