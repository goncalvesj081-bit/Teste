// Página de acessos: lê os números do banco (supabase/acessos.sql) com a senha do admin.
import { ACESSOS } from "./config.js?v=19";

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
  $("#entrar").hidden = false;
  $("#sair").hidden = true;
  status("carregando", "Entre com a senha");
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
