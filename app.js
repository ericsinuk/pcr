const APP_VERSION = "2.7";
const APP_VERSION_DATE = "2026-07-10";
// NOTE: bump APP_VERSION on every update; keep sw.js CACHE name in sync ("pcr-pcn-v<ver>").

/* ================================================================
   PCR / PCN Calculator — data
   ================================================================
   FLEET: one entry per aircraft registration.
   - reg   : registration shown in the dropdown
   - type  : must match a key in AIRCRAFT_TYPES
   - minWt : this tail's minimum weight (kg) used in the interpolation
   Source: PCR_PCN_Data.xlsx (Fleet sheet), 2026-07-09
   ================================================================ */

const FLEET = [
  { reg: "G-BMRA", type: "757-200",   minWt: 55052 },
  { reg: "G-BMRB", type: "757-200",   minWt: 55027 },
  { reg: "G-BMRD", type: "757-200",   minWt: 55032 },
  { reg: "G-BMRI", type: "757-200",   minWt: 54932 },
  { reg: "G-BMRJ", type: "757-200",   minWt: 55102 },
  { reg: "G-DHLE", type: "767-300ER", minWt: 85502 },
  { reg: "G-DHLJ", type: "767-300ER", minWt: 85380 },
  { reg: "G-DHLK", type: "767-300ER", minWt: 85355 },
  { reg: "G-DHLM", type: "767-300ER", minWt: 83489 },
  { reg: "G-DHLO", type: "767-300ER", minWt: 83776 },
  { reg: "G-DHLP", type: "767-300ER", minWt: 83721 },
  { reg: "G-DHLR", type: "767-300ER", minWt: 83739 },
  { reg: "G-DHLS", type: "767-300ER", minWt: 83684 },
  { reg: "G-DHLU", type: "777F",      minWt: 141408.2 },
  { reg: "G-DHLV", type: "777F",      minWt: 141456.2 },
  { reg: "G-DHLW", type: "777F",      minWt: 141681.2 },
  { reg: "G-DHLX", type: "777F",      minWt: 141475.88 },
  { reg: "G-DHLY", type: "777F",      minWt: 141478.2 },
  { reg: "G-DHMC", type: "777F",      minWt: 140592.2 },
  { reg: "G-DHMD", type: "777F",      minWt: 142276.2 },
];

/* Per-type data: max taxi weight + ACR/ACN values per pavement (R/F)
   and subgrade (A–D), for PCR and PCN systems.
   acrMax applies at maxTaxi; acrMin applies at the aircraft's minWt. */

const AIRCRAFT_TYPES = {
  "757-200": {
    maxTaxi: 116119,
    PCR: { RA:{max:310,min:110}, RB:{max:370,min:120}, RC:{max:420,min:130}, RD:{max:470,min:150},
           FA:{max:260,min:120}, FB:{max:290,min:120}, FC:{max:340,min:120}, FD:{max:450,min:130} },
    PCN: { RA:{max:31,min:11}, RB:{max:37,min:12}, RC:{max:43,min:14}, RD:{max:49,min:17},
           FA:{max:30,min:11}, FB:{max:33,min:12}, FC:{max:40,min:13}, FD:{max:53,min:16} },
  },
  "767-300ER": {
    maxTaxi: 187333,
    PCR: { RA:{max:530,min:200}, RB:{max:620,min:220}, RC:{max:700,min:250}, RD:{max:780,min:280},
           FA:{max:440,min:210}, FB:{max:480,min:210}, FC:{max:560,min:220}, FD:{max:740,min:240} },
    PCN: { RA:{max:48,min:19}, RB:{max:57,min:22}, RC:{max:68,min:25}, RD:{max:78,min:29},
           FA:{max:49,min:20}, FB:{max:54,min:21}, FC:{max:66,min:23}, FD:{max:87,min:30} },
  },
  "777F": {
    maxTaxi: 348721,
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

// Populate registration dropdown grouped by type
(function initFleet() {
  const sel = $("regSelect");
  const byType = {};
  FLEET.forEach(a => { (byType[a.type] = byType[a.type] || []).push(a); });
  Object.keys(byType).forEach(type => {
    const og = document.createElement("optgroup");
    og.label = type;
    byType[type].forEach(a => {
      const opt = document.createElement("option");
      opt.value = a.reg;
      opt.textContent = a.reg;
      og.appendChild(opt);
    });
    sel.appendChild(og);
  });
})();

// Segmented control (PCR / PCN)
let calcSystem = "PCR";
document.querySelectorAll(".seg-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    calcSystem = btn.dataset.val;
    recalc();
  });
});

["regSelect", "pavementSelect", "subgradeSelect", "weightInput", "pcnInput"]
  .forEach(id => {
    $(id).addEventListener("input", recalc);
    $(id).addEventListener("change", recalc);
  });

function current() {
  const ac = FLEET.find(a => a.reg === $("regSelect").value);
  if (!ac) return null;
  const type = AIRCRAFT_TYPES[ac.type];
  const code = $("pavementSelect").value + $("subgradeSelect").value; // e.g. "RB"
  const acr = type[calcSystem][code];
  return { ac, type, code, acr };
}

function recalc() {
  const c = current();
  if (!c) return;
  const { ac, type, code, acr } = c;
  const unit = calcSystem;

  // Aircraft summary line
  $("acType").textContent = ac.type;
  $("acType").className = "badge " + (TYPE_BADGE[ac.type] || "cat-MISC");
  $("acMinWt").textContent = fmt(ac.minWt) + " kg";
  $("acMaxTaxi").textContent = fmt(type.maxTaxi) + " kg";
  $("acrRange").textContent = acr.min + " – " + acr.max;
  $("codeChip").textContent = ac.type + " · " + $("pavementSelect").value + " · " + $("subgradeSelect").value + " · " + unit;
  $("wtLabel").textContent = "Actual weight (kg)";
  $("pcnLabel").textContent = "Published " + unit + " of pavement";
  $("resMinLabel").textContent = "Minimum " + unit + " required";
  $("weightInput").min = ac.minWt;
  $("weightInput").max = type.maxTaxi;

  const span = type.maxTaxi - ac.minWt;

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
    } else if (w < ac.minWt) {
      noteMin.textContent = "Below " + ac.reg + " minimum weight (" + fmt(ac.minWt) + " kg) — extrapolated";
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
$("appVer").textContent = "Ver " + APP_VERSION + " \u00b7 " + APP_VERSION_DATE;

/* ================================================================
   PCN / PCR Quick Check per airfield (desktop only)
   ================================================================
   Reference weights per type (admin table, Ver 1.1 workbook):
   Δ columns compare each runway's max allowable weight to MTW or MLW. */

const REF_WEIGHTS = {
  MTW: { "757-200": 109316, "767-300ER": 187333, "777F": 348358 },
  MLW: { "757-200": 89992,  "767-300ER": 147871, "777F": 260815 },
};
const CHK_TYPES = [["757-200","B757"], ["767-300ER","B767"], ["777F","B777"]];

let refSel = "MTW";

// Registration pickers: one per type, defaulting to the lowest-minWt tail
// (most conservative for the max-weight interpolation).
(function initChk() {
  CHK_TYPES.forEach(([type], i) => {
    const sel = $(["chkReg757","chkReg767","chkReg777"][i]);
    const tails = FLEET.filter(a => a.type === type).slice()
      .sort((a, b) => a.minWt - b.minWt);
    tails.forEach(a => {
      const opt = document.createElement("option");
      opt.value = a.reg;
      opt.textContent = a.reg + " (" + fmt(a.minWt) + " kg)";
      sel.appendChild(opt);
    });
    sel.addEventListener("change", renderChk);
  });

  const dl = $("afList");
  AIRFIELDS.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a[0];
    opt.label = a[0] + " — " + a[2] + (a[1] ? " (" + a[1] + ")" : "");
    dl.appendChild(opt);
  });

  $("icaoInput").addEventListener("input", renderChk);
  document.querySelectorAll("#refSeg .seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#refSeg .seg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      refSel = btn.dataset.ref;
      renderChk();
    });
  });
})();

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

function chkTail(id) { return FLEET.find(a => a.reg === $(id).value); }

function renderChk() {
  const af = findAirfield($("icaoInput").value);
  $("afCard").style.display = af ? "" : "none";
  $("afEmpty").style.display = af ? "none" : "";
  if (!af) return;

  const [icao, iata, name, ops, status, system, runways] = af;
  const tails = [chkTail("chkReg757"), chkTail("chkReg767"), chkTail("chkReg777")];

  $("afHead").innerHTML =
    '<span class="af-name">' + name + '</span>' +
    '<span><b>' + icao + '</b>' + (iata ? ' / ' + iata : '') + '</span>' +
    (system ? '<span class="badge ' + (system === "PCR" ? "cat-B777" : "cat-B767") + '">' + system + '</span>'
            : '<span class="badge cat-MISC">system not published</span>') +
    (ops ? '<span>' + ops + '</span>' : '') +
    (status ? '<span>' + status + '</span>' : '');

  let html = "<tr><th>RWY</th><th>Length (ft)</th><th>Width (ft)</th><th>Published " + (system || "PCN/PCR") + "</th>";
  CHK_TYPES.forEach(([, lbl], i) => {
    html += "<th>" + lbl + " max wt (kg)<br><span style='font-weight:400'>" + tails[i].reg + "</span></th><th>Δ vs " + refSel + "</th>";
  });
  html += "</tr>";

  const bestDelta = [-Infinity, -Infinity, -Infinity];
  let anyCalc = false;

  runways.forEach(([rwy, len, w, pcnStr]) => {
    html += "<tr><td><b>" + rwy + "</b></td>" +
      "<td class='num'>" + (len ? fmt(len) : "—") + "</td>" +
      "<td class='num'>" + (w ? fmt(w) : "—") + "</td>" +
      "<td>" + (pcnStr || "—") + "</td>";
    const p = system ? parsePcn(pcnStr) : null;
    CHK_TYPES.forEach(([type], i) => {
      const chart = p && AIRCRAFT_TYPES[type][system][p.pav + p.sub];
      if (!chart) { html += "<td class='num'>—</td><td class='num'>—</td>"; return; }
      anyCalc = true;
      const t = AIRCRAFT_TYPES[type];
      const maxA = t.maxTaxi + ((p.val - chart.max) / (chart.max - chart.min)) * (t.maxTaxi - tails[i].minWt);
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

/* ── Tabs + desktop-only gating ── */
const mqDesktop = window.matchMedia("(min-width:1000px) and (hover:hover) and (pointer:fine)");

function showPage(id) {
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === id));
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.toggle("active", t.dataset.page === id));
}
document.querySelectorAll(".nav-tab").forEach(t =>
  t.addEventListener("click", () => showPage(t.dataset.page)));

// If the viewport stops qualifying as desktop while on the Check tab, fall back.
// (addListener fallback: iOS Safari <14 has no addEventListener on MediaQueryList)
const onMqChange = e => {
  if (!e.matches && document.getElementById("page-chk").classList.contains("active")) {
    showPage("page-calc");
  }
};
if (mqDesktop.addEventListener) mqDesktop.addEventListener("change", onMqChange);
else if (mqDesktop.addListener) mqDesktop.addListener(onMqChange);

// PWA service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
