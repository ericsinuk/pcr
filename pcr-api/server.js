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
    return json(res, 200, JSON.parse(fs.readFileSync(OVERRIDES_FILE, "utf8")));
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

      function processRunwayUpdate(icao, rwyInput, pcn, af, applied, rejected) {
        // Handle paired runway format: "14L/32R" → apply to both "14L" and "32R"
        const rwyParts = rwyInput.split('/').map(s => s.trim());
        let runwaysToUpdate = rwyParts;

        // If input is paired (e.g., 14L/32R), apply to both directions
        // If input is single (e.g., 14L), apply to that one
        runwaysToUpdate.forEach(rwy => {
          const rwyExists = af[6].some(r => r[0] === rwy);
          if (!rwyExists) return rejected.push({ icao, rwy: rwyInput, pcn, reason: "unknown runway for " + icao });
          overrides[icao + "|" + rwy] = { icao, rwy, pcn, updatedAt: new Date().toISOString() };
          applied.push({ icao, rwy, pcn });
        });
      }

      (Array.isArray(data.updates) ? data.updates : []).forEach(u => {
        const icao = String(u.icao || "").trim().toUpperCase();
        const rwy = String(u.rwy || "").trim();
        const pcn = String(u.pcn || "").trim();
        const af = byIcao[icao];
        if (!af) return rejected.push({ icao, rwy, pcn, reason: "unknown ICAO" });

        processRunwayUpdate(icao, rwy, pcn, af, applied, rejected);
        if (!PCN_RE.test(pcn)) return rejected.push({ icao, rwy, pcn, reason: "PCN format looks wrong (expect e.g. 82/F/C/W/T)" });
      });

      fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(overrides, null, 2));
      return json(res, 200, { applied, rejected });
    });
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log("pcr-api listening on 127.0.0.1:" + PORT));
