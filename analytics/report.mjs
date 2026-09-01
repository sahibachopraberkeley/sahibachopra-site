#!/usr/bin/env node
/* =========================================================================
   report.mjs — read the visitor data and print it.

   Usage:
     node report.mjs                  # last 30 days
     node report.mjs --days 90
     node report.mjs --html           # also write and open a visual report
     node report.mjs --day 2026-09-01 # a single day in detail

   Reads DynamoDB through the AWS CLI, exactly like the PDW export script,
   so there is nothing to npm install. Requires `aws configure` to be set up
   with credentials that can read the table.

   The data never leaves the machine this runs on: the collector endpoint is
   write-only, so this is the only way to see any of it.
   ========================================================================= */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const TABLE = process.env.TABLE || "SahibaSiteAnalytics";
const REGION = process.env.REGION || "us-east-1";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const DAYS = Number(flag("days", 30));
const ONE_DAY = flag("day", null);

/* ---- DynamoDB through the CLI ----------------------------------------- */
function unmarshall(v) {
  if (v === null || v === undefined) return v;
  if ("S" in v) return v.S;
  if ("N" in v) return Number(v.N);
  if ("BOOL" in v) return v.BOOL;
  if ("NULL" in v) return null;
  if ("L" in v) return v.L.map(unmarshall);
  if ("M" in v) {
    const o = {};
    for (const [k, val] of Object.entries(v.M)) o[k] = unmarshall(val);
    return o;
  }
  return v;
}

function queryDay(day) {
  let out;
  try {
    out = execFileSync("aws", [
      "dynamodb", "query",
      "--table-name", TABLE,
      "--region", REGION,
      "--key-condition-expression", "#d = :d",
      "--expression-attribute-names", JSON.stringify({ "#d": "day" }),
      "--expression-attribute-values", JSON.stringify({ ":d": { S: day } }),
      "--output", "json",
    ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    const msg = String(err.stderr || err.message);
    if (/ResourceNotFoundException/.test(msg)) {
      console.error(`\nTable "${TABLE}" not found in ${REGION}. Has the stack been deployed?\n`);
      process.exit(1);
    }
    if (/Unable to locate credentials|could not be found/i.test(msg)) {
      console.error("\nAWS credentials are not configured. Run `aws configure`.\n");
      process.exit(1);
    }
    throw err;
  }
  const parsed = JSON.parse(out);
  return (parsed.Items || []).map((it) => {
    const o = {};
    for (const [k, v] of Object.entries(it)) o[k] = unmarshall(v);
    return o;
  });
}

function dayList() {
  if (ONE_DAY) return [ONE_DAY];
  const days = [];
  const today = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/* ---- formatting -------------------------------------------------------- */
const B = "█", L = "░";
const bar = (n, max, width = 34) =>
  max <= 0 ? "" : B.repeat(Math.max(n > 0 ? 1 : 0, Math.round((n / max) * width)));

function dur(ms) {
  if (!ms) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "0%");
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const lpad = (s, n) => String(s).padStart(n);

function head(title) {
  console.log("\n" + "─".repeat(72));
  console.log("  " + title.toUpperCase());
  console.log("─".repeat(72));
}

function tally(map, key, by = 1) {
  if (key === undefined || key === null || key === "") return;
  map.set(key, (map.get(key) || 0) + by);
}
const sorted = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ---- gather ------------------------------------------------------------ */
const days = dayList();
process.stderr.write(`Reading ${days.length} day(s) from ${TABLE}…\n`);

const perDay = new Map();
const views = [];
const engs = [];

for (const day of days) {
  const rows = queryDay(day);
  const v = rows.filter((r) => r.type === "view");
  const e = rows.filter((r) => r.type === "eng");
  perDay.set(day, { views: v, engs: e });
  views.push(...v);
  engs.push(...e);
}

if (!views.length && !engs.length) {
  console.log(`
No visits recorded yet for the last ${days.length} day(s).

If the tracker was only just deployed this is expected. Load
https://sahibachopra.com in a browser, wait a few seconds, close the tab,
then run this again. Data appears within a second or two of the visit.
`);
  process.exit(0);
}

const sessions = new Set(views.map((v) => v.sid));

/* ---- 1. the headline --------------------------------------------------- */
head(`sahibachopra.com — ${days[0]} to ${days[days.length - 1]}`);
const activeDays = [...perDay.values()].filter((d) => d.views.length).length;
const busiest = sorted(new Map([...perDay].map(([d, x]) => [d, x.views.length])))[0];
console.log(`  Visits (page loads)      ${views.length}`);
console.log(`  Unique sessions          ${sessions.size}`);
console.log(`  Days with any traffic    ${activeDays} of ${days.length}`);
console.log(`  Busiest day              ${busiest ? `${busiest[0]} (${busiest[1]} visits)` : "n/a"}`);
const returners = views.filter((v) => v.returning).length;
console.log(`  Returning visitors       ${returners} (${pct(returners, views.length)})`);
if (engs.length) {
  const act = engs.map((e) => e.activeMs || 0).filter(Boolean);
  console.log(`  Median time on page      ${dur(median(act))}   (active reading time)`);
  console.log(`  Median scroll depth      ${Math.round(median(engs.map((e) => e.scroll || 0)))}%`);
}

/* ---- 2. visits per day -------------------------------------------------- */
head("visits per day");
const maxDay = Math.max(...[...perDay.values()].map((d) => d.views.length), 1);
for (const [day, d] of perDay) {
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(day + "T12:00:00Z").getUTCDay()];
  console.log(`  ${day} ${wd}  ${lpad(d.views.length, 4)}  ${bar(d.views.length, maxDay)}`);
}

/* ---- 3. time of day ----------------------------------------------------- */
head("what time people visit (the visitor's own local time)");
const hours = new Array(24).fill(0);
views.forEach((v) => { if (typeof v.localHour === "number") hours[v.localHour]++; });
const maxHour = Math.max(...hours, 1);
for (let h = 0; h < 24; h++) {
  if (!hours[h] && h % 3 !== 0) continue;
  console.log(`  ${String(h).padStart(2, "0")}:00  ${lpad(hours[h], 4)}  ${bar(hours[h], maxHour, 30) || L}`);
}
const dows = new Array(7).fill(0);
views.forEach((v) => { if (typeof v.dow === "number") dows[v.dow]++; });
const maxDow = Math.max(...dows, 1);
console.log("\n  By day of week");
["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].forEach((n, i) => {
  console.log(`  ${pad(n, 10)} ${lpad(dows[i], 4)}  ${bar(dows[i], maxDow, 26) || L}`);
});

/* ---- 4. where from ------------------------------------------------------ */
head("where people are");
const cities = new Map(), countries = new Map();
views.forEach((v) => {
  tally(countries, v.countryName || v.country);
  if (v.city) tally(cities, `${v.city}${v.region ? ", " + v.region : ""}${v.country ? " (" + v.country + ")" : ""}`);
});
if (!countries.size) {
  console.log("  No location data yet.");
} else {
  console.log("  Countries");
  const maxC = sorted(countries)[0][1];
  sorted(countries).slice(0, 12).forEach(([k, n]) =>
    console.log(`  ${pad(k, 26)} ${lpad(n, 4)}  ${bar(n, maxC, 22)}`));
  if (cities.size) {
    console.log("\n  Cities");
    sorted(cities).slice(0, 20).forEach(([k, n]) =>
      console.log(`  ${pad(k, 40)} ${lpad(n, 4)}`));
  }
}

/* ---- 5. THE question: attention by section ------------------------------ */
head("which part of the site holds attention");
const secTotal = new Map(), secSessions = new Map(), secPer = new Map();
engs.forEach((e) => {
  for (const [name, ms] of Object.entries(e.sections || {})) {
    tally(secTotal, name, ms);
    tally(secSessions, name, 1);
    if (!secPer.has(name)) secPer.set(name, []);
    secPer.get(name).push(ms);
  }
});
if (!secTotal.size) {
  console.log("  No engagement rows yet. These arrive when a visitor leaves the page.");
} else {
  const grand = [...secTotal.values()].reduce((a, b) => a + b, 0);
  const maxSec = sorted(secTotal)[0][1];
  console.log(`  ${pad("Section", 14)}${lpad("Share", 7)}  ${lpad("Median", 9)}  ${lpad("Sessions", 9)}`);
  console.log("  " + "─".repeat(66));
  sorted(secTotal).forEach(([name, ms]) => {
    console.log(
      `  ${pad(name, 14)}${lpad(pct(ms, grand), 7)}  ${lpad(dur(median(secPer.get(name))), 9)}  ` +
      `${lpad(secSessions.get(name), 9)}   ${bar(ms, maxSec, 20)}`
    );
  });
  console.log(`\n  "Share" is share of all measured attention. "Median" is the typical`);
  console.log(`  visitor's time in that section, counted only while they were active.`);
}

/* ---- 6. which papers ---------------------------------------------------- */
const papTotal = new Map(), papOpens = new Map();
engs.forEach((e) => {
  for (const [title, ms] of Object.entries(e.papers || {})) {
    tally(papTotal, title, ms);
    tally(papOpens, title, 1);
  }
});
if (papTotal.size) {
  head("which papers get opened");
  const maxP = sorted(papTotal)[0][1];
  sorted(papTotal).forEach(([title, ms]) => {
    console.log(`  ${pad(title, 62)}`);
    console.log(`    opened by ${papOpens.get(title)} · total ${dur(ms)}  ${bar(ms, maxP, 18)}`);
  });
}

/* ---- 6b. what people click ---------------------------------------------- */
const actTotal = new Map(), actSessions = new Map();
let partyMsTotal = 0, partySessions = 0;
engs.forEach((e) => {
  for (const [name, n] of Object.entries(e.actions || {})) {
    tally(actTotal, name, n);
    tally(actSessions, name, 1);
  }
  if (e.partyMs) { partyMsTotal += e.partyMs; partySessions++; }
});
if (actTotal.size) {
  head("what people click");
  const maxA = sorted(actTotal)[0][1];
  console.log(`  ${pad("Interaction", 30)}${lpad("Visitors", 9)}${lpad("Times", 7)}`);
  console.log("  " + "─".repeat(66));
  sorted(actTotal).forEach(([name, n]) => {
    console.log(`  ${pad(name, 30)}${lpad(actSessions.get(name), 9)}${lpad(n, 7)}   ${bar(n, maxA, 18)}`);
  });
  const partyVisitors = actSessions.get("party mode") || 0;
  if (partyVisitors) {
    console.log(`\n  Party mode: turned on by ${partyVisitors} of ${engs.length} measured visits ` +
                `(${pct(partyVisitors, engs.length)}), left running ${dur(partyMsTotal)} in total.`);
    console.log("  Who they are is not recorded, but the visits that used it were:");
    engs.filter((e) => (e.actions || {})["party mode"]).slice(0, 12).forEach((e) => {
      const where = e.city ? `${e.city}${e.region ? ", " + e.region : ""}` : (e.country || "unknown");
      console.log(`    ${e.ts ? e.ts.slice(0, 16).replace("T", " ") : "?"} UTC  ${pad(where, 28)} ${e.device || ""}  ${dur(e.partyMs || 0)} on`);
    });
  }
}

/* ---- 7. how they got here ----------------------------------------------- */
head("how they got here");
const refs = new Map();
views.forEach((v) => {
  if (!v.ref) { tally(refs, "direct / bookmark / email"); return; }
  try {
    const h = new URL(v.ref).hostname.replace(/^www\./, "");
    tally(refs, h.includes("sahibachopra.com") ? "(internal)" : h);
  } catch { tally(refs, "other"); }
});
const maxR = sorted(refs)[0] ? sorted(refs)[0][1] : 1;
sorted(refs).slice(0, 15).forEach(([k, n]) =>
  console.log(`  ${pad(k, 34)} ${lpad(n, 4)}  ${bar(n, maxR, 22)}`));

/* ---- 8. devices ---------------------------------------------------------- */
head("devices and browsers");
const devs = new Map(), brows = new Map(), oses = new Map();
views.forEach((v) => { tally(devs, v.device); tally(brows, v.browser); tally(oses, v.os); });
const line = (label, map) =>
  console.log(`  ${pad(label, 10)} ` + sorted(map).map(([k, n]) => `${k} ${n}`).join("  ·  "));
line("Device", devs); line("Browser", brows); line("OS", oses);

console.log("");

/* ---- optional visual report ---------------------------------------------- */
if (has("html")) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const rows = (map, n = 12) => sorted(map).slice(0, n);
  const grand = [...secTotal.values()].reduce((a, b) => a + b, 0) || 1;
  const barRow = (label, shown, n, max, extra = "") => `
    <tr><th>${esc(label)}</th><td class="n">${esc(shown)}${esc(extra)}</td>
    <td class="b"><i style="width:${max ? Math.max(0, (n / max) * 100) : 0}%"></i></td></tr>`;

  const maxCity = sorted(cities)[0] ? sorted(cities)[0][1] : 1;
  const maxCountry = sorted(countries)[0] ? sorted(countries)[0][1] : 1;
  const maxOpens = sorted(papOpens)[0] ? sorted(papOpens)[0][1] : 1;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sahibachopra.com — visitors</title>
<style>
  :root{--ink:#000;--bg:#fff;--accent:#d8202a}
  *{box-sizing:border-box}
  body{padding:44px 28px 80px;background:var(--bg);color:var(--ink);
       font:14px/1.5 "Helvetica Neue",Helvetica,Arial,sans-serif;max-width:940px;margin:0 auto}
  h1{font-size:34px;font-weight:700;letter-spacing:-.035em;text-transform:uppercase;margin:0}
  .rule{border-top:7px solid #000;margin:14px 0 6px}
  .sub{text-transform:uppercase;letter-spacing:.08em;font-size:11px;margin:6px 0}
  h2{background:#000;color:#fff;font-size:12px;letter-spacing:.1em;text-transform:uppercase;
     padding:7px 10px;margin:42px 0 12px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-weight:400;padding:4px 8px 4px 0;border-bottom:1px solid #ececec;width:36%}
  td{padding:4px 0;border-bottom:1px solid #ececec;vertical-align:middle}
  td.n{width:150px;text-align:right;padding-right:12px;font-variant-numeric:tabular-nums;
       white-space:nowrap;font-size:12px}
  td.b i{display:block;height:11px;background:var(--accent);min-width:1px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;
        background:#000;border:1px solid #000;margin-top:18px}
  .kpi{background:#fff;padding:14px}
  .kpi b{display:block;font-size:26px;letter-spacing:-.03em}
  .kpi span{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#555}
  footer{margin-top:52px;font-size:11px;color:#666;border-top:1px solid #ccc;padding-top:12px}
</style></head><body>
<div class="rule"></div>
<h1>Visitors</h1>
<p class="sub">sahibachopra.com &nbsp;/&nbsp; ${days[0]} to ${days[days.length - 1]}</p>
<div class="rule"></div>

<div class="kpis">
  <div class="kpi"><b>${views.length}</b><span>Visits</span></div>
  <div class="kpi"><b>${sessions.size}</b><span>Sessions</span></div>
  <div class="kpi"><b>${dur(median(engs.map((e) => e.activeMs || 0).filter(Boolean)))}</b><span>Median time</span></div>
  <div class="kpi"><b>${Math.round(median(engs.map((e) => e.scroll || 0)))}%</b><span>Median scroll</span></div>
  <div class="kpi"><b>${pct(returners, views.length)}</b><span>Returning</span></div>
</div>

<h2>Attention by section</h2>
<table>${sorted(secTotal).map(([name, ms]) =>
    barRow(name, pct(ms, grand), ms, sorted(secTotal)[0][1], ` · ${dur(median(secPer.get(name)))} median`)).join("")}</table>

<h2>Visits per day</h2>
<table>${[...perDay].map(([d, x]) => barRow(d, x.views.length, x.views.length, maxDay)).join("")}</table>

<h2>Time of day (visitor local)</h2>
<table>${hours.map((n, h) => barRow(`${String(h).padStart(2, "0")}:00`, n, n, maxHour)).join("")}</table>

<h2>Cities</h2>
<table>${rows(cities, 15).map(([k, n]) => barRow(k, n, n, maxCity)).join("")}</table>

<h2>Countries</h2>
<table>${rows(countries).map(([k, n]) => barRow(k, n, n, maxCountry)).join("")}</table>

${papTotal.size ? `<h2>Papers opened</h2><table>${sorted(papTotal).map(([t, ms]) =>
    barRow(t, papOpens.get(t), papOpens.get(t), maxOpens, ` · ${dur(ms)}`)).join("")}</table>` : ""}

<h2>Referrers</h2>
<table>${rows(refs, 12).map(([k, n]) => barRow(k, n, n, maxR)).join("")}</table>

<footer>
  Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by analytics/report.mjs.
  No IP addresses, no cookies, no third-party trackers. Location is resolved at the CloudFront
  edge and only city/region/country is stored. Rows self-delete after three years.
</footer>
</body></html>`;

  const out = "/Users/sahibachopra/sahibachopra-site/analytics/report.html";
  writeFileSync(out, html);
  console.log(`Visual report written to ${out}`);
  try { execFileSync("open", [out]); } catch (e) {}
}
