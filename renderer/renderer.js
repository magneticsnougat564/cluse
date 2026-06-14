// Renderer: holds latest records, applies filters, draws the amber terminal.
let RECORDS = [];
const state = { range: 'today', groupBy: 'project', search: '', showCost: true, model: 'all' };

const CELLS = 24; // VU-ladder segments per bar
const MODELS = [
  { id: 'all',         label: 'ALL',         sw: '' },
  { id: 'opus-4-8',    label: 'opus-4-8',    sw: 'solid' },
  { id: 'sonnet-4-6',  label: 'sonnet-4-6',  sw: 'tint' },
  { id: 'haiku-4-5',   label: 'haiku-4-5',   sw: 'hatch' },
  { id: 'fable-5',     label: 'fable-5',     sw: 'dot' },
];
const SW = { 'opus-4-8': 'solid', 'sonnet-4-6': 'tint', 'haiku-4-5': 'hatch', 'fable-5': 'dot' };

const $ = (id) => document.getElementById(id);
const shortModel = (m) => String(m || '').replace('claude-', '');
const swClass = (m) => SW[shortModel(m)] || 'solid';
const fmtTok = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K'
  : String(n);
const fmtCost = (n) => '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2));

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function sinceForRange(range) {
  if (range === 'all') return 0;
  if (range === 'today') return startOfToday();
  return Date.now() - (range === '7d' ? 7 : 30) * 86400_000;
}

function aggregate() {
  const since = sinceForRange(state.range);
  const groups = new Map();
  const totals = { tok: 0, cost: 0 };
  for (const r of RECORDS) {
    if (r.ts < since) continue;
    if (state.model !== 'all' && shortModel(r.model) !== state.model) continue;
    const key = r[state.groupBy] || 'unknown';
    let g = groups.get(key);
    if (!g) {
      g = { key, tok: 0, cost: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, last: 0, models: {} };
      groups.set(key, g);
    }
    g.tok += r.totalTokens;
    g.cost += r.cost;
    g.input += r.input;
    g.output += r.output;
    g.cacheWrite += r.cacheWrite5m + r.cacheWrite1h;
    g.cacheRead += r.cacheRead;
    g.last = Math.max(g.last, r.ts);
    g.models[r.model] = (g.models[r.model] || 0) + r.totalTokens;
    totals.tok += r.totalTokens;
    totals.cost += r.cost;
  }
  let rows = [...groups.values()].sort((a, b) => b.tok - a.tok);
  const q = state.search.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.key.toLowerCase().includes(q));
  return { rows, totals };
}

function ladder(lit) {
  let s = '';
  for (let i = 0; i < CELLS; i++) s += `<span class="cell${i < lit ? ' on' : ''}"></span>`;
  return s;
}

function render() {
  const { rows, totals } = aggregate();
  $('totTokens').textContent = fmtTok(totals.tok);
  $('totCost').textContent = state.showCost ? fmtCost(totals.cost) : '----';
  $('totGroups').textContent = String(rows.length);
  $('totGroupsLbl').textContent = state.groupBy === 'project' ? 'projects' : 'sessions';

  const liveOn = RECORDS.some((r) => Date.now() - r.ts < 60_000);
  $('live').classList.toggle('on', liveOn);
  $('led').classList.toggle('on', liveOn);

  const max = rows.length ? rows[0].tok : 1;
  const host = $('rows');
  if (!rows.length) { host.innerHTML = '<div class="empty">no signal in this range</div>'; return; }
  host.innerHTML = '';
  for (const r of rows) {
    const lit = Math.max(1, Math.round((r.tok / max) * CELLS));
    const el = document.createElement('div');
    el.className = 'row';
    const models = Object.entries(r.models)
      .sort((a, b) => b[1] - a[1])
      .map(([m, t]) => `<span><i class="sw ${swClass(m)}"></i>${shortModel(m)} ${fmtTok(t)}</span>`)
      .join('');
    el.innerHTML = `
      <div class="line">
        <span class="name">${escapeHtml(r.key)}</span>
        <span class="ladder">${ladder(lit)}</span>
        <span class="nums">
          <span class="tok">${fmtTok(r.tok)}</span>
          ${state.showCost ? `<span class="cost">${fmtCost(r.cost)}</span>` : ''}
        </span>
      </div>
      <div class="detail">
        <div class="grid">
          <div>input <b>${fmtTok(r.input)}</b></div>
          <div>output <b>${fmtTok(r.output)}</b></div>
          <div>cache write <b>${fmtTok(r.cacheWrite)}</b></div>
          <div>cache read <b>${fmtTok(r.cacheRead)}</b></div>
        </div>
        <div class="models">${models}</div>
      </div>`;
    el.addEventListener('click', () => el.classList.toggle('open'));
    host.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── model selector menu ──
function buildModelMenu() {
  const menu = $('modelMenu');
  menu.innerHTML = MODELS.map((m) =>
    `<div class="opt${m.id === state.model ? ' sel' : ''}" data-id="${m.id}">` +
    `${m.sw ? `<i class="sw ${m.sw}"></i>` : '<i class="sw" style="border-color:transparent"></i>'}${m.label}</div>`
  ).join('');
}
$('modelBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('modelMenu');
  menu.hidden = !menu.hidden;
  if (!menu.hidden) buildModelMenu();
});
$('modelMenu').addEventListener('click', (e) => {
  const opt = e.target.closest('.opt'); if (!opt) return;
  state.model = opt.dataset.id;
  const m = MODELS.find((x) => x.id === state.model);
  $('modelBtn').querySelector('b').textContent = m.label.toUpperCase();
  $('modelMenu').hidden = true;
  render();
});
document.addEventListener('click', () => { $('modelMenu').hidden = true; });

// ── other controls ──
$('range').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.range = b.dataset.range; setActive('range', b); render();
});
$('group').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.groupBy = b.dataset.group; setActive('group', b); render();
});
$('search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
$('costToggle').addEventListener('click', (e) => {
  state.showCost = !state.showCost;
  e.target.classList.toggle('lit', state.showCost);
  render();
});
function setActive(group, btn) { for (const b of $(group).children) b.classList.toggle('active', b === btn); }

// ── data in ──
window.cluse.onUsage((payload) => {
  RECORDS = payload.records || [];
  $('updated').textContent = 'sync ' + new Date(payload.computedAt).toLocaleTimeString();
  render();
});
setInterval(() => {
  const liveOn = RECORDS.some((r) => Date.now() - r.ts < 60_000);
  $('live').classList.toggle('on', liveOn);
  $('led').classList.toggle('on', liveOn);
}, 5000);
