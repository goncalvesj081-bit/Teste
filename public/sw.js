// Service worker só para as notificações do painel (no Android elas precisam dele). Não guarda
// nada em cache: o painel sempre busca os dados novos.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));
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
