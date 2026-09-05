/* =========================================================================
   analytics.js — first-party visitor measurement for sahibachopra.com.

   Answers four questions: how many people came, when, from where, and which
   part of the page actually held them.

   How the section timing works: once a second, whichever tracked block fills
   the most of the viewport is credited with that second. The clock stops
   when the tab is hidden and when the visitor has gone quiet for two
   minutes, so a page left open over lunch does not report an hour of rapt
   attention to the Research section.

   No cookies. No IP address is ever stored. Location is resolved at the
   CloudFront edge and only the city/region/country is kept. The only things
   written to the browser are a session id (sessionStorage, dies with the
   tab) and a one-bit "seen before" flag (localStorage).
   ========================================================================= */
(function () {
  "use strict";

  var ENDPOINT = "https://dmh7ztwpjg7fq.cloudfront.net/";

  /* Visitors who have asked not to be tracked are not tracked. Flip this to
     false if you would rather count everyone. */
  var HONOR_DNT = true;

  var TICK_MS = 1000;     // how often attention is sampled
  var IDLE_MS = 120000;   // silence this long and the clock stops
  var FLUSH_MS = 60000;   // resend progress, so long visits survive a crash

  if (ENDPOINT.indexOf("__") === 0) return;            // not configured yet
  if (HONOR_DNT && (navigator.doNotTrack === "1" ||
                    window.doNotTrack === "1" ||
                    navigator.msDoNotTrack === "1")) return;
  if (navigator.webdriver) return;                      // automated browser

  /* ---- identity ------------------------------------------------------ */
  var sid, returning = false;
  try {
    sid = sessionStorage.getItem("sc_sid");
    if (!sid) {
      sid = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      sessionStorage.setItem("sc_sid", sid);
    }
    returning = localStorage.getItem("sc_seen") === "1";
    localStorage.setItem("sc_seen", "1");
  } catch (e) {
    sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  var started = Date.now();

  /* ---- what the visitor is using ------------------------------------- */
  var ua = navigator.userAgent || "";
  function device() {
    if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return "tablet";
    if (/Mobi|Android|iPhone|iPod|Windows Phone/i.test(ua)) return "mobile";
    return "desktop";
  }
  function browser() {
    if (/Edg\//.test(ua)) return "Edge";
    if (/OPR\//.test(ua)) return "Opera";
    if (/Firefox\//.test(ua)) return "Firefox";
    if (/Chrome\//.test(ua)) return "Chrome";
    if (/Safari\//.test(ua)) return "Safari";
    return "Other";
  }
  function os() {
    if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
    if (/Android/.test(ua)) return "Android";
    if (/Mac OS X/.test(ua)) return "macOS";
    if (/Windows/.test(ua)) return "Windows";
    if (/Linux/.test(ua)) return "Linux";
    return "Other";
  }

  function send(payload, useBeacon) {
    payload.sid = sid;
    payload.started = started;
    var body = JSON.stringify(payload);
    try {
      /* text/plain keeps this a "simple" request: no CORS preflight, so the
         beacon still lands while the page is being torn down. */
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain;charset=UTF-8" }));
        return;
      }
      fetch(ENDPOINT, {
        method: "POST",
        body: body,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        keepalive: true,
        mode: "cors",
        credentials: "omit",
      }).catch(function () {});
    } catch (e) {}
  }

  /* ---- the visit ------------------------------------------------------ */
  var now = new Date();
  var tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}

  send({
    t: "view",
    path: location.pathname + location.hash,
    ref: document.referrer || "",
    tz: tz,
    localHour: now.getHours(),
    localTime: now.toTimeString().slice(0, 5),
    dow: now.getDay(),
    device: device(),
    browser: browser(),
    os: os(),
    screen: window.screen ? screen.width + "x" + screen.height : "",
    lang: navigator.language || "",
    returning: returning,
  }, false);

  /* ---- attention ------------------------------------------------------ */
  var blocks = [];
  function collectBlocks() {
    blocks = [];
    var mast = document.getElementById("top");
    if (mast) blocks.push({ el: mast, id: "top", name: "Masthead" });
    var secs = document.querySelectorAll("section.sec");
    for (var i = 0; i < secs.length; i++) {
      var label = secs[i].querySelector(".bar__t");
      blocks.push({
        el: secs[i],
        id: secs[i].id,
        name: label ? label.textContent.trim() : (secs[i].id || "section " + i),
      });
    }
  }

  var sections = {};   // name -> ms
  var papers = {};     // paper title -> ms its abstract sat open
  var actions = {};    // named interaction -> how many times
  var partyMs = 0;     // ms spent with party mode running
  var activeMs = 0;
  var scrollMax = 0;
  var clicks = 0;
  var lastActivity = Date.now();
  var openPapers = Object.create(null);

  function markActive() { lastActivity = Date.now(); }
  ["scroll", "mousemove", "mousedown", "keydown", "touchstart", "wheel", "pointerdown"]
    .forEach(function (ev) {
      window.addEventListener(ev, markActive, { passive: true, capture: true });
    });
  window.addEventListener("click", function () { clicks++; markActive(); }, { passive: true, capture: true });

  /* Which block owns this second: the one covering the most of the screen. */
  function dominant() {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    var best = null, bestVisible = 0;
    for (var i = 0; i < blocks.length; i++) {
      var r = blocks[i].el.getBoundingClientRect();
      var visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (visible > bestVisible) { bestVisible = visible; best = blocks[i]; }
    }
    /* Ignore a block only barely on screen: it is scenery, not attention. */
    return bestVisible > vh * 0.15 ? best : null;
  }

  function trackScroll() {
    var doc = document.documentElement;
    var scrollable = doc.scrollHeight - window.innerHeight;
    if (scrollable <= 0) { scrollMax = 100; return; }
    var pct = Math.round(((window.pageYOffset || doc.scrollTop) / scrollable) * 100);
    if (pct > scrollMax) scrollMax = Math.max(0, Math.min(100, pct));
  }
  window.addEventListener("scroll", trackScroll, { passive: true });

  setInterval(function () {
    if (document.hidden) return;
    if (Date.now() - lastActivity > IDLE_MS) return;
    if (!blocks.length) collectBlocks();

    activeMs += TICK_MS;
    if (document.documentElement.hasAttribute("data-party")) partyMs += TICK_MS;
    var b = dominant();
    if (b) sections[b.name] = (sections[b.name] || 0) + TICK_MS;

    /* An abstract only counts while it is both open and actually on screen,
       so leaving one expanded and scrolling away does not inflate it. */
    if (b && b.id === "research") {
      for (var key in openPapers) {
        if (openPapers[key]) papers[key] = (papers[key] || 0) + TICK_MS;
      }
    }
  }, TICK_MS);

  /* ---- which papers get opened ---------------------------------------- */
  function wirePapers() {
    var items = document.querySelectorAll("#research details");
    for (var i = 0; i < items.length; i++) {
      (function (d) {
        var sum = d.querySelector("summary");
        var title = (sum ? sum.textContent : "").replace(/\s+/g, " ").trim().slice(0, 110) || "untitled";
        if (d.open) openPapers[title] = true;
        d.addEventListener("toggle", function () {
          openPapers[title] = d.open;
          markActive();
        });
      })(items[i]);
    }
  }

  /* ---- notable interactions ------------------------------------------- */
  /* Party mode is watched via the data-party attribute rather than a click
     handler on the button, so it is counted however it gets switched on and
     does not care how script.js is wired. */
  function bump(name) { if (name) actions[name] = (actions[name] || 0) + 1; }

  function wireActions() {
    var root = document.documentElement;
    var partyOn = root.hasAttribute("data-party");
    if (partyOn) bump("party mode");
    if (window.MutationObserver) {
      new MutationObserver(function () {
        var on = root.hasAttribute("data-party");
        if (on && !partyOn) bump("party mode");
        partyOn = on;
      }).observe(root, { attributes: true, attributeFilter: ["data-party"] });
    }

    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a") : null;
      if (!a) return;
      if (a.className && String(a.className).indexOf("email-link") >= 0) {
        bump("email reveal");
        return;
      }
      var href = a.getAttribute("href") || "";

      /* Same-origin files (the CV, any PDF) are relative hrefs, so they never
         reach the off-site branch below. They are the links most worth
         counting, so they get named explicitly. */
      if (/\.(pdf|docx?|pptx?|zip|csv)($|\?)/i.test(href)) {
        var file = href.split("/").pop().split("?")[0];
        bump(/cv/i.test(file) ? "CV" : "file: " + file);
        return;
      }

      /* In-page navigation: which sections people jump to deliberately. */
      if (href.charAt(0) === "#" && href.length > 1) {
        bump("nav: " + href.slice(1));
        return;
      }

      if (/^https?:/i.test(href)) {
        try {
          var host = new URL(href).hostname.replace(/^www\./, "");
          if (host && host.indexOf("sahibachopra.com") < 0) bump("link: " + host);
        } catch (err) {}
      }
    }, true);
  }

  /* ---- reporting back -------------------------------------------------- */
  var sent = false;
  function flush(final) {
    if (activeMs < 1000) return;          // nothing worth a row
    if (final && sent) return;
    if (final) sent = true;
    send({
      t: "eng",
      sections: sections,
      papers: papers,
      actions: actions,
      partyMs: partyMs,
      activeMs: activeMs,
      totalMs: Date.now() - started,
      scroll: scrollMax,
      clicks: clicks,
      device: device(),
      returning: returning,
      final: !!final,
    }, true);
  }

  setInterval(function () { flush(false); }, FLUSH_MS);
  /* pagehide is the reliable one on iOS; visibilitychange covers tab
     switches and the desktop close. Both are idempotent. */
  window.addEventListener("pagehide", function () { flush(true); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) flush(false);
  });

  function init() { collectBlocks(); wirePapers(); wireActions(); trackScroll(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
