// public/suite-return.js
// Served from each app at /auth-client/suite-return.js. Include on app shells:
//   <script src="/auth-client/suite-return.js" defer></script>
// Reveals any hidden [data-suite-return] element when the caller is an
// authenticated suite user, and points it at the hub dashboard. Fails safe
// (anon or network error -> button stays hidden). Works with or without defer.
(function () {
  function reveal() {
    fetch("/auth/whoami", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : { authed: false }; })
      .then(function (d) {
        if (!d || !d.authed) return;
        var els = document.querySelectorAll("[data-suite-return]");
        for (var i = 0; i < els.length; i++) {
          if (d.dashboardUrl) els[i].setAttribute("href", d.dashboardUrl);
          els[i].hidden = false;
        }
      })
      .catch(function () { /* stay hidden */ });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", reveal);
  } else {
    reveal();
  }
})();
