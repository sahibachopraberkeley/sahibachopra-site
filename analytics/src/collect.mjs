/* =========================================================================
   collect.mjs — the analytics collector behind sahibachopra.com.

   Receives two kinds of beacon from analytics.js:

     {t:"view", ...}  one per page load
     {t:"eng",  ...}  per-section dwell time, resent as the visit goes on

   Engagement rows are keyed on the session id alone, so a session that
   flushes five times overwrites its own row five times instead of being
   counted five times.

   Deliberately never stored: the visitor's IP address. CloudFront resolves
   location at the edge and only the resulting city/region/country is kept.
   ========================================================================= */
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const ddb = new DynamoDBClient({});
const TABLE = process.env.TABLE_NAME;
const ALLOWED = (process.env.ALLOW_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 1095);

/* Crawlers mostly do not run JavaScript, so little of this arrives in the
   first place. This catches the headless ones that do. */
const BOT = /bot|crawl|spider|slurp|headless|puppeteer|playwright|phantom|curl|wget|python-requests|lighthouse|pingdom|uptime|monitor|preview|scraper|facebookexternalhit|bingpreview|semrush|ahrefs|dataprovider|gpt|claude|anthropic|openai/i;

/* ---- minimal DynamoDB marshaller ------------------------------------- */
/* Written out by hand rather than pulled from lib-dynamodb so the function
   depends on nothing beyond what the Lambda runtime already ships. */
function av(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") return { S: v };
  if (typeof v === "number") return Number.isFinite(v) ? { N: String(Math.round(v)) } : null;
  if (typeof v === "boolean") return { BOOL: v };
  if (Array.isArray(v)) {
    const list = v.map(av).filter(Boolean);
    return list.length ? { L: list } : null;
  }
  if (typeof v === "object") {
    const m = {};
    for (const [k, val] of Object.entries(v)) {
      const a = av(val);
      if (a) m[k] = a;
    }
    return Object.keys(m).length ? { M: m } : null;
  }
  return null;
}
function item(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const a = av(v);
    if (a) out[k] = a;
  }
  return out;
}

/* ---- helpers ---------------------------------------------------------- */
const clampStr = (s, n) => (typeof s === "string" ? s.slice(0, n) : undefined);
const clampNum = (n, max) => {
  const x = Number(n);
  return Number.isFinite(x) && x >= 0 ? Math.min(Math.round(x), max) : undefined;
};

/* Day is derived from when the session STARTED, not from when this
   particular flush arrived, so a visit running across midnight keeps all of
   its rows on the day it began. */
function dayOf(ms) {
  const d = Number.isFinite(ms) ? new Date(ms) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function reply(status, origin) {
  return {
    statusCode: status,
    headers: {
      "access-control-allow-origin": origin && ALLOWED.includes(origin) ? origin : ALLOWED[0] || "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
      "cache-control": "no-store",
    },
    body: "",
  };
}

/* ---- handler ---------------------------------------------------------- */
export const handler = async (event) => {
  const h = event.headers || {};
  const method = event.requestContext?.http?.method || "POST";
  const origin = h.origin || h.Origin;

  if (method === "OPTIONS") return reply(204, origin);
  if (method !== "POST") return reply(405, origin);

  /* Only this site may write. Keeps someone else's page, or a bored script,
     out of the dataset. */
  if (!origin || !ALLOWED.includes(origin)) return reply(403, origin);

  const ua = h["user-agent"] || "";
  if (BOT.test(ua)) return reply(204, origin);

  let body;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || "", "base64").toString("utf8")
      : event.body || "";
    body = JSON.parse(raw);
  } catch {
    return reply(400, origin);
  }
  if (!body || typeof body !== "object") return reply(400, origin);

  const sid = clampStr(body.sid, 40);
  if (!sid) return reply(400, origin);

  const now = new Date();
  const started = Number(body.started);
  const day = dayOf(started);
  const expiresAt = Math.floor(now.getTime() / 1000) + RETENTION_DAYS * 86400;

  /* Location, straight from the edge. */
  const geo = {
    country: clampStr(h["cloudfront-viewer-country"], 8),
    countryName: clampStr(h["cloudfront-viewer-country-name"], 64),
    region: clampStr(h["cloudfront-viewer-country-region-name"], 64),
    city: clampStr(h["cloudfront-viewer-city"], 64),
    edgeTz: clampStr(h["cloudfront-viewer-time-zone"], 64),
  };

  const base = { day, sid, ts: now.toISOString(), expiresAt, ...geo };

  let record;
  if (body.t === "view") {
    record = {
      ...base,
      sk: `view#${now.toISOString()}#${sid}`,
      type: "view",
      path: clampStr(body.path, 200),
      ref: clampStr(body.ref, 300),
      tz: clampStr(body.tz, 64),          // visitor's own timezone
      localHour: clampNum(body.localHour, 23),
      localTime: clampStr(body.localTime, 32),
      dow: clampNum(body.dow, 6),
      device: clampStr(body.device, 16),
      browser: clampStr(body.browser, 32),
      os: clampStr(body.os, 32),
      screen: clampStr(body.screen, 24),
      lang: clampStr(body.lang, 16),
      returning: body.returning === true,
    };
  } else if (body.t === "eng") {
    const sections = {};
    if (body.sections && typeof body.sections === "object") {
      for (const [k, v] of Object.entries(body.sections).slice(0, 30)) {
        const ms = clampNum(v, 6 * 3600 * 1000);
        if (ms) sections[clampStr(k, 40)] = ms;
      }
    }
    const papers = {};
    if (body.papers && typeof body.papers === "object") {
      for (const [k, v] of Object.entries(body.papers).slice(0, 30)) {
        const ms = clampNum(v, 6 * 3600 * 1000);
        if (ms) papers[clampStr(k, 120)] = ms;
      }
    }
    record = {
      ...base,
      sk: `eng#${sid}`,               // one row per session, overwritten
      type: "eng",
      sections,
      papers,
      activeMs: clampNum(body.activeMs, 6 * 3600 * 1000),
      totalMs: clampNum(body.totalMs, 24 * 3600 * 1000),
      scroll: clampNum(body.scroll, 100),
      clicks: clampNum(body.clicks, 10000),
      final: body.final === true,
      device: clampStr(body.device, 16),
      returning: body.returning === true,
    };
  } else {
    return reply(400, origin);
  }

  try {
    await ddb.send(new PutItemCommand({ TableName: TABLE, Item: item(record) }));
  } catch (err) {
    console.error("write failed", err);
    return reply(500, origin);
  }
  return reply(204, origin);
};
