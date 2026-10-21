// Servidor sem dependências: serve o painel e faz proxy para a API pública de
// resultados do TSE (evita bloqueio de CORS no navegador).
//
//   node server.js            -> http://localhost:8080
//   PORT=3000 node server.js

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 8080;
const TSE_ORIGIN = process.env.TSE_ORIGIN || "https://resultados.tse.jus.br";
const PUBLIC_DIR = path.join(__dirname, "public");
const CACHE_MS = 15_000; // o TSE atualiza os arquivos a cada poucos segundos

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const cache = new Map(); // url -> { at, status, body }

async function proxyTse(req, res, tsePath) {
  if (!/^\/oficial\/[\w\-./]+\.json$/.test(tsePath)) {
    res.writeHead(400).end("caminho inválido");
    return;
  }
  const url = TSE_ORIGIN + tsePath;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    res.writeHead(hit.status, { "content-type": MIME[".json"], "x-cache": "hit" }).end(hit.body);
    return;
  }
  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    const body = Buffer.from(await r.arrayBuffer());
    cache.set(url, { at: Date.now(), status: r.status, body });
    res.writeHead(r.status, { "content-type": MIME[".json"], "x-cache": "miss" }).end(body);
  } catch (err) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" }).end("falha ao acessar o TSE: " + err.message);
  }
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("não encontrado");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" }).end(data);
  });
}

http
  .createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (pathname.startsWith("/tse/")) return proxyTse(req, res, pathname.slice(4));
    serveStatic(req, res, decodeURIComponent(pathname));
  })
  .listen(PORT, () => console.log(`Painel em http://localhost:${PORT}`));
