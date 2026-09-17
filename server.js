const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");

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

// ---------- Control local de tu PC ----------
function lanOnly(req, res) {
  const ip = req.socket.remoteAddress || "";
  if (ip !== "127.0.0.1" && ip !== "::1" && ip !== "::ffff:127.0.0.1") {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Solo local" }));
    return false;
  }
  return true;
}

function runPS(label, scriptBody) {
  const f = path.join(os.tmpdir(), "moon_pc_" + label + ".ps1");
  try { fs.writeFileSync(f, scriptBody, "utf8"); } catch { return Promise.resolve({ code: 1, out: "", err: "no tmp" }); }
  return new Promise((resolve) => {
    const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", f], { encoding: "utf8", timeout: 40000, maxBuffer: 20 * 1024 * 1024 });
    resolve({ code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() });
  });
}

const SCREEN_PS = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
[Convert]::ToBase64String($ms.ToArray())
$g.Dispose(); $bmp.Dispose()
`;

const WIN_PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class UW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$h = [UW]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { throw "No hay ventana activa" }
$r = New-Object UW+RECT
[UW]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$hh = $r.Bottom - $r.Top
if ($w -lt 20 -or $hh -lt 20) { throw "Ventana demasiado pequena" }
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
[Convert]::ToBase64String($ms.ToArray())
$g.Dispose(); $bmp.Dispose()
`;

function pcOpen(target) {
  return new Promise((resolve) => {
    const cmd = spawn("cmd", ["/c", "start", "", target], { windowsVerbatimArguments: true });
    cmd.on("error", (e) => resolve({ error: e.message }));
    cmd.on("close", () => resolve({ ok: true }));
  });
}

function pcType(text) {
  const txtFile = path.join(os.tmpdir(), "moon_pc_type.txt");
  try { fs.writeFileSync(txtFile, text, "utf8"); } catch { return Promise.resolve({ error: "no tmp" }); }
  const body = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Get-Content -Raw -Encoding UTF8 '${txtFile.replace(/'/g, "''")}' | Set-Clipboard
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 300
`;
  return runPS("type", body).then((r) => (r.err && r.err.indexOf("no") !== 0 ? { error: r.err.slice(0, 160) } : { ok: true }));
}

function pcKeys(keys) {
  const safe = keys.replace(/"/g, "");
  const body = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${safe}")
Start-Sleep -Milliseconds 200
`;
  return runPS("keys", body).then((r) => (r.err ? { error: r.err.slice(0, 160) } : { ok: true }));
}

function readBody(req, res) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 500000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch { resolve({}); } });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // API de búsqueda web (real, desde el servidor local)
  if (urlPath === "/api/search") {
    const q = new URL(req.url, "http://localhost").searchParams.get("q") || "";
    if (q.trim().length < 2) { json(res, 400, { error: "Parámetro q requerido" }); return; }
    ddgSearch(q).then((data) => json(res, 200, { q, results: data || [] })).catch(() => json(res, 502, { error: "Búsqueda fallida" }));
    return;
  }

  // Puente para NVIDIA (Nemotron): el navegador la bloquea, tu servidor local no
  if (urlPath === "/api/proxy/nvidia") {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
      res.end();
      return;
    }
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    readBody(req, res).then(async (b) => {
      try {
        const { key, model, messages } = b;
        if (!key || !model) throw new Error("Faltan key/model");
        const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
          body: JSON.stringify({ model, messages, temperature: 0.6, max_tokens: 2048 })
        }, { signal: AbortSignal.timeout(60000) });
        const j = await r.json();
        if (!r.ok) throw new Error("NVIDIA HTTP " + r.status + ": " + JSON.stringify(j).slice(0, 200));
        const txt = j.choices?.[0]?.message?.content || "";
        json(res, 200, { content: txt });
      } catch (e) {
        json(res, 502, { error: String(e.message || e) });
      }
    });
    return;
  }

  // ---------- Control local de tu PC (localhost, no expone a internet) ----------
  if (urlPath.indexOf("/api/pc/") === 0) {
    if (!lanOnly(req, res)) return;
    const action = urlPath.slice("/api/pc/".length);
    if (action === "see") {
      runPS("see", SCREEN_PS).then((r) => json(res, r.out ? 200 : 500, r.out ? { image: r.out } : { error: r.err.slice(0, 200) }));
      return;
    }
    if (action === "seeWin") {
      runPS("seeWin", WIN_PS).then((r) => json(res, r.out ? 200 : 500, r.out ? { image: r.out } : { error: r.err.slice(0, 200) }));
      return;
    }
    if (action === "open") {
      readBody(req, res).then((b) => pcOpen(String(b.target || "")).then((o) => json(res, o.ok ? 200 : 500, o)));
      return;
    }
    if (action === "type") {
      readBody(req, res).then((b) => pcType(String(b.text || "")).then((o) => json(res, o.ok ? 200 : 500, o)));
      return;
    }
    if (action === "keys") {
      readBody(req, res).then((b) => pcKeys(String(b.text || "")).then((o) => json(res, o.ok ? 200 : 500, o)));
      return;
    }
    json(res, 404, { error: "Acción desconocida: " + action });
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

// ---------- Anti-crash: el servidor NUNCA se muere ----------
function killPortZombie(port) {
  try {
    const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout || "";
    const re = new RegExp(":" + port + "\\s+\\S+\\s+LISTENING\\s+(\\d+)");
    const m = out.match(re);
    if (m && m[1] && m[1] !== String(process.pid)) {
      try { process.kill(Number(m[1])); console.log("Zombie del puerto " + port + " (PID " + m[1] + ") eliminado."); }
      catch { }
    }
  } catch { }
}

function tryListen(port, remaining) {
  const s = http.createServer((req, res) => server.emit("request", req, res));
  s.on("error", (err) => {
    if ((err.code === "EADDRINUSE" || err.code === "EACCES") && remaining > 0) {
      console.log("Puerto " + port + " ocupado. Buscando un proceso zombie…");
      killPortZombie(port);
      setTimeout(() => { try { s.close(); } catch { } tryListen(port, remaining - 1); }, 700);
    } else {
      console.error("No pude abrir el puerto " + port + ": " + err.code);
      process.exit(1);
    }
  });
  s.listen(port, "0.0.0.0", () => {
    try { fs.writeFileSync(path.join(ROOT, "moonlight.pid"), String(process.pid)); } catch { }
    console.log("");
    console.log("  ================================================");
    console.log("   MOON LIGHT en línea  (anti-crash activo)");
    console.log("");
    console.log("   Local:        http://localhost:" + port);
    console.log("   En tu red:    http://" + lanIP() + ":" + port);
    console.log("");
    console.log("   CPU y RAM de tu PC a tu mando: captura la pantalla,");
    console.log("   abre apps, escribe texto y pulsa teclas (solo local).");
    console.log("  ================================================");
    console.log("");
  });
}
tryListen(PORT, 5);