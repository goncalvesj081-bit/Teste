// Ensaio geral: imita o TSE para o 2º turno de 2026 (eleição 6258). A apuração anda sozinha em DUR
// segundos, com um resultado definido de antemão; o resto (1º turno, configurações) vai ao TSE real.
//   DUR=150 NODE_USE_ENV_PROXY=1 node scripts/ensaio-tse-falso.mjs public/base/presidente-2026-t1.json
//   TSE_ORIGIN=http://localhost:8098 PORT=8096 node server.js
//   abrir http://localhost:8096/?fonte=tse&turno=2&cargo=0001
import http from "node:http";
import fs from "node:fs";

const PORT = 8098, DUR = Number(process.env.DUR || 120) * 1000, inicio = Date.now() + 5000;
const base = JSON.parse(fs.readFileSync(process.argv[2])).ufs;
const REG = { AC: "N", AM: "N", AP: "N", PA: "N", RO: "N", RR: "N", TO: "N", AL: "NE", BA: "NE", CE: "NE", MA: "NE", PB: "NE", PE: "NE", PI: "NE", RN: "NE", SE: "NE", DF: "CO", GO: "CO", MS: "CO", MT: "CO", ES: "SE", MG: "SE", RJ: "SE", SP: "SE", PR: "S", RS: "S", SC: "S", ZZ: "EX" };
const ATRASO = { S: 0, SE: 0.04, CO: 0.06, N: 0.16, NE: 0.2, EX: 0.3 };
// resultado escolhido: em relação ao 1º turno (só os dois), Lula ganha 1,5 p.p. no Nordeste, perde 1 no Sul
const DESLOC = { NE: 0.015, N: 0.005, S: -0.01, SE: 0.002, CO: -0.004, EX: 0 };
const rng = (s) => { let x = s >>> 0 || 1; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296); };

const verdade = { f: 0, l: 0 };
const cidades = {};
for (const [uf, d] of Object.entries(base)) {
  const maior = Math.max(...Object.values(d.cidades).map((x) => x[1]));
  cidades[uf] = Object.entries(d.cidades).map(([cod, [ts, v, x22, x13]]) => {
    const r = rng(Number(cod) * 7 + uf.charCodeAt(0));
    const sL = Math.min(0.98, Math.max(0.02, x13 / (x13 + x22 || 1) + DESLOC[REG[uf]] + (r() - 0.5) * 0.02));
    const val = Math.round(v * 0.985);
    verdade.l += val * sL; verdade.f += val * (1 - sL);
    return { cod, ts, val, sL, atraso: ATRASO[REG[uf]] + r() * 0.25 + 0.12 * Math.sqrt(v / maior), ritmo: 1.4 + r() * 0.8, eleit: Math.round(v * 1.28) };
  });
}
console.log(`resultado escolhido: Lula ${(verdade.l / (verdade.l + verdade.f) * 100).toFixed(2)}% × Flávio ${(verdade.f / (verdade.l + verdade.f) * 100).toFixed(2)}%`);

function foto(c) {
  const t = (Date.now() - inicio) / DUR;
  const f = Math.max(0, Math.min(1, (t - c.atraso) * c.ritmo));
  const st = Math.round(c.ts * f), k = st / c.ts;
  const val = Math.round(c.val * k), l = Math.round(val * c.sL);
  return { ts: c.ts, st, te: c.eleit, est: Math.round(c.eleit * k), comp: Math.round(val * 1.05), val, l, f: val - l };
}
const soma = (fs_) => fs_.reduce((a, x) => ({ ts: a.ts + x.ts, st: a.st + x.st, te: a.te + x.te, est: a.est + x.est, comp: a.comp + x.comp, val: a.val + x.val, l: a.l + x.l, f: a.f + x.f }), { ts: 0, st: 0, te: 0, est: 0, comp: 0, val: 0, l: 0, f: 0 });
function arquivo(tp, cd, x) {
  const d = new Date();
  return {
    ele: "6258", t: "2", tpabr: tp, cdabr: cd, dt: d.toLocaleDateString("pt-BR"), ht: d.toTimeString().slice(0, 8),
    s: { ts: String(x.ts), st: String(x.st) }, e: { te: String(x.te), est: String(x.est), c: String(x.comp), a: String(x.est - x.comp) },
    v: { vb: String(Math.round(x.val * 0.02)), tvn: String(Math.round(x.val * 0.03)), vv: String(x.val) },
    carg: [{ agr: [
      { par: [{ sg: "PL", cand: [{ n: "22", nm: "FLAVIO NANTES BOLSONARO", nmu: "FLAVIO BOLSONARO", vap: String(x.f), st: "" }] }] },
      { par: [{ sg: "PT", cand: [{ n: "13", nm: "LUIZ INACIO LULA DA SILVA", nmu: "LULA", vap: String(x.l), st: "" }] }] },
    ] }],
  };
}
const resp = (res, obj) => { res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x").pathname;
  let m;
  if ((m = u.match(/^\/oficial\/ele2026\/6258\/dados\/(\w\w)\/(\w\w)(\d*)-c0001-e006258-u\.json$/))) {
    const uf = m[1].toUpperCase();
    if (uf === "BR") return resp(res, arquivo("br", "br", soma(Object.values(cidades).flatMap((cs) => cs.map(foto)))));
    if (!cidades[uf]) { res.writeHead(404); return res.end(); }
    if (!m[3]) return resp(res, arquivo("uf", m[1], soma(cidades[uf].map(foto))));
    const c = cidades[uf].find((x) => x.cod === m[3]);
    if (!c) { res.writeHead(404); return res.end(); }
    return resp(res, arquivo("mu", m[3], foto(c)));
  }
  if ((m = u.match(/^\/oficial\/ele2026\/6258\/dados\/(\w\w)\/\w\w-e006258-ab\.json$/))) {
    const uf = m[1].toUpperCase();
    if (!cidades[uf]) { res.writeHead(404); return res.end(); }
    return resp(res, { abr: cidades[uf].map((c) => { const x = foto(c); return { tpabr: "mun", cdabr: c.cod, s: { ts: String(x.ts), st: String(x.st) } }; }) });
  }
  // o resto vai para o TSE de verdade
  try {
    const r = await fetch("https://resultados.tse.jus.br" + u);
    res.writeHead(r.status, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(502); res.end(); }
}).listen(PORT, () => console.log("TSE falso em", PORT));
