// public/heartbeat.js
// Served from each app at /auth-client/heartbeat.js.
// Apps include it on authenticated pages: <script src="/auth-client/heartbeat.js" defer></script>
(function () {
  var INTERVAL_MS = 60000;
  function ping() {
    fetch('/api/heartbeat', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) {
          window.location.reload();
        }
      })
      .catch(function () {
        /* transient network error; try again next interval */
      });
  }
  setInterval(ping, INTERVAL_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') ping();
  });
})();
