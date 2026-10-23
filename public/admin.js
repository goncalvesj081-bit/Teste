// Página de acessos: lê os números do banco (supabase/acessos.sql) com a senha do admin.
import { ACESSOS } from "./config.js?v=24";
import { UFS, REGIOES } from "./data.js?v=17";

const $ = (s) => document.querySelector(s);
const fmt = new Intl.NumberFormat("pt-BR");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const hora = (d) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const ATUALIZA_MS = 15_000;

let senha = "";
try { senha = sessionStorage.getItem("admin-senha") || ""; } catch {}
let timer = null;

function aviso(txt, erro = false) {
  const el = $("#aviso");
  el.textContent = txt;
  el.classList.toggle("erro", erro);
  el.hidden = !txt;
}

function status(estado, txt) {
  $("#status").dataset.estado = estado;
  $("#status-txt").textContent = txt;
}

async function buscar() {
  const r = await fetch(`${ACESSOS.url.replace(/\/$/, "")}/rest/v1/rpc/estatisticas_acessos`, {
    method: "POST",
    headers: { apikey: ACESSOS.chave, "content-type": "application/json" },
    body: JSON.stringify({ p_senha: senha }),
    cache: "no-store",
  });
  const corpo = await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(corpo?.message || `erro ${r.status}`);
    e.senha = corpo?.code === "28P01" || /senha incorreta/.test(corpo?.message || "");
    throw e;
  }
  return corpo;
}

function renderGrafico(serie) {
  const el = $("#grafico");
  // completa as faixas de 5 minutos sem ninguém, para o gráfico não pular buracos
  const passo = 5 * 60_000;
  const fim = Math.floor(Date.now() / passo) * passo;
  const inicio = fim - 24 * 60 * 60_000;
  const por = new Map(serie.map((p) => [new Date(p.t).getTime(), p.n]));
  const pts = [];
  for (let t = inicio; t <= fim; t += passo) pts.push({ t, n: por.get(t) || 0 });
  const W = Math.max(300, el.clientWidth || 700), H = W < 520 ? 180 : 220;
  const m = { l: 40, r: 12, t: 12, b: 26 };
  const max = Math.max(5, ...pts.map((p) => p.n));
  const passoY = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].find((s) => max / s <= 5) || 20000;
  const topo = Math.ceil(max / passoY) * passoY;
  const X = (t) => m.l + ((t - inicio) / (fim - inicio)) * (W - m.l - m.r);
  const Y = (n) => m.t + (1 - n / topo) * (H - m.t - m.b);
  let grade = "";
  for (let y = 0; y <= topo; y += passoY) {
    grade += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(y)}" y2="${Y(y)}"></line><text x="${m.l - 6}" y="${Y(y) + 4}" text-anchor="end">${fmt.format(y)}</text>`;
  }
  let eixo = "";
  for (let h = 0; h <= 24; h += W < 520 ? 6 : 3) {
    const t = inicio + h * 60 * 60_000;
    eixo += `<text x="${X(t)}" y="${H - 6}" text-anchor="${h === 0 ? "start" : h === 24 ? "end" : "middle"}">${h === 24 ? "agora" : hora(new Date(t))}</text>`;
  }
  const linha = pts.map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p.n).toFixed(1)}`).join("");
  const area = `${linha}L${X(fim)},${Y(0)}L${X(inicio)},${Y(0)}Z`;
  const u = pts[pts.length - 1];
  el.innerHTML = `<svg class="linha-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pessoas online nas últimas 24 horas">
    <g class="grade">${grade}</g>${eixo}
    <path d="${area}" class="area"></path>
    <path d="${linha}" class="serie"></path>
    <circle class="ponto" cx="${X(u.t)}" cy="${Y(u.n)}" r="4"></circle>
    <line class="mira" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" visibility="hidden"></line>
    <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"></rect>
  </svg>`;
  const svg = el.querySelector("svg"), mira = svg.querySelector(".mira"), tip = $("#tooltip");
  svg.addEventListener("pointermove", (ev) => {
    const box = svg.getBoundingClientRect();
    const t = inicio + ((((ev.clientX - box.left) / box.width) * W - m.l) / (W - m.l - m.r)) * (fim - inicio);
    const p = pts[Math.max(0, Math.min(pts.length - 1, Math.round((t - inicio) / passo)))];
    mira.setAttribute("x1", X(p.t)); mira.setAttribute("x2", X(p.t)); mira.setAttribute("visibility", "visible");
    tip.innerHTML = `<strong>${hora(new Date(p.t))}</strong><div><span>Pessoas online</span><b>${fmt.format(p.n)}</b></div>`;
    tip.hidden = false;
    tip.style.left = Math.max(8, Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8)) + "px";
    tip.style.top = Math.max(8, Math.min(ev.clientY + 14, innerHeight - tip.offsetHeight - 8)) + "px";
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; mira.setAttribute("visibility", "hidden"); });
}

function barras(lista) {
  const max = Math.max(1, ...lista.map((x) => x.n));
  return lista
    .map((x) => `<li><div class="linha"><span>${esc(x.rotulo)}</span><b>${fmt.format(x.n)}</b></div>
      <div class="barra"><i style="width:${(x.n / max) * 100}%"></i></div></li>`)
    .join("");
}

function render(d) {
  $("#k-agora").textContent = fmt.format(d.agora);
  $("#k-15").textContent = fmt.format(d.ultimos15);
  $("#k-hoje").textContent = fmt.format(d.hoje);
  $("#k-total").textContent = fmt.format(d.total);
  $("#k-visitas").textContent = `pessoas · ${fmt.format(d.visitas)} visitas`;
  renderGrafico(d.serie || []);
  const ap = d.aparelhos || {};
  const totalAp = (ap.celular || 0) + (ap.computador || 0);
  $("#aparelhos").innerHTML = totalAp
    ? `<ol class="vendo">${barras([
        { rotulo: `Celular · ${Math.round(((ap.celular || 0) / totalAp) * 100)}%`, n: ap.celular || 0 },
        { rotulo: `Computador · ${Math.round(((ap.computador || 0) / totalAp) * 100)}%`, n: ap.computador || 0 },
      ])}</ol>`
    : `<p class="nota">Ninguém online agora.</p>`;
  const vendo = (d.vendo || []).map((v) => ({ rotulo: v.vendo || "Brasil", n: v.n }));
  $("#vendo").innerHTML = vendo.length ? barras(vendo) : `<li class="vazio">Ninguém online agora.</li>`;
  $("#rodape-admin").textContent =
    `Atualiza sozinho a cada 15 segundos. "Online" = página aberta e visível no último minuto ou dois. ` +
    `Cada pessoa é um navegador (o mesmo celular conta uma vez, mesmo voltando várias vezes).`;
}

async function atualizar() {
  try {
    const d = await buscar();
    aviso("");
    // mostra a área antes de desenhar, para o gráfico medir a largura certa
    $("#entrar").hidden = true;
    $("#numeros").hidden = false;
    $("#sair").hidden = false;
    mostrarDivulgacao();
    render(d);
    status("aovivo", `Atualizado às ${hora(new Date())}`);
    clearTimeout(timer);
    timer = setTimeout(atualizar, ATUALIZA_MS);
  } catch (e) {
    if (e.senha) {
      senha = "";
      try { sessionStorage.removeItem("admin-senha"); } catch {}
      clearTimeout(timer);
      $("#entrar").hidden = false;
      $("#numeros").hidden = true;
      $("#divulgar").hidden = true;
      status("erro", "Senha incorreta");
      aviso("Senha incorreta. Confira a senha que você colocou no script do banco.", true);
      $("#senha").focus();
      return;
    }
    // falha de rede ou do banco: mantém os últimos números e tenta de novo
    status("erro", "Sem conexão com o banco");
    aviso(`Não consegui falar com o banco (${e.message}). Tentando de novo em 15 segundos.`, true);
    clearTimeout(timer);
    timer = setTimeout(atualizar, ATUALIZA_MS);
  }
}

$("#entrar").addEventListener("submit", (ev) => {
  ev.preventDefault();
  senha = $("#senha").value;
  try { sessionStorage.setItem("admin-senha", senha); } catch {}
  $("#senha").value = "";
  status("carregando", "Entrando…");
  atualizar();
});

$("#sair").addEventListener("click", () => {
  senha = "";
  try { sessionStorage.removeItem("admin-senha"); } catch {}
  clearTimeout(timer);
  $("#numeros").hidden = true;
  $("#divulgar").hidden = true;
  $("#entrar").hidden = false;
  $("#sair").hidden = true;
  status("carregando", "Entre com a senha");
});

// ------------------------------------------------------------- divulgação

// o painel fica na pasta do admin; o link curto é a raiz do site, que redireciona para ele
const PASTA = new URL("./", location.href);
const RAIZ = new URL(location.pathname.replace(/(public\/)?[^/]*$/, ""), location.origin).toString();
const GOV_2T = ["AC", "AM", "DF", "ES", "RN", "TO"]; // estados com governador no 2º turno

const TEXTOS = [
  {
    titulo: "Convite (antes do domingo)",
    texto: (l) => `🗳️ Domingo tem 2º turno! Acompanhe a apuração ao vivo, com mapa por estado e cidade e a chance de virada atualizada a cada urna: ${l}`,
  },
  {
    titulo: "Sábado à noite",
    texto: (l) => `Amanhã é dia de 2º turno. A partir das 17h dá pra acompanhar a apuração urna por urna, com os dados oficiais do TSE, aqui: ${l}`,
  },
  {
    titulo: "Domingo, começou a apuração",
    texto: (l) => `🔴 Começou a apuração do 2º turno! Quem lidera em cada estado, quantas urnas faltam e a chance de virada, ao vivo: ${l}`,
  },
  {
    titulo: "Durante a apuração",
    texto: (l) => `A disputa tá apertada 👀 Veja onde ainda faltam votos e a chance de virada em tempo real: ${l}`,
  },
];

const CANAIS = [
  { nome: "WhatsApp", url: (t) => `https://wa.me/?text=${encodeURIComponent(t)}` },
  { nome: "Telegram", url: (t, l) => `https://t.me/share/url?url=${encodeURIComponent(l)}&text=${encodeURIComponent(t.replace(l, "").trim())}` },
  { nome: "X", url: (t) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(t)}` },
  { nome: "Facebook", url: (t, l) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(l)}` },
];

const botoesRedes = (texto, link) =>
  CANAIS.map((c) => `<a class="botao link-botao" href="${esc(c.url(texto, link))}" target="_blank" rel="noopener">${c.nome}</a>`).join("") +
  `<button type="button" class="botao" data-copiar-texto="${esc(texto)}">Copiar texto</button>` +
  (navigator.share ? `<button type="button" class="botao" data-partilhar="${esc(texto)}">Mais…</button>` : "");

const QUANDO = [
  ["sexta", "Sexta: mandar o convite nos grupos de WhatsApp e Telegram"],
  ["sabado-story", "Sábado à noite: postar o story \"convite\""],
  ["sabado-grupos", "Sábado à noite: texto \"sábado à noite\" nos grupos"],
  ["domingo-17h", "Domingo, 17h: story \"começou\" e texto \"começou a apuração\""],
  ["domingo-print", "Domingo, durante a apuração: print do mapa ou da chance de virada com o link"],
  ["domingo-estados", "Domingo: link de cada estado nos grupos regionais (QR code / link por estado)"],
  ["domingo-redes", "Domingo: responder posts de perfis que cobrem a eleição no X e no Threads"],
];

function linkRecorte() {
  const rec = $("#qr-recorte").value, cargo = $("#qr-cargo").value;
  if (!rec && cargo === "0001") return RAIZ;
  const u = new URL(PASTA);
  u.searchParams.set("turno", "2");
  u.searchParams.set("cargo", cargo);
  if (rec) u.searchParams.set("recorte", rec);
  return u.toString();
}

function desenharQR() {
  const link = linkRecorte();
  $("#link-qr").value = link;
  if (typeof qrcode !== "function") { $("#qr").innerHTML = `<p class="nota">Não consegui carregar o gerador de QR code.</p>`; return; }
  const q = qrcode(0, "M");
  q.addData(link);
  q.make();
  $("#qr").innerHTML = q.createSvgTag({ cellSize: 8, margin: 3, scalable: true });
}

function nomeArquivo() {
  const rec = $("#qr-recorte").value;
  return "qr-apuracao" + (rec ? "-" + rec.replace("R:", "").toLowerCase() : "") + ($("#qr-cargo").value === "0003" ? "-governador" : "");
}

function baixar(href, nome) {
  const a = document.createElement("a");
  a.href = href; a.download = nome;
  document.body.append(a); a.click(); a.remove();
}

function baixarQR(formato) {
  const svg = $("#qr svg");
  if (!svg) return;
  const xml = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
  if (formato === "svg") { baixar(url, nomeArquivo() + ".svg"); setTimeout(() => URL.revokeObjectURL(url), 2000); return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = 1024;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, 1024, 1024);
    g.drawImage(img, 0, 0, 1024, 1024);
    URL.revokeObjectURL(url);
    c.toBlob((b) => { const u = URL.createObjectURL(b); baixar(u, nomeArquivo() + ".png"); setTimeout(() => URL.revokeObjectURL(u), 2000); });
  };
  img.src = url;
}

async function copiar(texto, botao) {
  try { await navigator.clipboard.writeText(texto); } catch {
    const t = document.createElement("textarea"); t.value = texto; document.body.append(t); t.select();
    try { document.execCommand("copy"); } catch {} t.remove();
  }
  const antes = botao.textContent;
  botao.textContent = "Copiado ✓";
  setTimeout(() => (botao.textContent = antes), 1600);
}

function montarCheck() {
  let feito = {};
  try { feito = JSON.parse(localStorage.getItem("divulgacao-feito") || "{}"); } catch {}
  $("#checklist").innerHTML = QUANDO.map(([id, txt]) =>
    `<li><label><input type="checkbox" data-id="${id}"${feito[id] ? " checked" : ""}> <span>${esc(txt)}</span></label></li>`).join("");
  $("#checklist").addEventListener("change", (ev) => {
    const id = ev.target.dataset.id;
    if (!id) return;
    feito[id] = ev.target.checked;
    try { localStorage.setItem("divulgacao-feito", JSON.stringify(feito)); } catch {}
  });
}

let divulgacaoPronta = false;
function mostrarDivulgacao() {
  $("#divulgar").hidden = false;
  if (divulgacaoPronta) return;
  divulgacaoPronta = true;
  $("#link-principal").value = RAIZ;
  $("#abrir-principal").href = RAIZ;
  $("#redes-principal").innerHTML = botoesRedes(TEXTOS[0].texto(RAIZ), RAIZ);
  $("#textos").innerHTML = TEXTOS.map((t) =>
    `<div class="texto-pronto"><b>${esc(t.titulo)}</b><p>${esc(t.texto(RAIZ))}</p><div class="redes">${botoesRedes(t.texto(RAIZ), RAIZ)}</div></div>`).join("");
  const opcoesRecorte = () => {
    const gov = $("#qr-cargo").value === "0003";
    const atual = $("#qr-recorte").value;
    const ufs = Object.keys(UFS).filter((uf) => !gov || GOV_2T.includes(uf)).sort((a, b) => UFS[a][0].localeCompare(UFS[b][0]));
    $("#qr-recorte").innerHTML =
      (gov ? "" : `<option value="">Brasil</option><optgroup label="Regiões">${REGIOES.filter((r) => r !== "Exterior").map((r) => `<option value="R:${r}">${r}</option>`).join("")}</optgroup>`) +
      `<optgroup label="Estados">${ufs.map((uf) => `<option value="${uf}">${UFS[uf][0]}</option>`).join("")}</optgroup>`;
    if ([...$("#qr-recorte").options].some((o) => o.value === atual)) $("#qr-recorte").value = atual;
  };
  opcoesRecorte();
  $("#qr-recorte").addEventListener("change", desenharQR);
  $("#qr-cargo").addEventListener("change", () => { opcoesRecorte(); desenharQR(); });
  $("#baixar-qr-png").addEventListener("click", () => baixarQR("png"));
  $("#baixar-qr-svg").addEventListener("click", () => baixarQR("svg"));
  desenharQR();
  montarCheck();
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-copiar], [data-copiar-texto], [data-partilhar]");
  if (!b) return;
  if (b.dataset.copiar) copiar($(b.dataset.copiar).value, b);
  else if (b.dataset.copiarTexto) copiar(b.dataset.copiarTexto, b);
  else navigator.share({ text: b.dataset.partilhar }).catch(() => {});
});

let largura = innerWidth;
addEventListener("resize", () => {
  if (Math.abs(innerWidth - largura) > 40 && !$("#numeros").hidden) { largura = innerWidth; atualizar(); }
});

if (!ACESSOS.url || !ACESSOS.chave) {
  $("#entrar").hidden = true;
  status("erro", "Contagem desligada");
  aviso("A contagem de acessos ainda não foi configurada: preencha public/config.js com o endereço e a chave pública do projeto do Supabase (instruções no README).", true);
} else if (senha) {
  status("carregando", "Entrando…");
  atualizar();
}
