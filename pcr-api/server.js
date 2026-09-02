// pcr-api — tiny zero-dependency HTTP service for live PCN/PCR runway overrides
// and the admin-managed airfield database overlay.
// Read side is open (matches the app's no-login design); every write path
// requires PCR_UPDATE_PASSCODE so random visitors can't inject data that
// feeds real weight/dispatch decisions.
const http = require("http");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.PCR_DATA_DIR || "/home/Wilson/pcr-data";
const AIRFIELDS_JS = process.env.PCR_AIRFIELDS_JS || "/var/www/html/pcr/airfields.js";
const PASSCODE = process.env.PCR_UPDATE_PASSCODE || "changeme";
const PORT = process.env.PORT || 3007;

const OVERRIDES_FILE = path.join(DATA_DIR, "overrides.json");
const SUBMIT_LOG_FILE = path.join(DATA_DIR, "submission-log.json");
const SYNC_STATUS_FILE = path.join(DATA_DIR, "sync-status.json");
// Live overlay on top of the baked-in airfields.js database: admin-added and
// admin-edited airfields, plus a tombstone list of deleted ones. Lets the
// admin add/edit/delete airfields & runways without a code redeploy — same
// pattern as overrides.json does for PCN/PCR values.
const AIRFIELDS_OVERLAY_FILE = path.join(DATA_DIR, "airfields-overlay.json");
// Staged (not-yet-live) add/edit/delete actions, one per ICAO. Admin reviews
// the full pending list, then Publishes (applies everything + bumps
// lastPublished once) or Cancels (discards).
const PENDING_FILE = path.join(DATA_DIR, "pending-airfield-changes.json");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(OVERRIDES_FILE)) fs.writeFileSync(OVERRIDES_FILE, "{}");
if (!fs.existsSync(SUBMIT_LOG_FILE)) fs.writeFileSync(SUBMIT_LOG_FILE, JSON.stringify({ wef: null, entries: [] }));
if (!fs.existsSync(SYNC_STATUS_FILE)) fs.writeFileSync(SYNC_STATUS_FILE, JSON.stringify({ lastPublished: null }));
if (!fs.existsSync(AIRFIELDS_OVERLAY_FILE)) fs.writeFileSync(AIRFIELDS_OVERLAY_FILE, JSON.stringify({ edits: {}, deleted: [] }));
if (!fs.existsSync(PENDING_FILE)) fs.writeFileSync(PENDING_FILE, JSON.stringify({ actions: {} }));

function loadAirfields() {
  const src = fs.readFileSync(AIRFIELDS_JS, "utf8");
  const marker = "const AIRFIELDS = ";
  const start = src.indexOf(marker) + marker.length;
  const rest = src.slice(start);
  const end = rest.lastIndexOf("]") + 1;
  return JSON.parse(rest.slice(0, end));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
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

// A "current effective" airfield record — the overlay's edit if present,
// null if tombstoned as deleted, otherwise the baked-in record converted to
// the overlay's plain-object shape. Used by every pending/publish endpoint
// so they all agree on "what does this airfield look like right now".
function effectiveRecord(icao, byIcao, overlay) {
  if (overlay.edits[icao]) return overlay.edits[icao];
  if (overlay.deleted.includes(icao)) return null;
  const af = byIcao[icao];
  if (!af) return null;
  return {
    icao: af[0], iata: af[1], name: af[2], system: af[3],
    runways: af[4].map(r => ({ rwy: r[0] })),
  };
}

function validateAirfieldRecord(data) {
  const icao = String((data && data.icao) || "").trim().toUpperCase();
  const iata = String((data && data.iata) || "").trim().toUpperCase();
  const name = String((data && data.name) || "").trim();
  const system = String((data && data.system) || "").trim().toUpperCase();
  const runwaysIn = Array.isArray(data && data.runways) ? data.runways : [];

  if (!/^[A-Z0-9]{3,4}$/.test(icao)) return { error: "ICAO is required (3-4 letters/digits)" };
  if (!iata) return { error: "IATA is required" };
  if (!name) return { error: "Name is required" };
  if (system !== "PCR" && system !== "PCN") return { error: "System must be PCR or PCN" };
  if (!runwaysIn.length) return { error: "At least one runway is required" };

  const runways = [];
  const seen = new Set();
  for (const r of runwaysIn) {
    const rwy = String((r && r.rwy) || "").trim().toUpperCase();
    if (!rwy) return { error: "Every runway needs a designator" };
    if (seen.has(rwy)) return { error: "Duplicate runway designator: " + rwy };
    seen.add(rwy);
    runways.push({ rwy });
  }

  return { record: { icao, iata, name, system, runways } };
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, "http://x");
  let pathname = url.pathname;
  // Handle both e.g. /overrides and /pcr-api/overrides (strip /pcr-api prefix if present)
  if (pathname.startsWith("/pcr-api/")) {
    pathname = pathname.slice(8); // Remove "/pcr-api" (8 chars), keep the "/"
  }

  if (req.method === "GET" && pathname === "/overrides") {
    const allOverrides = readJson(OVERRIDES_FILE);
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

    const syncStatus = readJson(SYNC_STATUS_FILE);
    const overlay = readJson(AIRFIELDS_OVERLAY_FILE);
    return json(res, 200, {
      overrides: result, currentWef, nextWef, lastPublished: syncStatus.lastPublished,
      airfieldEdits: overlay.edits, airfieldDeleted: overlay.deleted,
    });
  }

  if (req.method === "GET" && pathname === "/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && pathname === "/log") {
    return json(res, 200, readJson(SUBMIT_LOG_FILE));
  }

  if (req.method === "GET" && pathname === "/airfields-pending") {
    const pending = readJson(PENDING_FILE);
    const overrides = readJson(OVERRIDES_FILE);
    function countOverridesForIcao(icao) {
      let n = 0;
      for (const k in overrides) if (overrides[k].icao === icao) n++;
      return n;
    }
    const actions = Object.values(pending.actions).map(a => ({ ...a, affectedOverrides: countOverridesForIcao(a.icao) }));
    actions.sort((a, b) => a.queuedAt < b.queuedAt ? -1 : 1);
    return json(res, 200, { actions });
  }

  if (req.method === "POST" && pathname === "/airfields-pending/queue") {
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
      const overlay = readJson(AIRFIELDS_OVERLAY_FILE);
      const pending = readJson(PENDING_FILE);

      const action = data.action;

      if (action === "add") {
        const v = validateAirfieldRecord(data.data || {});
        if (v.error) return json(res, 400, { error: v.error });
        if (effectiveRecord(v.record.icao, byIcao, overlay)) {
          return json(res, 400, { error: "ICAO " + v.record.icao + " already exists — use Edit instead" });
        }
        pending.actions[v.record.icao] = { type: "add", icao: v.record.icao, data: v.record, queuedAt: new Date().toISOString() };
      } else if (action === "edit") {
        const originalIcao = String(data.icao || "").trim().toUpperCase();
        if (!originalIcao) return json(res, 400, { error: "original ICAO is required for edit" });
        if (!effectiveRecord(originalIcao, byIcao, overlay)) return json(res, 400, { error: "ICAO " + originalIcao + " not found" });
        const v = validateAirfieldRecord(data.data || {});
        if (v.error) return json(res, 400, { error: v.error });
        if (v.record.icao !== originalIcao && effectiveRecord(v.record.icao, byIcao, overlay)) {
          return json(res, 400, { error: "ICAO " + v.record.icao + " already exists" });
        }
        pending.actions[originalIcao] = { type: "edit", icao: originalIcao, data: v.record, queuedAt: new Date().toISOString() };
      } else if (action === "delete") {
        const icao = String(data.icao || "").trim().toUpperCase();
        if (!icao) return json(res, 400, { error: "icao is required" });
        if (!effectiveRecord(icao, byIcao, overlay)) return json(res, 400, { error: "ICAO " + icao + " not found" });
        pending.actions[icao] = { type: "delete", icao, data: null, queuedAt: new Date().toISOString() };
      } else {
        return json(res, 400, { error: "invalid action — must be add, edit, or delete" });
      }

      writeJson(PENDING_FILE, pending);
      return json(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === "POST" && pathname === "/airfields-pending/remove") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 200000) req.destroy(); });
    req.on("end", () => {
      let data;
      try { data = JSON.parse(body); } catch { return json(res, 400, { error: "invalid JSON" }); }
      if (data.passcode !== PASSCODE) return json(res, 401, { error: "wrong passcode" });
      const icao = String(data.icao || "").trim().toUpperCase();
      const pending = readJson(PENDING_FILE);
      delete pending.actions[icao];
      writeJson(PENDING_FILE, pending);
      return json(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === "POST" && pathname === "/airfields-pending/cancel") {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 200000) req.destroy(); });
    req.on("end", () => {
      let data;
      try { data = JSON.parse(body); } catch { return json(res, 400, { error: "invalid JSON" }); }
      if (data.passcode !== PASSCODE) return json(res, 401, { error: "wrong passcode" });
      writeJson(PENDING_FILE, { actions: {} });
      return json(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === "POST" && pathname === "/airfields-pending/publish") {
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

      const overlay = readJson(AIRFIELDS_OVERLAY_FILE);
      const overrides = readJson(OVERRIDES_FILE);
      const pending = readJson(PENDING_FILE);
      const today = new Date().toISOString().split("T")[0];

      const actions = Object.values(pending.actions);
      if (!actions.length) return json(res, 400, { error: "nothing pending to publish" });

      const added = [], edited = [], deleted = [];
      const newRunwaysByIcao = {}; // for the LIDO-extraction reminder

      for (const act of actions) {
        if (act.type === "add") {
          overlay.edits[act.data.icao] = act.data;
          const di = overlay.deleted.indexOf(act.data.icao);
          if (di !== -1) overlay.deleted.splice(di, 1);
          added.push(act.data.icao);
          newRunwaysByIcao[act.data.icao] = act.data.runways.map(r => r.rwy);
        } else if (act.type === "edit") {
          const before = effectiveRecord(act.icao, byIcao, overlay);
          const newIcao = act.data.icao;
          if (newIcao !== act.icao) {
            // Renaming ICAO: drop the old overlay edit, tombstone the old
            // code if it was a baked-in airfield, and rekey any live
            // overrides so PCN history follows the airfield to its new code.
            delete overlay.edits[act.icao];
            if (byIcao[act.icao] && !overlay.deleted.includes(act.icao)) overlay.deleted.push(act.icao);
            for (const k in overrides) {
              if (overrides[k].icao === act.icao) {
                const ov = overrides[k];
                overrides[newIcao + "|" + ov.rwy + "|" + ov.wef] = { ...ov, icao: newIcao };
                delete overrides[k];
              }
            }
            const di = overlay.deleted.indexOf(newIcao);
            if (di !== -1) overlay.deleted.splice(di, 1);
          }
          overlay.edits[newIcao] = act.data;
          edited.push(newIcao);
          const beforeRwys = new Set((before && before.runways || []).map(r => r.rwy));
          const newlyAdded = act.data.runways.map(r => r.rwy).filter(rwy => !beforeRwys.has(rwy));
          if (newlyAdded.length) newRunwaysByIcao[newIcao] = newlyAdded;
        } else if (act.type === "delete") {
          delete overlay.edits[act.icao];
          if (!overlay.deleted.includes(act.icao)) overlay.deleted.push(act.icao);
          deleted.push(act.icao);
        }
      }

      writeJson(AIRFIELDS_OVERLAY_FILE, overlay);
      writeJson(OVERRIDES_FILE, overrides);
      writeJson(PENDING_FILE, { actions: {} });
      writeJson(SYNC_STATUS_FILE, { lastPublished: today });

      return json(res, 200, {
        added, edited, deleted, newRunwaysByIcao, lastPublished: today,
        reminder: "Remember to announce the new sync date on FlightBox, and add any new airfields/runways to the LIDO extraction script for the next data extraction.",
      });
    });
    return;
  }

  if (req.method === "POST" && pathname === "/update") {
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
      const overlay = readJson(AIRFIELDS_OVERLAY_FILE);

      // Known runways per ICAO, merging baked-in data with the live overlay
      // (admin-added/edited airfields, minus deleted ones). Returns null if
      // the airfield doesn't exist at all.
      function knownRunwaysFor(icao) {
        const rec = effectiveRecord(icao, byIcao, overlay);
        if (!rec) return null;
        return new Set(rec.runways.map(r => r.rwy));
      }

      const overrides = readJson(OVERRIDES_FILE);
      const today = new Date().toISOString().split("T")[0];
      const rejected = [];
      const skippedIcaos = new Set();
      const appliedIcaos = new Set();

      // Helper to get current active PCN for a specific icao|rwy
      function getCurrentActivePcn(icao, rwy) {
        let active = null;
        let activeWef = null;
        for (const key in overrides) {
          const override = overrides[key];
          if (override.icao === icao && override.rwy === rwy) {
            // Normalize WEF for comparison
            let normalizedWef = override.wef;
            if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedWef) === false) {
              // Convert user-friendly format to ISO
              const m = normalizedWef.match(/^(\d{1,2})([A-Za-z]{3})(\d{2})$/);
              if (m) {
                const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
                const day = String(m[1]).padStart(2, "0");
                const month = String(months[m[2].toLowerCase()]).padStart(2, "0");
                normalizedWef = "20" + m[3] + "-" + month + "-" + day;
              }
            }
            // Select highest WEF <= today
            if (normalizedWef <= today) {
              if (!activeWef || normalizedWef > activeWef) {
                active = override.pcn;
                activeWef = normalizedWef;
              }
            }
          }
        }
        return active;
      }

      function processRunwayUpdate(icao, rwyInput, pcn, wef, knownRwys) {
        // Handle paired runway format: "14L/32R" → apply to both "14L" and "32R"
        const rwyParts = rwyInput.split('/').map(s => s.trim());
        let wasApplied = false;
        let hadSkip = false;

        rwyParts.forEach(rwy => {
          if (!knownRwys.has(rwy)) {
            rejected.push({ icao, rwy, pcn, reason: "unknown runway — add it via Manage Airfields first" });
            return;
          }
          // Check if new PCN equals current active PCN — if so, skip
          const currentPcn = getCurrentActivePcn(icao, rwy);
          if (currentPcn === pcn) { hadSkip = true; return; } // Skip — no change from current

          // Versioned storage: icao|rwy|wef
          const key = icao + "|" + rwy + "|" + wef;
          overrides[key] = { icao, rwy, pcn, wef };
          wasApplied = true;
        });

        if (wasApplied) appliedIcaos.add(icao);
        else if (hadSkip) skippedIcaos.add(icao);
      }

      const wef = String(data.wef || "").trim();

      (Array.isArray(data.updates) ? data.updates : []).forEach(u => {
        const icao = String(u.icao || "").trim().toUpperCase();
        const rwy = String(u.rwy || "").trim();
        const pcn = String(u.pcn || "").trim();
        const knownRwys = knownRunwaysFor(icao);
        if (!knownRwys) return rejected.push({ icao, rwy, pcn, reason: "unknown ICAO" });
        if (!PCN_RE.test(pcn)) return rejected.push({ icao, rwy, pcn, reason: "PCN format looks wrong (expect e.g. 82/F/C/W/T)" });

        processRunwayUpdate(icao, rwy, pcn, wef, knownRwys);
      });

      writeJson(OVERRIDES_FILE, overrides);

      // Categorize ICAO codes by cycle
      const currentCycle = [];
      const nextCycle = [];

      for (const icao of appliedIcaos) {
        if (wef <= today) {
          currentCycle.push(icao);
        } else {
          nextCycle.push(icao);
        }
      }

      const skipped = Array.from(skippedIcaos).sort();

      // Persist to the shared submission log — reset when the WEF cycle changes
      let log = readJson(SUBMIT_LOG_FILE);
      if (log.wef !== wef) log = { wef, entries: [] };
      log.entries.push({ time: new Date().toISOString(), currentCycle, nextCycle, skipped, rejected });
      writeJson(SUBMIT_LOG_FILE, log);

      // "Last published" tracks when the admin most recently pushed a REAL
      // change (not a no-op/dedup skip or a fully-rejected batch), regardless
      // of that batch's WEF. This is deliberately independent of currentWef —
      // it's a "you're looking at my latest publish" freshness marker for
      // crew to cross-check against a FlightBox announcement, not a WEF label.
      if (appliedIcaos.size > 0) {
        writeJson(SYNC_STATUS_FILE, { lastPublished: today });
      }

      return json(res, 200, { wef, currentCycle, nextCycle, skipped, rejected });
    });
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => console.log("pcr-api listening on 127.0.0.1:" + PORT));
