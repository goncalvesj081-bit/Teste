// Service worker só para as notificações do painel (no Android elas precisam dele). Não guarda
// nada em cache: o painel sempre busca os dados novos.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => ev.waitUntil(self.clients.claim()));
self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  ev.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((abertas) =>
      abertas.length ? abertas[0].focus() : self.clients.openWindow(ev.notification.data?.url || "./"),
    ),
  );
});
