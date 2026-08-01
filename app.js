const APP_VERSION = "2.13";
const APP_VERSION_DATE = "2026-07-31";
// NOTE: bump APP_VERSION on every update; keep sw.js CACHE name in sync ("pcr-pcn-v<ver>").

/* ================================================================
   PCR / PCN Calculator — data
   ================================================================
   Minimum weight per type is Boeing's published ACAP figure (D6-58329-2,
   Section 7.10/7.11) — NOT an aircraft-specific APS weight. Per DHL
   management decision (2026-07-31), APS is not used in this calculation:
   Boeing's own two published table points (max taxi weight, min weight)
   are used as-is, with no substitution/extrapolation beyond them.

   acrMax applies at maxTaxi; acrMin applies at minWeight. */

const AIRCRAFT_TYPES = {
  "757-200": {
    maxTaxi: 116119,
    minWeight: 51709,
    PCR: { RA:{max:310,min:110}, RB:{max:370,min:120}, RC:{max:420,min:130}, RD:{max:470,min:150},
           FA:{max:260,min:120}, FB:{max:290,min:120}, FC:{max:340,min:120}, FD:{max:450,min:130} },
    PCN: { RA:{max:31,min:11}, RB:{max:37,min:12}, RC:{max:43,min:14}, RD:{max:49,min:17},
           FA:{max:30,min:11}, FB:{max:33,min:12}, FC:{max:40,min:13}, FD:{max:53,min:16} },
  },
  "767-300ER": {
    maxTaxi: 187333,
    minWeight: 90010,
    PCR: { RA:{max:530,min:200}, RB:{max:620,min:220}, RC:{max:700,min:250}, RD:{max:780,min:280},
           FA:{max:440,min:210}, FB:{max:480,min:210}, FC:{max:560,min:220}, FD:{max:740,min:240} },
    PCN: { RA:{max:48,min:19}, RB:{max:57,min:22}, RC:{max:68,min:25}, RD:{max:78,min:29},
           FA:{max:49,min:20}, FB:{max:54,min:21}, FC:{max:66,min:23}, FD:{max:87,min:30} },
  },
  "777F": {
    maxTaxi: 348721,
    minWeight: 144378,
    PCR: { RA:{max:760,min:220}, RB:{max:970,min:240}, RC:{max:1140,min:270}, RD:{max:1320,min:320},
           FA:{max:560,min:230}, FB:{max:610,min:230}, FC:{max:760,min:240}, FD:{max:1180,min:260} },
    PCN: { RA:{max:64,min:21}, RB:{max:83,min:23}, RC:{max:106,min:27}, RD:{max:128,min:34},
           FA:{max:62,min:19}, FB:{max:69,min:21}, FC:{max:86,min:23}, FD:{max:117,min:31} },
  },
};

const TYPE_BADGE = { "757-200": "cat-B757", "767-300ER": "cat-B767", "777F": "cat-B777" };

/* ================================================================
   UI wiring
   ================================================================ */

const $ = id => document.getElementById(id);
const fmt = n => n.toLocaleString("en-GB", { maximumFractionDigits: 0 });
const fmt1 = n => n.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Populate aircraft type dropdown
(function initTypes() {
  const sel = $("acTypeSelect");
  Object.keys(AIRCRAFT_TYPES).forEach(type => {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = type;
    sel.appendChild(opt);
  });
})();

// Segmented control (PCR / PCN) — scope to [data-val] so the MTW/MLW
// buttons on the Check tab (same .seg-btn class) don't clobber calcSystem
let calcSystem = "PCR";
document.querySelectorAll(".seg-btn[data-val]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn[data-val]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    calcSystem = btn.dataset.val;
    recalc();
  });
});

["acTypeSelect", "pavementSelect", "subgradeSelect", "weightInput", "pcnInput"]
  .forEach(id => {
    $(id).addEventListener("input", recalc);
    $(id).addEventListener("change", recalc);
  });

function current() {
  const typeName = $("acTypeSelect").value;
  const type = AIRCRAFT_TYPES[typeName];
  if (!type) return null;
  const code = $("pavementSelect").value + $("subgradeSelect").value; // e.g. "RB"
  const acr = type[calcSystem][code];
  return { typeName, type, code, acr };
}

function recalc() {
  const c = current();
  if (!c) return;
  const { typeName, type, code, acr } = c;
  const unit = calcSystem;

  // Aircraft summary line
  $("acType").textContent = typeName;
  $("acType").className = "badge " + (TYPE_BADGE[typeName] || "cat-MISC");
  $("acMinWt").textContent = fmt(type.minWeight) + " kg";
  $("acMaxTaxi").textContent = fmt(type.maxTaxi) + " kg";
  $("acrLabel").textContent = unit === "PCR" ? "ACR" : "ACN";
  $("acrRange").textContent = acr.min + " – " + acr.max;
  $("codeChip").textContent = typeName + " · " + $("pavementSelect").value + " · " + $("subgradeSelect").value + " · " + unit;
  $("wtLabel").textContent = "Actual weight (kg)";
  $("pcnLabel").textContent = "Published " + unit + " of pavement";
  $("resMinLabel").textContent = "Minimum " + unit + " required";
  $("weightInput").min = type.minWeight;
  $("weightInput").max = type.maxTaxi;

  const span = type.maxTaxi - type.minWeight;

  // 1) Actual weight -> minimum PCR/PCN required
  const w = parseFloat($("weightInput").value);
  const resMin = $("resMin"), noteMin = $("resMinNote"), cardMin = $("cardMin");
  if (isNaN(w)) {
    resMin.textContent = "—";
    noteMin.textContent = "Enter the actual weight";
    cardMin.className = "kpi-card";
  } else {
    const val = acr.max - ((type.maxTaxi - w) / span) * (acr.max - acr.min);
    resMin.textContent = fmt1(val);
    if (w > type.maxTaxi) {
      noteMin.textContent = "Weight exceeds max taxi weight (" + fmt(type.maxTaxi) + " kg)";
      cardMin.className = "kpi-card kc-red";
    } else if (w < type.minWeight) {
      noteMin.textContent = "Below " + typeName + " minimum weight (" + fmt(type.minWeight) + " kg, Boeing ACAP) — extrapolated";
      cardMin.className = "kpi-card kc-amber";
    } else {
      noteMin.textContent = "Pavement " + unit + " must be ≥ this value";
      cardMin.className = "kpi-card kc-blue";
    }
  }

  // 2) Published PCR/PCN -> max allowable weight
  const p = parseFloat($("pcnInput").value);
  const resWt = $("resWt"), noteWt = $("resWtNote"), cardWt = $("cardWt");
  if (isNaN(p)) {
    resWt.textContent = "—";
    noteWt.textContent = "Enter the published " + unit;
    cardWt.className = "kpi-card";
  } else {
    let val = ((p - acr.max) / (acr.max - acr.min)) * span + type.maxTaxi;
    if (val >= type.maxTaxi) {
      resWt.textContent = fmt(type.maxTaxi) + " kg";
      noteWt.textContent = "Not limiting — capped at max taxi weight";
      cardWt.className = "kpi-card kc-green";
    } else if (p < acr.min) {
      resWt.textContent = fmt(val) + " kg";
      noteWt.textContent = unit + " below chart minimum (" + acr.min + ") — extrapolated";
      cardWt.className = "kpi-card kc-red";
    } else {
      resWt.textContent = fmt(val) + " kg";
      noteWt.textContent = "Maximum weight for this pavement";
      cardWt.className = "kpi-card kc-amber";
    }
  }

  // Cross-check line: if both entered, state clearly whether ops is OK
  const verdict = $("verdict");
  if (!isNaN(w) && !isNaN(p)) {
    const reqd = acr.max - ((type.maxTaxi - w) / span) * (acr.max - acr.min);
    if (p >= reqd) {
      verdict.textContent = "✓ OK — published " + unit + " " + p + " covers the required " + fmt1(reqd);
      verdict.className = "verdict ok";
    } else {
      verdict.textContent = "✗ NOT OK — published " + unit + " " + p + " is below the required " + fmt1(reqd);
      verdict.className = "verdict bad";
    }
  } else {
    verdict.textContent = "";
    verdict.className = "verdict";
  }
}

recalc();
$("appVer").textContent = "Ver " + APP_VERSION + " · " + APP_VERSION_DATE;

/* ================================================================
   PCN / PCR Quick Check per airfield
   ================================================================
   Reference weights per type (admin table, Ver 1.1 workbook):
   Δ columns compare each runway's max allowable weight to MTW or MLW.
   Uses Boeing ACAP minWeight per type (see AIRCRAFT_TYPES) — same basis
   as the Calculator tab, no aircraft-specific APS. */

const REF_WEIGHTS = {
  MTW: { "757-200": 109316, "767-300ER": 187333, "777F": 348358 },
  MLW: { "757-200": 89992,  "767-300ER": 147871, "777F": 260815 },
};
const CHK_TYPES = [["757-200","B757"], ["767-300ER","B767"], ["777F","B777"]];

let refSel = "MTW";

// Live PCN/PCR runway overrides (uploaded via the separate admin tool).
// Read-only from here — this page never writes. Fails silently/gracefully
// if the API is unreachable (e.g. standalone file build, local testing).
const PCR_API_BASE = "https://dhl-audit.duckdns.org/pcr-api";
let OVERRIDES = {};

function fetchOverrides() {
  const status = $("syncStatus"), btn = $("getUpdateBtn");
  if (btn) btn.disabled = true;
  if (status) { status.textContent = "Checking for updates…"; status.className = "sync-status"; }
  return fetch(PCR_API_BASE + "/overrides", { cache: "no-store" })
    .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(data => {
      OVERRIDES = data || {};
      const n = Object.keys(OVERRIDES).length;
      if (status) {
        status.textContent = "Synced — " + n + " live update" + (n === 1 ? "" : "s") +
          " (" + new Date().toLocaleTimeString() + ")";
        status.className = "sync-status ok";
      }
      renderChk();
    })
    .catch(() => {
      if (status) { status.textContent = "Couldn't reach update server — showing baked-in data"; status.className = "sync-status err"; }
    })
    .finally(() => { if (btn) btn.disabled = false; });
}

(function initChk() {
  initAutocomplete();
  document.querySelectorAll("#refSeg .seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#refSeg .seg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      refSel = btn.dataset.ref;
      renderChk();
    });
  });
  const getBtn = $("getUpdateBtn");
  if (getBtn) getBtn.addEventListener("click", fetchOverrides);
  fetchOverrides(); // silent best-effort sync on load
})();

function initAutocomplete() {
  const input = $("icaoInput"), list = $("acList");
  let items = [], sel = -1;

  function close() { list.classList.remove("open"); items = []; sel = -1; }

  function pick(icao) {
    input.value = icao;
    close();
    renderChk();
  }

  function search(q) {
    q = q.trim().toUpperCase();
    if (!q) return [];
    const starts = [], contains = [];
    for (const a of AIRFIELDS) {
      if (a[0].startsWith(q) || (a[1] && a[1].startsWith(q))) starts.push(a);
      else if (a[2].toUpperCase().includes(q)) contains.push(a);
      if (starts.length >= 12) break;
    }
    return starts.concat(contains).slice(0, 12);
  }

  input.addEventListener("input", () => {
    renderChk();
    items = search(input.value);
    sel = -1;
    if (!items.length || (items.length === 1 && items[0][0] === input.value.trim().toUpperCase())) { close(); return; }
    list.innerHTML = items.map(a =>
      '<div class="ac-item" data-icao="' + a[0] + '"><b>' + a[0] + '</b>' +
      '<span class="ac-name">' + a[2] + '</span>' +
      (a[1] ? '<span class="ac-iata">' + a[1] + '</span>' : '') + '</div>').join("");
    list.classList.add("open");
  });

  input.addEventListener("keydown", e => {
    if (!list.classList.contains("open")) return;
    const nodes = list.children;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = e.key === "ArrowDown" ? Math.min(sel + 1, nodes.length - 1) : Math.max(sel - 1, 0);
      [...nodes].forEach((n, i) => n.classList.toggle("sel", i === sel));
      nodes[sel].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(sel >= 0 ? nodes[sel].dataset.icao : items[0][0]);
    } else if (e.key === "Escape") {
      close();
    }
  });

  // mousedown (not click) so it fires before the input's blur
  list.addEventListener("mousedown", e => {
    const item = e.target.closest(".ac-item");
    if (item) { e.preventDefault(); pick(item.dataset.icao); }
  });

  input.addEventListener("blur", () => setTimeout(close, 150));
}

function findAirfield(q) {
  q = q.trim().toUpperCase();
  if (!q) return null;
  return AIRFIELDS.find(a => a[0] === q) ||
         AIRFIELDS.find(a => a[1] === q) ||
         AIRFIELDS.find(a => a[2].toUpperCase() === q) || null;
}

function parsePcn(str) {
  const parts = (str || "").split("/");
  const val = parseFloat(parts[0]);
  if (isNaN(val) || parts.length < 3) return null;
  return { val, pav: parts[1], sub: parts[2] };
}

function renderChk() {
  const af = findAirfield($("icaoInput").value);
  $("afCard").style.display = af ? "" : "none";
  $("afEmpty").style.display = af ? "none" : "";
  if (!af) return;

  const [icao, iata, name, ops, status, system, runways] = af;

  $("afHead").innerHTML =
    '<span class="af-name">' + name + '</span>' +
    '<span><b>' + icao + '</b>' + (iata ? ' / ' + iata : '') + '</span>' +
    (system ? '<span class="badge ' + (system === "PCR" ? "cat-B777" : "cat-B767") + '">' + system + '</span>'
            : '<span class="badge cat-MISC">system not published</span>') +
    (ops ? '<span>' + ops + '</span>' : '') +
    (status ? '<span>' + status + '</span>' : '');

  let html = "<tr><th>RWY</th><th>Published " + (system || "PCN/PCR") + "</th>";
  CHK_TYPES.forEach(([, lbl]) => {
    html += "<th>" + lbl + " max wt (kg)</th><th>Δ vs " + refSel + "</th>";
  });
  html += "</tr>";

  const bestDelta = [-Infinity, -Infinity, -Infinity];
  let anyCalc = false;

  runways.forEach(([rwy, len, w, pcnStr]) => {
    const ov = OVERRIDES[icao + "|" + rwy];
    const liveStr = ov ? ov.pcn : pcnStr;
    const pcnCell = ov
      ? "<td>" + liveStr + " <span title='Updated " + new Date(ov.updatedAt).toLocaleString() +
        "' style='color:var(--info);font-size:10px;font-weight:600'>●&nbsp;updated</span></td>"
      : "<td>" + (pcnStr || "—") + "</td>";
    html += "<tr><td><b>" + rwy + "</b></td>" +
      pcnCell;
    const p = system ? parsePcn(liveStr) : null;
    CHK_TYPES.forEach(([type], i) => {
      const chart = p && AIRCRAFT_TYPES[type][system][p.pav + p.sub];
      if (!chart) { html += "<td class='num'>—</td><td class='num'>—</td>"; return; }
      anyCalc = true;
      const t = AIRCRAFT_TYPES[type];
      const maxA = t.maxTaxi + ((p.val - chart.max) / (chart.max - chart.min)) * (t.maxTaxi - t.minWeight);
      const delta = maxA - REF_WEIGHTS[refSel][type];
      if (delta > bestDelta[i]) bestDelta[i] = delta;
      html += "<td class='num'>" + fmt(maxA) + "</td>" +
        "<td class='num " + (delta < 0 ? "delta-neg" : "delta-pos") + "'>" +
        (delta >= 0 ? "+" : "") + fmt(delta) + "</td>";
    });
    html += "</tr>";
  });
  $("rwyTable").innerHTML = html;

  const v = $("chkVerdict");
  if (!anyCalc) {
    v.textContent = system ? "No published pavement data — check the AIP" : "PCR/PCN system not published for this airfield";
    v.className = "verdict";
    v.style.color = "var(--text3)";
  } else {
    v.style.color = "";
    const limited = bestDelta.some((d, i) => d !== -Infinity && d < 0);
    if (limited) {
      const who = CHK_TYPES.filter((_, i) => bestDelta[i] !== -Infinity && bestDelta[i] < 0).map(([, l]) => l).join(", ");
      v.textContent = "✗ PCN/PCR Limited — no runway supports " + refSel + " for: " + who;
      v.className = "verdict bad";
    } else {
      v.textContent = "✓ Not limited — at least one runway supports " + refSel + " for all types";
      v.className = "verdict ok";
    }
  }
}

/* ── Tabs ── */
function showPage(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === id));
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.toggle("active", t.dataset.page === id));
}
document.querySelectorAll(".nav-tab").forEach(t =>
  t.addEventListener("click", () => showPage(t.dataset.page)));

// PWA service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
