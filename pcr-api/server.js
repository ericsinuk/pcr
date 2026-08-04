// pcr-api — tiny zero-dependency HTTP service for live PCN/PCR runway overrides.
// Read side is open (matches the app's no-login design); the write side
// (/update) requires PCR_UPDATE_PASSCODE so random visitors can't inject
// pavement data that feeds real weight/dispatch decisions.
const http = require("http");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.PCR_DATA_DIR || "/home/Wilson/pcr-data";
const AIRFIELDS_JS = process.env.PCR_AIRFIELDS_JS || "/var/www/html/pcr/airfields.js";
const PASSCODE = process.env.PCR_UPDATE_PASSCODE || "changeme";
const PORT = process.env.PORT || 3006;

const OVERRIDES_FILE = path.join(DATA_DIR, "overrides.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(OVERRIDES_FILE)) fs.writeFileSync(OVERRIDES_FILE, "{}");

function loadAirfields() {
  const src = fs.readFileSync(AIRFIELDS_JS, "utf8");
  const marker = "const AIRFIELDS = ";
  const start = src.indexOf(marker) + marker.length;
  const rest = src.slice(start);
  const end = rest.lastIndexOf("]") + 1;
  return JSON.parse(rest.slice(0, end));
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const PCN_RE = /^\d+(\.\d+)?\/[RF]\/[A-D]\/[A-Z]+\/[A-Z]$/;

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, "http://x");

  if (req.method === "GET" && url.pathname === "/overrides") {
    const allOverrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8"));
    const today = new Date().toISOString().split("T")[0];

    // Convert user-friendly date format (DDMmmYY) to ISO format (YYYY-MM-DD)
    function normalizeWef(wef) {
      if (!wef) return null;
      // Already in ISO format
      if (/^\d{4}-\d{2}-\d{2}$/.test(wef)) return wef;
      // User format: DDMmmYY (e.g., 03Aug26)
      const m = wef.match(/^(\d{1,2})([A-Za-z]{3})(\d{2})$/);
      if (m) {
        const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
        const day = m[1].padStart(2, "0");
        const month = String(months[m[2].toLowerCase()]).padStart(2, "0");
        const year = "20" + m[3];
        return year + "-" + month + "-" + day;
      }
      return wef; // Return as-is if unrecognized
    }

    // Group by icao|rwy, select highest WEF that's <= today, and find next scheduled
    const activeOverrides = {};
    const wefDates = new Set();

    for (const key in allOverrides) {
      const override = allOverrides[key];
      const normalizedWef = normalizeWef(override.wef);
      wefDates.add(normalizedWef);
      const runwayKey = override.icao + "|" + override.rwy;

      if (!activeOverrides[runwayKey]) {
        activeOverrides[runwayKey] = null;
      }

      // Select active version: highest WEF date <= today
      if (normalizedWef <= today) {
        if (!activeOverrides[runwayKey] || normalizedWef > activeOverrides[runwayKey]._wef) {
          activeOverrides[runwayKey] = override;
          activeOverrides[runwayKey]._wef = normalizedWef; // Store normalized WEF for comparison
        }
      }
    }

    // Find current WEF (highest WEF date <= today) and next scheduled WEF
    let currentWef = null;
    let nextWef = null;
    for (const wef of wefDates) {
      if (wef <= today && (!currentWef || wef > currentWef)) {
        currentWef = wef;
      }
      if (wef > today && (!nextWef || wef < nextWef)) {
        nextWef = wef;
      }
    }

    // Clean up nulls and flatten to the expected format
    const result = {};
    for (const key in activeOverrides) {
      if (activeOverrides[key]) {
        const override = activeOverrides[key];
        const cleaned = { icao: override.icao, rwy: override.rwy, pcn: override.pcn, wef: override.wef };
        result[override.icao + "|" + override.rwy] = cleaned;
      }
    }

    return json(res, 200, { overrides: result, currentWef, nextWef });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/update") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 200000) req.destroy(); });
    req.on("end", () => {
      let data;
      try { data = JSON.parse(body); } catch { return json(res, 400, { error: "invalid JSON" }); }
      if (data.passcode !== PASSCODE) return json(res, 401, { error: "wrong passcode" });

      let airfields;
      try { airfields = loadAirfields(); } catch (e) { return json(res, 500, { error: "could not load airfields data: " + e.message }); }
      const byIcao = {};
      airfields.forEach(a => { byIcao[a[0]] = a; });

      const overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8"));
      const applied = [], rejected = [];

      function processRunwayUpdate(icao, rwyInput, pcn, wef, af, applied, rejected) {
        // Handle paired runway format: "14L/32R" → apply to both "14L" and "32R"
        const rwyParts = rwyInput.split('/').map(s => s.trim());
        let runwaysToUpdate = rwyParts;

        // If input is paired (e.g., 14L/32R), apply to both directions
        // If input is single (e.g., 14L), apply to that one
        runwaysToUpdate.forEach(rwy => {
          let rwyExists = af[6].some(r => r[0] === rwy);
          // Auto-create missing runway with placeholder length/width (not used in calculations)
          if (!rwyExists) {
            af[6].push([rwy, 0, 0, null]);
            rwyExists = true;
          }
          // Versioned storage: icao|rwy|wef
          const key = icao + "|" + rwy + "|" + wef;
          overrides[key] = { icao, rwy, pcn, wef };
          applied.push({ icao, rwy, pcn });
        });
      }

      const wef = String(data.wef || "").trim();

      (Array.isArray(data.updates) ? data.updates : []).forEach(u => {
        const icao = String(u.icao || "").trim().toUpperCase();
        const rwy = String(u.rwy || "").trim();
        const pcn = String(u.pcn || "").trim();
        const af = byIcao[icao];
        if (!af) return rejected.push({ icao, rwy, pcn, reason: "unknown ICAO" });
        if (!PCN_RE.test(pcn)) return rejected.push({ icao, rwy, pcn, reason: "PCN format looks wrong (expect e.g. 82/F/C/W/T)" });

        processRunwayUpdate(icao, rwy, pcn, wef, af, applied, rejected);
      });

      fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
      return json(res, 200, { applied, rejected, wef });
    });
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log("pcr-api listening on 127.0.0.1:" + PORT));
