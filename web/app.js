const elements = Object.fromEntries(["status","repository","from","to","actor","load","summary","chart","details"].map(id => [id, document.getElementById(id)]));
const number = new Intl.NumberFormat("de-DE");
const decimal = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const currentMonth = new Date().toISOString().slice(0, 7);
elements.from.value = `${new Date().getUTCFullYear()}-01`;
elements.to.value = currentMonth;
let rows = [];

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

async function loadRepositories() {
  try {
    const data = await api("repositories");
    elements.repository.innerHTML = '<option value="">Repository wählen</option>' + data.repositories.map(item => `<option value="${escapeHtml(item.repository)}">${escapeHtml(item.repository)}</option>`).join("");
    setStatus(`${data.repositories.length} Repositories`);
    if (data.repositories.length === 1) { elements.repository.value = data.repositories[0].repository; await loadReport(); }
  } catch (error) { setStatus(error.message, true); }
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
  visible.forEach(row => months.set(row.month, (months.get(row.month) || 0) + row.inputTokens + row.outputTokens));
  const max = Math.max(...months.values(), 1);
  elements.chart.innerHTML = months.size ? [...months].sort().map(([month,total]) => `<div class="bar-group"><span class="bar-value">${number.format(total)}</span><div class="bar-track"><div class="bar" style="height:${Math.max(2,total/max*100)}%"></div></div><span class="bar-label">${month}</span></div>`).join("") : '<p class="empty">Keine Daten im gewählten Zeitraum.</p>';

  elements.details.innerHTML = visible.length ? visible.map(row => `<tr><td>${escapeHtml(row.month)}</td><td>${escapeHtml(row.actor)}</td><td>${escapeHtml(row.model)}</td><td class="number">${number.format(row.sessions)}</td><td class="number">${number.format(row.inputTokens)}</td><td class="number">${number.format(row.outputTokens)}</td><td class="number">${number.format(row.cacheReadTokens + row.cacheWriteTokens)}</td><td class="number">${number.format(row.reasoningTokens)}</td><td class="number">${decimal.format(row.githubAiCredits)}</td></tr>`).join("") : '<tr><td colspan="9" class="empty">Keine Daten.</td></tr>';
}

async function loadReport() {
  if (!elements.repository.value) return setStatus("Bitte Repository wählen", true);
  setStatus("Auswertung wird geladen …");
  try {
    const query = new URLSearchParams({ repository: elements.repository.value, from: elements.from.value, to: elements.to.value });
    rows = (await api(`reports/monthly?${query}`)).rows;
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
loadRepositories();
