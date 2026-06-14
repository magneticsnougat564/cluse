#!/usr/bin/env node
// Cluse Usage — terminal (TUI) edition. Cross-platform: Linux, macOS, PowerShell,
// Windows Terminal. Reuses the same data engine as the desktop app.
//
//   node tui.js          interactive live dashboard
//   node tui.js --once    print one snapshot and exit (good for piping)
//
const readline = require('readline');
const { parseAll, projectsDir } = require('./src/usage');

// ── amber-phosphor palette (truecolor; degrades fine on 256-color terms) ──
const A = '\x1b[38;2;255;176;0m';   // amber
const D = '\x1b[38;2;150;105;20m';  // dim amber
const F = '\x1b[38;2;80;56;12m';    // faint amber
const R = '\x1b[38;2;255;59;31m';   // led red
const B = '\x1b[1m';
const X = '\x1b[0m';
const HIDE = '\x1b[?25l', SHOW = '\x1b[?25h';
const HOME = '\x1b[H', CLR_DOWN = '\x1b[J', CLR_LINE = '\x1b[K';

// ── filter state (mirrors the GUI) ──
const RANGES = ['today', '7d', '30d', 'all'];
const MODELS = ['all', 'opus-4-8', 'sonnet-4-6', 'haiku-4-5', 'fable-5'];
const state = { range: 'today', groupBy: 'project', model: 'all', search: '', showCost: true, searching: false };
let RECORDS = [];
let lastSync = Date.now();
let forcedWidth = 0;   // --width override (one-shot)
let expandAll = false; // show every row (one-shot)

// ── helpers ──
const shortModel = (m) => String(m || '').replace('claude-', '');
const fmtTok = (n) =>
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
  : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K'
  : String(n);
const fmtCost = (n) => '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2));
const pad = (s, w) => (s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w));
const lpad = (s, w) => (s.length > w ? s.slice(0, w) : s.padStart(w));

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
function sinceFor(range) {
  if (range === 'all') return 0;
  if (range === 'today') return startOfToday();
  return Date.now() - (range === '7d' ? 7 : 30) * 86400_000;
}

function aggregate() {
  const since = sinceFor(state.range);
  const groups = new Map();
  const totals = { tok: 0, cost: 0 };
  for (const r of RECORDS) {
    if (r.ts < since) continue;
    if (state.model !== 'all' && shortModel(r.model) !== state.model) continue;
    const key = r[state.groupBy] || 'unknown';
    let g = groups.get(key);
    if (!g) { g = { key, tok: 0, cost: 0, last: 0 }; groups.set(key, g); }
    g.tok += r.totalTokens; g.cost += r.cost; g.last = Math.max(g.last, r.ts);
    totals.tok += r.totalTokens; totals.cost += r.cost;
  }
  let rows = [...groups.values()].sort((a, b) => b.tok - a.tok);
  const q = state.search.trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.key.toLowerCase().includes(q));
  return { rows, totals };
}

// ── rendering ──
function ladder(share, width) {
  const lit = Math.max(1, Math.round(share * width));
  return A + '█'.repeat(lit) + F + '─'.repeat(Math.max(0, width - lit)) + X;
}

function frame() {
  const cols = forcedWidth || Math.max(54, Math.min(process.stdout.columns || 80, 104));
  const W = cols - 2;                  // inside the border
  const { rows, totals } = aggregate();
  const live = RECORDS.some((r) => Date.now() - r.ts < 60_000);
  const out = [];

  const top = `${D}┌${'─'.repeat(W)}┐${X}`;
  const bot = `${D}└${'─'.repeat(W)}┘${X}`;
  const sep = `${D}├${'─'.repeat(W)}┤${X}`;
  const line = (inner, len) => `${D}│${X}${inner}${' '.repeat(Math.max(0, W - len))}${D}│${X}`;

  out.push(top);
  // title
  const title = `${B}${A}CLUSE${X} ${F}▒▒▒${X} ${D}USAGE${X}`;
  const liveTag = live ? `${R}●${X} ${A}LIVE${X}` : `${F}● LIVE${X}`;
  const titleLen = 'CLUSE ___ USAGE'.length, liveLen = 'o LIVE'.length;
  out.push(line(` ${title}${' '.repeat(Math.max(1, W - titleLen - liveLen - 3))}${liveTag} `, W));
  out.push(sep);
  // totals
  const totStr = ` ${B}${A}${fmtTok(totals.tok)}${X} ${D}tokens${X}   ${B}${A}${state.showCost ? fmtCost(totals.cost) : '—'}${X} ${D}cost${X}   ${B}${A}${rows.length}${X} ${D}${state.groupBy === 'project' ? 'projects' : 'sessions'}${X}`;
  const totLen = ` ${fmtTok(totals.tok)} tokens   ${state.showCost ? fmtCost(totals.cost) : '—'} cost   ${rows.length} ${state.groupBy === 'project' ? 'projects' : 'sessions'}`.length;
  out.push(line(totStr, totLen));
  // filter status
  const filt = ` ${D}range${X}:${A}${state.range}${X}  ${D}group${X}:${A}${state.groupBy === 'project' ? 'proj' : 'sess'}${X}  ${D}model${X}:${A}${state.model}${X}  ${D}find${X}:${A}${state.search || '—'}${X}${state.searching ? `${A}█${X}` : ''}`;
  const filtLen = ` range:${state.range}  group:${state.groupBy === 'project' ? 'proj' : 'sess'}  model:${state.model}  find:${state.search || '—'}${state.searching ? '_' : ''}`.length;
  out.push(line(filt, filtLen));
  out.push(sep);

  // rows
  const nameW = Math.min(20, Math.max(12, Math.floor(W * 0.22)));
  const tokW = 7, costW = state.showCost ? 8 : 0;
  const ladderW = Math.max(6, W - nameW - tokW - costW - 6);
  const max = rows.length ? rows[0].tok : 1;
  const bodyRows = expandAll ? rows.length : Math.max(3, (process.stdout.rows || 24) - 9);
  const shown = rows.slice(0, bodyRows);

  if (!shown.length) {
    out.push(line(`   ${F}no signal in this range${X}`, 27));
  } else {
    for (const r of shown) {
      const nm = `${A}${pad(r.key, nameW)}${X}`;
      const bar = ladder(r.tok / max, ladderW);
      const tk = `${A}${lpad(fmtTok(r.tok), tokW)}${X}`;
      const ct = state.showCost ? ` ${A}${B}${lpad(fmtCost(r.cost), costW - 1)}${X}` : '';
      const len = 1 + nameW + 1 + ladderW + 1 + tokW + costW;
      out.push(line(` ${nm} ${bar} ${tk}${ct}`, len));
    }
    if (rows.length > shown.length) {
      out.push(line(`   ${F}… ${rows.length - shown.length} more (narrow window)${X}`, 30));
    }
  }

  out.push(sep);
  // key hints
  const keys = ` ${D}[${A}r${D}]ange [${A}g${D}]roup [${A}m${D}]odel [${A}/${D}]find [${A}c${D}]ost [${A}q${D}]uit${X}`;
  const keysLen = ' [r]ange [g]roup [m]odel [/]find [c]ost [q]uit'.length;
  out.push(line(keys, keysLen));
  out.push(bot);

  process.stdout.write(HOME + out.map((l) => l + CLR_LINE).join('\n') + '\n' + CLR_DOWN);
}

// ── data loading + live watch ──
function reload() { RECORDS = parseAll(); lastSync = Date.now(); }

function startWatch(onChange) {
  let timer = null;
  const debounced = () => { clearTimeout(timer); timer = setTimeout(onChange, 700); };
  try {
    const chokidar = require('chokidar');               // reuse if installed
    chokidar.watch(projectsDir(), { ignoreInitial: true, depth: 2 })
      .on('add', debounced).on('change', debounced);
    return;
  } catch { /* fall back to polling */ }
  setInterval(onChange, 2500);
}

// ── one-shot mode (no TTY / --once): print and exit ──
function once() {
  reload();
  // strip interactive bits
  state.searching = false;
  frame();
  process.stdout.write(SHOW);
}

// ── interactive mode ──
function interactive() {
  reload();
  process.stdout.write('\x1b[2J' + HIDE);
  frame();

  startWatch(() => { reload(); frame(); });
  setInterval(frame, 5000); // keep the LIVE dot honest

  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  const quit = () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write(SHOW + '\n');
    process.exit(0);
  };

  process.stdin.on('keypress', (str, key) => {
    key = key || {};
    if (state.searching) {
      if (key.name === 'return' || key.name === 'enter') { state.searching = false; }
      else if (key.name === 'escape') { state.searching = false; state.search = ''; }
      else if (key.name === 'backspace') { state.search = state.search.slice(0, -1); }
      else if (str && str.length === 1 && str >= ' ' && !key.ctrl) { state.search += str; }
      frame();
      return;
    }
    if (key.ctrl && key.name === 'c') return quit();
    switch (key.name || str) {
      case 'q': return quit();
      case 'r': state.range = RANGES[(RANGES.indexOf(state.range) + 1) % RANGES.length]; break;
      case '1': state.range = 'today'; break;
      case '2': state.range = '7d'; break;
      case '3': state.range = '30d'; break;
      case '4': state.range = 'all'; break;
      case 'g': state.groupBy = state.groupBy === 'project' ? 'session' : 'project'; break;
      case 'm': state.model = MODELS[(MODELS.indexOf(state.model) + 1) % MODELS.length]; break;
      case 'c': state.showCost = !state.showCost; break;
      case '/': state.searching = true; state.search = ''; break;
      default: return;
    }
    frame();
  });

  process.on('SIGINT', quit);
  process.stdout.on('resize', frame);
}

// ── arg parsing (one-shot only) ──
function applyArgs() {
  const a = process.argv.slice(2);
  const get = (name) => {
    const i = a.findIndex((x) => x === name || x.startsWith(name + '='));
    if (i < 0) return undefined;
    const v = a[i].includes('=') ? a[i].split('=').slice(1).join('=') : a[i + 1];
    return v;
  };
  const r = get('--range'); if (RANGES.includes(r)) state.range = r;
  const g = get('--group'); if (g === 'project' || g === 'session') state.groupBy = g;
  const m = get('--model'); if (MODELS.includes(m)) state.model = m;
  const w = parseInt(get('--width'), 10); if (w > 40) forcedWidth = Math.min(w, 200);
  if (a.includes('--no-cost')) state.showCost = false;
}

// ── entry ──
const oneShot = process.argv.includes('--once') || !process.stdout.isTTY;
if (oneShot) { applyArgs(); expandAll = true; once(); }
else interactive();
