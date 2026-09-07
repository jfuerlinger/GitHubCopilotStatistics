const elements = Object.fromEntries(["status","from","to","actor","load","summary","chart","details"].map(id => [id, document.getElementById(id)]));
elements.creditsChart = document.getElementById("credits-chart");
elements.repoBreakdown = document.getElementById("repo-breakdown");
elements.themeToggle = document.getElementById("theme-toggle");
elements.themeIcon = document.getElementById("theme-icon");
elements.themeLabel = document.getElementById("theme-label");
elements.detailsHead = document.getElementById("details-head");
elements.creditPrice = document.getElementById("credit-price");
elements.dateGranularity = document.getElementById("date-granularity");
const groupByInputs = [...document.querySelectorAll(".group-by-option")];

const THEME_KEY = "copilot-usage-theme";
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  elements.themeToggle.setAttribute("aria-pressed", String(theme === "light"));
  elements.themeIcon.textContent = theme === "light" ? "☀️" : "🌙";
  elements.themeLabel.textContent = theme === "light" ? "Hell" : "Dark";
}
function initTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  const preferred = stored || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  applyTheme(preferred);
}
elements.themeToggle.addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
});
initTheme();

const number = new Intl.NumberFormat("de-DE");
const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const currentMonth = new Date().toISOString().slice(0, 7);
elements.from.value = `${new Date().getUTCFullYear()}-01`;
elements.to.value = currentMonth;
let rows = [];
let repoBreakdown = [];

function setStatus(message, error = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
}

async function api(path) {
  const response = await fetch(`/api/${path}`);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
  return response.json();
}

function filteredRows() {
  return elements.actor.value === "all" ? rows : rows.filter(row => row.actor === elements.actor.value);
}

const DIMENSIONS = [["date","Datum"],["actor","Person"],["model","Modell"]];
const METRICS = [
  ["sessions","Sessions", value => number.format(value)],
  ["inputTokens","Input", value => number.format(value)],
  ["outputTokens","Output", value => number.format(value)],
  ["cacheTokens","Cache", value => number.format(value)],
  ["reasoningTokens","Reasoning", value => number.format(value)],
  ["githubAiCredits","AI Credits", value => decimal.format(value)],
  ["costEur","Kosten (€)", value => euro.format(value)]
];

function creditPrice() {
  const value = Number(elements.creditPrice.value);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function activeDimensions() {
  return groupByInputs.filter(input => input.checked).map(input => input.value);
}

function dateGranularity() {
  return elements.dateGranularity.value === "day" ? "day" : "month";
}

function dateValue(row) {
  const date = row.date || row.month || "";
  return dateGranularity() === "day" ? date : date.slice(0, 7);
}

function normalize(row) {
  return {
    date: dateValue(row), month: row.month, actor: row.actor, model: row.model,
    sessions: row.sessions || 0, inputTokens: row.inputTokens || 0, outputTokens: row.outputTokens || 0,
    cacheTokens: (row.cacheReadTokens || 0) + (row.cacheWriteTokens || 0),
    reasoningTokens: row.reasoningTokens || 0, githubAiCredits: row.githubAiCredits || 0,
    costEur: (row.githubAiCredits || 0) * creditPrice()
  };
}

function groupRows(source) {
  const dimensions = activeDimensions();
  const groups = new Map();
  source.map(normalize).forEach(row => {
    const key = dimensions.map(dimension => row[dimension]).join("\u0000");
    let group = groups.get(key);
    if (!group) {
      group = { date: "Alle", actor: "Alle", model: "Alle" };
      METRICS.forEach(([metric]) => { group[metric] = 0; });
      dimensions.forEach(dimension => { group[dimension] = row[dimension]; });
      groups.set(key, group);
    }
    METRICS.forEach(([metric]) => { group[metric] += row[metric]; });
  });
  return [...groups.values()].sort((a, b) => `${a.date}${a.actor}${a.model}`.localeCompare(`${b.date}${b.actor}${b.model}`));
}

function render() {
  const visible = filteredRows();
  const totals = visible.reduce((sum, row) => ({
    sessions: sum.sessions + row.sessions, input: sum.input + row.inputTokens,
    output: sum.output + row.outputTokens, credits: sum.credits + row.githubAiCredits
  }), { sessions:0, input:0, output:0, credits:0 });
  elements.summary.innerHTML = [
    ["Session-Modell-Nutzungen", number.format(totals.sessions)], ["Input Tokens", number.format(totals.input)],
    ["Output Tokens", number.format(totals.output)], ["GitHub AI Credits", decimal.format(totals.credits)],
    ["Kosten", euro.format(totals.credits * creditPrice())]
  ].map(([label,value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");

  const months = new Map();
  visible.forEach(row => { const key = dateValue(row); months.set(key, (months.get(key) || 0) + row.githubAiCredits); });
  const max = Math.max(...months.values(), 0.01);
  elements.chart.innerHTML = months.size ? [...months].sort().map(([month,total]) => `<div class="bar-group"><span class="bar-value">${decimal.format(total)}</span><div class="bar-track"><div class="bar credits" style="height:${Math.max(2,total/max*100)}%"></div></div><span class="bar-label">${month}</span></div>`).join("") : '<p class="empty">Keine Daten im gewählten Zeitraum.</p>';

  const credits = new Map();
  visible.forEach(row => credits.set(row.actor, (credits.get(row.actor) || 0) + row.githubAiCredits));
  const maxCredits = Math.max(...credits.values(), 0.01);
  elements.creditsChart.innerHTML = credits.size ? [...credits].sort((a,b) => b[1] - a[1]).map(([actor,total]) => `<div class="bar-group"><span class="bar-value">${decimal.format(total)}</span><div class="bar-track"><div class="bar credits" style="height:${Math.max(2,total/maxCredits*100)}%"></div></div><span class="bar-label">${escapeHtml(actor)}</span></div>`).join("") : '<p class="empty">Keine Daten im gewählten Zeitraum.</p>';

  elements.repoBreakdown.innerHTML = repoBreakdown.length ? repoBreakdown.map(row => `<tr><td>${escapeHtml(row.month)}</td><td>${escapeHtml(row.repository)}</td><td class="number">${decimal.format(row.githubAiCredits)}</td><td class="number">${euro.format(row.githubAiCredits * creditPrice())}</td></tr>`).join("") : '<tr><td colspan="4" class="empty">Keine Daten.</td></tr>';

  const dimensions = activeDimensions();
  const shownDimensions = dimensions.length ? DIMENSIONS.filter(([key]) => dimensions.includes(key)) : DIMENSIONS;
  const grouped = groupRows(visible);
  elements.detailsHead.innerHTML = shownDimensions.map(([, label]) => `<th>${label}</th>`).join("") + METRICS.map(([, label]) => `<th class="number">${label}</th>`).join("");
  const columnCount = shownDimensions.length + METRICS.length;
  elements.details.innerHTML = grouped.length ? grouped.map(row =>
    `<tr>${shownDimensions.map(([key]) => `<td>${escapeHtml(row[key])}</td>`).join("")}${METRICS.map(([metric,, format]) => `<td class="number">${format(row[metric])}</td>`).join("")}</tr>`
  ).join("") : `<tr><td colspan="${columnCount}" class="empty">Keine Daten.</td></tr>`;
}

async function loadReport() {
  setStatus("Auswertung wird geladen …");
  try {
    const query = new URLSearchParams({ from: elements.from.value, to: elements.to.value });
    const report = await api(`reports/monthly?${query}`);
    rows = report.rows || [];
    repoBreakdown = report.repoBreakdown || [];
    const actors = [...new Set(rows.map(row => row.actor))].sort();
    const selection = elements.actor.value;
    elements.actor.innerHTML = '<option value="all">Alle Personen</option>' + actors.map(actor => `<option value="${escapeHtml(actor)}">${escapeHtml(actor)}</option>`).join("");
    if (actors.includes(selection)) elements.actor.value = selection;
    render();
    setStatus(`${rows.length} Gruppen geladen`);
  } catch (error) { setStatus(error.message, true); }
}

elements.load.addEventListener("click", loadReport);
elements.actor.addEventListener("change", render);
groupByInputs.forEach(input => input.addEventListener("change", render));
elements.creditPrice.addEventListener("input", render);
elements.dateGranularity.addEventListener("change", render);
loadReport();
