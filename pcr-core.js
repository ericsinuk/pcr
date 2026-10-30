// pcr-core.js — shared, DOM-free logic for the PCN/PCR app.
//
// Used by the Check tab (app.js: work out which override versions are live
// today) and by the admin page (pcr-admin.html: batch updates and the
// add/edit/delete + pending/publish workflow). It is a direct port of the rules
// that used to live in pcr-api/server.js, so the admin can edit the data files in
// the repo without needing a backend server.
//
// Everything here is a pure function over a plain `state` object — no network,
// no DOM — so it can be unit-tested in Node (module.exports) and used in the
// browser (window.PCRCore) from the same file.
//
// state = {
//   overrides: { "ICAO|RWY|WEF": {icao, rwy, pcn, wef}, ... },   data/overrides.json
//   log:       { wef, entries: [...] },                           data/submission-log.json
//   overlay:   { edits: {ICAO: record}, deleted: [ICAO,...] },    data/airfields-overlay.json
//   pending:   { actions: {ICAO: {type, icao, data, queuedAt}} }, data/pending-airfield-changes.json
//   sync:      { lastPublished: "YYYY-MM-DD" | null },            data/sync-status.json
// }
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PCRCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PCN_RE = /^\d+(\.\d+)?\/[RF]\/[A-D]\/[A-Z]+\/[A-Z]$/;
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const REMINDER = "Remember to announce the new sync date on FlightBox, and add any new airfields/runways to the LIDO extraction script for the next data extraction.";

  // state key -> path inside the repo
  const FILES = {
    overrides: "data/overrides.json",
    log: "data/submission-log.json",
    overlay: "data/airfields-overlay.json",
    pending: "data/pending-airfield-changes.json",
    sync: "data/sync-status.json",
  };

  function emptyState() {
    return {
      overrides: {},
      log: { wef: null, entries: [] },
      overlay: { edits: {}, deleted: [] },
      pending: { actions: {} },
      sync: { lastPublished: null },
    };
  }

  // Fill in anything missing/malformed so the rest of the code can rely on the shape.
  function normalizeState(s) {
    const e = emptyState();
    s = s || {};
    const isObj = v => v && typeof v === "object" && !Array.isArray(v);
    return {
      overrides: isObj(s.overrides) ? s.overrides : e.overrides,
      log: isObj(s.log) && Array.isArray(s.log.entries) ? s.log : e.log,
      overlay: {
        edits: isObj(s.overlay) && isObj(s.overlay.edits) ? s.overlay.edits : {},
        deleted: isObj(s.overlay) && Array.isArray(s.overlay.deleted) ? s.overlay.deleted : [],
      },
      pending: { actions: isObj(s.pending) && isObj(s.pending.actions) ? s.pending.actions : {} },
      sync: isObj(s.sync) ? s.sync : e.sync,
    };
  }

  function serialize(obj) { return JSON.stringify(obj, null, 2) + "\n"; }

  function todayUtc(now) { return (now ? new Date(now) : new Date()).toISOString().split("T")[0]; }

  // Convert user-friendly date format (DDMmmYY) to ISO (YYYY-MM-DD); ISO passes through.
  function normalizeWef(wef) {
    if (!wef) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(wef)) return wef;
    const m = String(wef).match(/^(\d{1,2})([A-Za-z]{3})(\d{2})$/);
    if (m) {
      const day = m[1].padStart(2, "0");
      const month = String(MONTHS[m[2].toLowerCase()]).padStart(2, "0");
      return "20" + m[3] + "-" + month + "-" + day;
    }
    return wef; // unrecognised: leave as-is
  }

  // Runway designators are stored in one standard form: two digits 01-36 plus an optional
  // L/R/C (e.g. 09, 27L, 18C). Sloppy input is tidied up ("7" -> "07", "27.0" -> "27",
  // "11c" -> "11C"); anything that still isn't standard is rejected by the callers.
  const RWY_RE = /^(0[1-9]|[12][0-9]|3[0-6])[LRC]?$/;
  function normalizeRunway(s) {
    s = String(s == null ? "" : s).trim().toUpperCase().replace(/^(\d+)\.0+(?=[A-Z]?$)/, "$1");
    const m = s.match(/^(\d{1,2})([LRC]?)$/);
    return m ? m[1].padStart(2, "0") + m[2] : s;
  }
  const RWY_HINT = "use two digits plus an optional L/R/C, e.g. 09, 27L, 18C";

  /* ── Reading: which override versions are live today ── */

  // For each icao|rwy pick the version with the highest WEF <= today; also report
  // the current (latest <= today) and next (earliest > today) WEF across all data.
  function computeLive(allOverrides, today) {
    const active = {};
    const wefDates = new Set();
    for (const key in allOverrides) {
      const o = allOverrides[key];
      const nw = normalizeWef(o.wef);
      wefDates.add(nw);
      const rk = o.icao + "|" + o.rwy;
      if (!active[rk]) active[rk] = null;
      if (nw <= today) {
        if (!active[rk] || nw > active[rk].wef) active[rk] = { o, wef: nw };
      }
    }
    let currentWef = null, nextWef = null;
    for (const wef of wefDates) {
      if (wef <= today && (!currentWef || wef > currentWef)) currentWef = wef;
      if (wef > today && (!nextWef || wef < nextWef)) nextWef = wef;
    }
    const overrides = {};
    for (const key in active) {
      if (active[key]) {
        const o = active[key].o;
        overrides[o.icao + "|" + o.rwy] = { icao: o.icao, rwy: o.rwy, pcn: o.pcn, wef: o.wef };
      }
    }
    return { overrides, currentWef, nextWef };
  }

  /* ── Airfield database (baked-in + admin overlay) ── */

  function indexAirfields(airfields) {
    const byIcao = {};
    airfields.forEach(a => { byIcao[a[0]] = a; });
    return byIcao;
  }

  // The airfield as it is right now: overlay edit if present, null if deleted,
  // otherwise the baked-in record converted to the overlay's plain-object shape.
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

  function overlayRecordToTuple(rec) {
    return [rec.icao, rec.iata, rec.name, rec.system, rec.runways.map(r => [r.rwy, null])];
  }

  // baked-in rows minus deleted/edited ones, plus the overlay's rows.
  function buildEffectiveAirfields(airfields, edits, deleted) {
    edits = edits || {};
    const del = new Set(deleted || []);
    const edited = new Set(Object.keys(edits));
    const base = airfields.filter(a => !del.has(a[0]) && !edited.has(a[0]));
    return base.concat(Object.values(edits).map(overlayRecordToTuple));
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
      const rwy = normalizeRunway(r && r.rwy);
      if (!rwy) return { error: "Every runway needs a designator" };
      if (!RWY_RE.test(rwy)) return { error: "Runway \"" + rwy + "\" isn't a standard designator — " + RWY_HINT };
      if (seen.has(rwy)) return { error: "Duplicate runway designator: " + rwy };
      seen.add(rwy);
      runways.push({ rwy });
    }
    return { record: { icao, iata, name, system, runways } };
  }

  /* ── Writing: PCN batch update ── */

  function getCurrentActivePcn(overrides, icao, rwy, today) {
    let active = null, activeWef = null;
    for (const key in overrides) {
      const o = overrides[key];
      if (o.icao === icao && o.rwy === rwy) {
        const nw = normalizeWef(o.wef);
        if (nw <= today) {
          if (!activeWef || nw > activeWef) { active = o.pcn; activeWef = nw; }
        }
      }
    }
    return active;
  }

  // input = { updates: [{icao, rwy, pcn}], wef }; ctx = { airfields, today, now }
  // Mutates state.overrides / state.log / state.sync; returns the batch summary.
  function applyBatch(state, input, ctx) {
    const byIcao = indexAirfields(ctx.airfields);
    const { overrides, overlay } = state;
    const today = ctx.today;
    const rejected = [];
    const skippedIcaos = new Set();
    const appliedIcaos = new Set();

    function knownRunwaysFor(icao) {
      const rec = effectiveRecord(icao, byIcao, overlay);
      return rec ? new Set(rec.runways.map(r => r.rwy)) : null;
    }

    function processRunwayUpdate(icao, rwyInput, pcn, wef, knownRwys) {
      // Paired runway format: "14L/32R" applies to both "14L" and "32R"
      const rwyParts = rwyInput.split("/").map(normalizeRunway);
      let wasApplied = false, hadSkip = false;
      rwyParts.forEach(rwy => {
        if (!RWY_RE.test(rwy)) {
          rejected.push({ icao, rwy, pcn, reason: "runway designator isn't standard — " + RWY_HINT });
          return;
        }
        if (!knownRwys.has(rwy)) {
          rejected.push({ icao, rwy, pcn, reason: "unknown runway — add it via Manage Airfields first" });
          return;
        }
        if (getCurrentActivePcn(overrides, icao, rwy, today) === pcn) { hadSkip = true; return; } // no change
        overrides[icao + "|" + rwy + "|" + wef] = { icao, rwy, pcn, wef };
        wasApplied = true;
      });
      if (wasApplied) appliedIcaos.add(icao);
      else if (hadSkip) skippedIcaos.add(icao);
    }

    const wef = String(input.wef || "").trim();
    (Array.isArray(input.updates) ? input.updates : []).forEach(u => {
      const icao = String(u.icao || "").trim().toUpperCase();
      const rwy = String(u.rwy || "").trim();
      const pcn = String(u.pcn || "").trim();
      const knownRwys = knownRunwaysFor(icao);
      if (!knownRwys) return rejected.push({ icao, rwy, pcn, reason: "unknown ICAO" });
      if (!PCN_RE.test(pcn)) return rejected.push({ icao, rwy, pcn, reason: "PCN format looks wrong (expect e.g. 82/F/C/W/T)" });
      processRunwayUpdate(icao, rwy, pcn, wef, knownRwys);
    });

    const currentCycle = [], nextCycle = [];
    for (const icao of appliedIcaos) (wef <= today ? currentCycle : nextCycle).push(icao);
    const skipped = Array.from(skippedIcaos).sort();

    // Shared submission log — reset when the WEF cycle changes
    if (state.log.wef !== wef) state.log = { wef, entries: [] };
    state.log.entries.push({ time: ctx.now, currentCycle, nextCycle, skipped, rejected });

    // "Last published" only moves when something REAL was applied, regardless of that
    // batch's WEF: a freshness marker for crew to match against a FlightBox announcement.
    if (appliedIcaos.size > 0) state.sync = { lastPublished: today };

    return { wef, currentCycle, nextCycle, skipped, rejected };
  }

  /* ── Writing: staged airfield changes (add / edit / delete → publish) ── */

  function countOverridesForIcao(overrides, icao) {
    let n = 0;
    for (const k in overrides) if (overrides[k].icao === icao) n++;
    return n;
  }

  // Pending list as shown to the admin, oldest first, with how many live override
  // entries each action touches.
  function pendingView(state) {
    const actions = Object.values(state.pending.actions).map(a => ({
      ...a, affectedOverrides: countOverridesForIcao(state.overrides, a.icao),
    }));
    actions.sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));
    return actions;
  }

  // input = { action: "add"|"edit"|"delete", icao, data }; returns {ok:true} or {error}
  function queueAction(state, input, ctx) {
    const byIcao = indexAirfields(ctx.airfields);
    const overlay = state.overlay;
    const pending = state.pending;
    const action = input.action;

    if (action === "add") {
      const v = validateAirfieldRecord(input.data || {});
      if (v.error) return { error: v.error };
      if (effectiveRecord(v.record.icao, byIcao, overlay)) {
        return { error: "ICAO " + v.record.icao + " already exists — use Edit instead" };
      }
      pending.actions[v.record.icao] = { type: "add", icao: v.record.icao, data: v.record, queuedAt: ctx.now };
    } else if (action === "edit") {
      const originalIcao = String(input.icao || "").trim().toUpperCase();
      if (!originalIcao) return { error: "original ICAO is required for edit" };
      if (!effectiveRecord(originalIcao, byIcao, overlay)) return { error: "ICAO " + originalIcao + " not found" };
      const v = validateAirfieldRecord(input.data || {});
      if (v.error) return { error: v.error };
      if (v.record.icao !== originalIcao && effectiveRecord(v.record.icao, byIcao, overlay)) {
        return { error: "ICAO " + v.record.icao + " already exists" };
      }
      pending.actions[originalIcao] = { type: "edit", icao: originalIcao, data: v.record, queuedAt: ctx.now };
    } else if (action === "delete") {
      const icao = String(input.icao || "").trim().toUpperCase();
      if (!icao) return { error: "icao is required" };
      if (!effectiveRecord(icao, byIcao, overlay)) return { error: "ICAO " + icao + " not found" };
      pending.actions[icao] = { type: "delete", icao, data: null, queuedAt: ctx.now };
    } else {
      return { error: "invalid action — must be add, edit, or delete" };
    }
    return { ok: true };
  }

  function removePending(state, icao) {
    delete state.pending.actions[String(icao || "").trim().toUpperCase()];
    return { ok: true };
  }

  function cancelPending(state) {
    state.pending = { actions: {} };
    return { ok: true };
  }

  // Apply every pending action at once; moves the "Live" date; returns the summary.
  function publishPending(state, ctx) {
    const byIcao = indexAirfields(ctx.airfields);
    const { overlay, overrides } = state;
    const actions = Object.values(state.pending.actions);
    if (!actions.length) return { error: "nothing pending to publish" };

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
          // Renaming the ICAO: drop the old overlay edit, tombstone the old code if it
          // was a baked-in airfield, and rekey live overrides so PCN history follows
          // the airfield to its new code.
          delete overlay.edits[act.icao];
          if (byIcao[act.icao] && !overlay.deleted.includes(act.icao)) overlay.deleted.push(act.icao);
          for (const k of Object.keys(overrides)) {
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
        const beforeRwys = new Set(((before && before.runways) || []).map(r => r.rwy));
        const newlyAdded = act.data.runways.map(r => r.rwy).filter(rwy => !beforeRwys.has(rwy));
        if (newlyAdded.length) newRunwaysByIcao[newIcao] = newlyAdded;
      } else if (act.type === "delete") {
        delete overlay.edits[act.icao];
        if (!overlay.deleted.includes(act.icao)) overlay.deleted.push(act.icao);
        deleted.push(act.icao);
      }
    }

    state.pending = { actions: {} };
    state.sync = { lastPublished: ctx.today };
    return { added, edited, deleted, newRunwaysByIcao, lastPublished: ctx.today, reminder: REMINDER };
  }

  return {
    PCN_RE, RWY_RE, FILES, REMINDER, normalizeRunway,
    emptyState, normalizeState, serialize, todayUtc, normalizeWef,
    computeLive,
    indexAirfields, effectiveRecord, overlayRecordToTuple, buildEffectiveAirfields, validateAirfieldRecord,
    getCurrentActivePcn, applyBatch,
    countOverridesForIcao, pendingView, queueAction, removePending, cancelPending, publishPending,
  };
});
