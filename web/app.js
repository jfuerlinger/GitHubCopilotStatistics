const elements = Object.fromEntries(["status","from","to","actor","load","summary","chart","details"].map(id => [id, document.getElementById(id)]));
elements.creditsChart = document.getElementById("credits-chart");
elements.repoBreakdown = document.getElementById("repo-breakdown");
elements.themeToggle = document.getElementById("theme-toggle");
elements.themeIcon = document.getElementById("theme-icon");
elements.themeLabel = document.getElementById("theme-label");

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

function render() {
  const visible = filteredRows();
  const totals = visible.reduce((sum, row) => ({
    sessions: sum.sessions + row.sessions, input: sum.input + row.inputTokens,
    output: sum.output + row.outputTokens, credits: sum.credits + row.githubAiCredits
  }), { sessions:0, input:0, output:0, credits:0 });
  elements.summary.innerHTML = [
    ["Session-Modell-Nutzungen", number.format(totals.sessions)], ["Input Tokens", number.format(totals.input)],
    ["Output Tokens", number.format(totals.output)], ["GitHub AI Credits", decimal.format(totals.credits)]
  ].map(([label,value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("");

  const months = new Map();
  visible.forEach(row => months.set(row.month, (months.get(row.month) || 0) + row.githubAiCredits));
  const max = Math.max(...months.values(), 0.01);
  elements.chart.innerHTML = months.size ? [...months].sort().map(([month,total]) => `<div class="bar-group"><span class="bar-value">${decimal.format(total)}</span><div class="bar-track"><div class="bar credits" style="height:${Math.max(2,total/max*100)}%"></div></div><span class="bar-label">${month}</span></div>`).join("") : '<p class="empty">Keine Daten im gewählten Zeitraum.</p>';

  const credits = new Map();
  visible.forEach(row => credits.set(row.actor, (credits.get(row.actor) || 0) + row.githubAiCredits));
  const maxCredits = Math.max(...credits.values(), 0.01);
  elements.creditsChart.innerHTML = credits.size ? [...credits].sort((a,b) => b[1] - a[1]).map(([actor,total]) => `<div class="bar-group"><span class="bar-value">${decimal.format(total)}</span><div class="bar-track"><div class="bar credits" style="height:${Math.max(2,total/maxCredits*100)}%"></div></div><span class="bar-label">${escapeHtml(actor)}</span></div>`).join("") : '<p class="empty">Keine Daten im gewählten Zeitraum.</p>';

  elements.repoBreakdown.innerHTML = repoBreakdown.length ? repoBreakdown.map(row => `<tr><td>${escapeHtml(row.month)}</td><td>${escapeHtml(row.repository)}</td><td class="number">${decimal.format(row.githubAiCredits)}</td></tr>`).join("") : '<tr><td colspan="3" class="empty">Keine Daten.</td></tr>';

  elements.details.innerHTML = visible.length ? visible.map(row => `<tr><td>${escapeHtml(row.month)}</td><td>${escapeHtml(row.actor)}</td><td>${escapeHtml(row.model)}</td><td class="number">${number.format(row.sessions)}</td><td class="number">${number.format(row.inputTokens)}</td><td class="number">${number.format(row.outputTokens)}</td><td class="number">${number.format(row.cacheReadTokens + row.cacheWriteTokens)}</td><td class="number">${number.format(row.reasoningTokens)}</td><td class="number">${decimal.format(row.githubAiCredits)}</td></tr>`).join("") : '<tr><td colspan="9" class="empty">Keine Daten.</td></tr>';
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
loadReport();
