"use strict";

// Community-maintained public feed (static JSON on GitHub, CORS-enabled, last 7 days only).
const API_URL =
  "https://raw.githubusercontent.com/Babuperumana/kerala-lottery-api/main/result.json";

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const els = {
  form: document.getElementById("check-form"),
  ticket: document.getElementById("ticket"),
  ticketHint: document.getElementById("ticket-hint"),
  date: document.getElementById("draw-date"),
  draw: document.getElementById("draw-number"),
  chips: document.getElementById("date-chips"),
  submit: document.getElementById("submit-btn"),
  status: document.getElementById("load-status"),
  result: document.getElementById("result"),
};

let draws = []; // [{ iso, data }]

/* ---------- Helpers ---------- */

// "October 05 2026" -> "2026-10-05"
function toIsoDate(text) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(String(text || ""));
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function prettyDate(iso) {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function shortDate(iso) {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString("en-IN", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  });
}

const normaliseCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// "1st Prize" -> 1, "Cons Prize" -> 1.5 (shown right after 1st)
function prizeRank(name) {
  const m = /^(\d+)/.exec(name);
  if (m) return Number(m[1]);
  return /cons/i.test(name) ? 1.5 : 99;
}

// "BT 886602 (GURUVAYOOR)" -> { series: "BT", digits: "886602" }; "0101" -> { digits: "0101" }
function parseEntry(raw) {
  const clean = String(raw).replace(/\(.*?\)/g, "").trim().toUpperCase();
  let m = /^([A-Z]{2})\s*(\d+)$/.exec(clean);
  if (m) return { series: m[1], digits: m[2] };
  m = /^(\d+)$/.exec(clean);
  if (m) return { digits: m[1] };
  return null;
}

function parseTicket(input) {
  const m = /^([A-Za-z]{2})\s*-?\s*(\d{6})$/.exec(input.trim());
  return m ? { series: m[1].toUpperCase(), digits: m[2] } : null;
}

function drawCodeOf(data) {
  return data.drawNumber || data.drawNo || data.draw || data.code || null;
}

/* ---------- Matching ---------- */

function checkTicket(data, ticket) {
  const wins = [];
  const hits = new Set(); // "prizeName|rawEntry"

  for (const [prize, info] of Object.entries(data.prizes || {})) {
    for (const raw of info.numbers || []) {
      const entry = parseEntry(raw);
      if (!entry) continue;

      // Full-ticket prizes (series + number) vs. last-digits prizes (any series)
      const isWin = entry.series
        ? entry.series === ticket.series && entry.digits === ticket.digits
        : ticket.digits.endsWith(entry.digits);

      if (isWin) {
        wins.push({ prize, amount: info.amount });
        hits.add(`${prize}|${raw}`);
      }
    }
  }
  wins.sort((a, b) => prizeRank(a.prize) - prizeRank(b.prize));
  return { wins, hits };
}

/* ---------- Rendering ---------- */

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function showResult(...nodes) {
  els.result.replaceChildren(...nodes);
  els.result.focus({ preventScroll: false });
}

function verdict(kind, stampText, title, text) {
  return el("div", { class: `verdict ${kind}` },
    el("div", { class: "stamp" }, stampText),
    el("div", {}, el("h3", {}, title), el("p", {}, text)));
}

function fullResult(data, hits) {
  const details = el("details", {});
  details.append(el("summary", {}, "See the full draw result"));

  const prizes = Object.entries(data.prizes || {})
    .sort((a, b) => prizeRank(a[0]) - prizeRank(b[0]));

  for (const [name, info] of prizes) {
    const list = el("ul", { class: "numbers" });
    for (const raw of info.numbers || []) {
      const li = el("li", hits.has(`${name}|${raw}`) ? { class: "hit" } : {}, raw);
      list.append(li);
    }
    details.append(el("div", { class: "prize" },
      el("h4", {}, name, el("span", {}, info.amount || "")), list));
  }
  return details;
}

function renderChips() {
  els.chips.replaceChildren();
  for (const d of draws) {
    const chip = el("button", { type: "button", class: "chip", "data-iso": d.iso, "aria-pressed": "false" },
      `${shortDate(d.iso)} · ${d.data.name || "Draw"}`);
    chip.addEventListener("click", () => {
      els.date.value = d.iso;
      syncChips();
      els.ticket.focus();
    });
    els.chips.append(chip);
  }
  syncChips();
}

function syncChips() {
  for (const chip of els.chips.children) {
    chip.setAttribute("aria-pressed", String(chip.dataset.iso === els.date.value));
  }
}

/* ---------- Events ---------- */

els.date.addEventListener("input", syncChips);

els.ticket.addEventListener("input", () => {
  els.ticket.removeAttribute("aria-invalid");
  els.ticketHint.textContent = "Two series letters and six digits.";
  els.ticketHint.classList.remove("error");
});

els.form.addEventListener("submit", (event) => {
  event.preventDefault();

  const ticket = parseTicket(els.ticket.value);
  if (!ticket) {
    els.ticket.setAttribute("aria-invalid", "true");
    els.ticketHint.textContent = "Enter two letters followed by six digits, like BT 886602.";
    els.ticketHint.classList.add("error");
    els.ticket.focus();
    return;
  }

  if (!els.date.value) {
    showResult(verdict("info", "Date needed", "Pick the draw date",
      "Choose the date printed on your ticket, or tap one of the available dates."));
    els.date.focus();
    return;
  }

  const draw = draws.find((d) => d.iso === els.date.value);
  if (!draw) {
    const available = draws.map((d) => shortDate(d.iso)).join(", ");
    showResult(
      verdict("info", "No data", `No result found for ${prettyDate(els.date.value)}`,
        `The feed only covers: ${available}. For older draws, use the official site.`),
      el("p", { class: "note" }, "Older results are on statelottery.kerala.gov.in under Lottery Results."));
    return;
  }

  const data = draw.data;
  const typedDraw = els.draw.value.trim();
  const feedDraw = drawCodeOf(data);
  const notes = [];

  if (typedDraw && feedDraw) {
    if (normaliseCode(typedDraw) !== normaliseCode(feedDraw)) {
      showResult(verdict("info", "Mismatch", "Draw number doesn't match",
        `The draw on ${prettyDate(draw.iso)} is ${feedDraw}, not ${typedDraw}. Check the number on your ticket.`));
      els.draw.focus();
      return;
    }
  } else if (typedDraw && !feedDraw) {
    notes.push("This data source doesn't include draw numbers, so your ticket was matched by date only. Check that the draw number on your ticket matches the official result.");
  }

  const { wins, hits } = checkTicket(data, ticket);
  const label = `${ticket.series} ${ticket.digits}`;
  const meta = el("p", { class: "meta" },
    `${data.name || "Lottery"} · ${prettyDate(draw.iso)}${feedDraw ? " · " + feedDraw : ""}`);

  const out = [];
  if (wins.length) {
    const top = wins[0];
    out.push(verdict("win", "Prize!", `${label} won ${top.prize}`,
      `Prize amount: ${top.amount || "see official result"}`));
    if (wins.length > 1) {
      const list = el("ul", { class: "wins" });
      for (const w of wins) {
        list.append(el("li", {}, el("span", {}, w.prize), el("span", { class: "amount" }, w.amount || "")));
      }
      out.push(list);
    }
    out.push(el("p", { class: "note" },
      "Congratulations. Before claiming, verify this ticket against the official gazette and read the claim rules on statelottery.kerala.gov.in."));
  } else {
    out.push(verdict("lose", "No prize", `${label} didn't win`,
      "This ticket isn't in the prize lists for this draw."));
    out.push(el("p", { class: "note" },
      "Prize lists in the feed can be incomplete while a draw is still being published. Check again later or confirm on the official site."));
  }

  out.push(meta);
  for (const n of notes) out.push(el("p", { class: "note" }, n));
  out.push(fullResult(data, hits));
  showResult(...out);
});

/* ---------- Load data ---------- */

async function loadDraws() {
  try {
    const res = await fetch(API_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json) ? json : [json];

    draws = list
      .map((data) => ({ iso: toIsoDate(data.date), data }))
      .filter((d) => d.iso && d.data && d.data.prizes)
      .sort((a, b) => b.iso.localeCompare(a.iso));

    if (!draws.length) throw new Error("No draws in feed");

    renderChips();
    els.date.value = draws[0].iso;
    syncChips();
    els.status.textContent = `Latest result loaded: ${draws[0].data.name || "Draw"}, ${prettyDate(draws[0].iso)}.`;
    els.submit.disabled = false;
  } catch (err) {
    console.error(err);
    els.status.textContent =
      "Couldn't load results. Check your connection and reload the page. If it keeps failing, the feed may be down.";
    els.status.classList.add("error");
  }
}

loadDraws();
