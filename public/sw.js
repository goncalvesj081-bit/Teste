// Service worker das notificações e da instalação como app (o celular exige um). Não guarda
// nada em cache: o painel sempre busca os dados novos.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));
// sem internet, abrir o app mostra um aviso em vez da tela de erro do navegador
self.addEventListener("fetch", (ev) => {
  if (ev.request.mode !== "navigate") return;
  ev.respondWith(
    fetch(ev.request).catch(() =>
      new Response(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Apuração 2026</title>` +
          `<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#f8fafc;font:16px system-ui,sans-serif;text-align:center;padding:24px">` +
          `<div><h1 style="font-size:22px">Sem internet</h1><p style="color:#cbd5e1">A apuração precisa de conexão para trazer os números do TSE.</p>` +
          `<button onclick="location.reload()" style="margin-top:12px;padding:10px 18px;border-radius:8px;border:0;background:#2563eb;color:#fff;font:inherit">Tentar de novo</button></div>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      ),
    ),
  );
});
self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  // volta para a aba do painel (mesmo endereço); se não houver, abre uma
  const url = ev.notification.data?.url || self.registration.scope;
  const painel = new URL(self.registration.scope).pathname;
  ev.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((abertas) => {
      const aba = abertas.find((c) => new URL(c.url).pathname.startsWith(painel));
      return aba ? aba.focus() : self.clients.openWindow(url);
    }),
  );
});
