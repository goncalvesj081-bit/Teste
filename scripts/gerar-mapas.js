// Gera os mapas em SVG (paths pré-projetados) a partir dos polígonos do IBGE.
// Fonte: pacote npm ibge-cidades-com-poligonos (malhas municipais do IBGE).
//   npm i topojson-server@3.0.1 topojson-simplify@3.0.3 topojson-client@3.1.0
//   node scripts/gerar-mapas.js <municipios-poligonos.json> public/mapas
const fs = require("fs");
const path = require("path");
const { topology } = require("topojson-server");
const { presimplify, simplify, quantile } = require("topojson-simplify");
const { feature, merge } = require("topojson-client");

const [src, outDir] = process.argv.slice(2);
const dados = JSON.parse(fs.readFileSync(src, "utf8"));
fs.mkdirSync(outDir, { recursive: true });

const features = {};
for (const m of dados) {
  features[m.municipioCodigo] = { type: "Feature", properties: { uf: m.ufSigla, cdi: m.municipioCodigo }, geometry: m.poligono };
}

function construir(feats, q) {
  let topo = topology({ m: { type: "FeatureCollection", features: feats } }, 1e6);
  topo = presimplify(topo);
  return simplify(topo, quantile(topo, q));
}

// projeção equirretangular com correção de latitude, encaixada numa largura fixa
function projetor(geoms, largura) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const pontos = (g, f) => {
    const cs = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of cs) for (const anel of poly) for (const p of anel) f(p);
  };
  geoms.forEach((g) => pontos(g, ([lon, lat]) => { x0 = Math.min(x0, lon); x1 = Math.max(x1, lon); y0 = Math.min(y0, lat); y1 = Math.max(y1, lat); }));
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const escala = largura / ((x1 - x0) * k);
  const altura = Math.ceil((y1 - y0) * escala);
  const proj = ([lon, lat]) => [(lon - x0) * k * escala, (y1 - lat) * escala];
  const d = (g) => {
    const cs = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    let s = "";
    for (const poly of cs) {
      for (const anel of poly) {
        let ult = null, parte = "";
        for (const p of anel) {
          const [x, y] = proj(p).map((v) => Math.round(v * 10) / 10);
          const chave = x + "," + y;
          if (chave === ult) continue;
          parte += (parte ? "L" : "M") + chave;
          ult = chave;
        }
        if (parte.split("L").length >= 3) s += parte + "Z";
      }
    }
    return s;
  };
  return { viewBox: `0 0 ${largura} ${altura}`, d };
}

const todas = Object.values(features);

// Brasil por UF: municípios fundidos por estado
{
  const topo = construir(todas, 0.12);
  const geoms = topo.objects.m.geometries;
  const porUf = {};
  for (const g of geoms) (porUf[g.properties.uf] ||= []).push(g);
  const ufs = Object.fromEntries(Object.entries(porUf).map(([uf, gs]) => [uf, merge(topo, gs)]));
  const p = projetor(Object.values(ufs), 1000);
  const out = { viewBox: p.viewBox, ufs: Object.fromEntries(Object.entries(ufs).map(([uf, g]) => [uf, p.d(g)])) };
  fs.writeFileSync(path.join(outDir, "br.json"), JSON.stringify(out));
  console.log("br.json", JSON.stringify(out).length);
}

// Cada estado por município
const ufs = [...new Set(todas.map((f) => f.properties.uf))];
for (const uf of ufs) {
  const feats = todas.filter((f) => f.properties.uf === uf);
  const topo = construir(feats, feats.length > 300 ? 0.25 : 0.4);
  const geo = feature(topo, topo.objects.m).features;
  const p = projetor(geo.map((f) => f.geometry), 1000);
  const out = { viewBox: p.viewBox, mun: Object.fromEntries(geo.map((f) => [f.properties.cdi, p.d(f.geometry)])) };
  fs.writeFileSync(path.join(outDir, uf.toLowerCase() + ".json"), JSON.stringify(out));
  console.log(uf, feats.length, JSON.stringify(out).length);
}
