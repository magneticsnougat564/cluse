// Pure log reader: JSONL -> deduped usage records. No Electron deps.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { costOf } = require('./pricing');

function projectsDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

// "C--Users-me-code-myapp" -> "myapp" (best-effort, used only as a fallback).
function decodeFolder(name) {
  const parts = name.replace(/^C--/, '').split('-');
  return parts[parts.length - 1] || name;
}

// Read every *.jsonl under `dir`, return deduped records (one per billed message).
function parseAll(dir = projectsDir()) {
  const records = [];
  const seen = new Set();
  let folders = [];
  try {
    folders = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return records; // projects dir missing -> empty
  }

  for (const ent of folders) {
    if (!ent.isDirectory()) continue;
    const folder = path.join(dir, ent.name);
    let files = [];
    try {
      files = fs.readdirSync(folder).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      let text;
      try {
        text = fs.readFileSync(path.join(folder, file), 'utf8');
      } catch {
        continue;
      }
      const sessionFromFile = file.replace(/\.jsonl$/, '');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let o;
        try {
          o = JSON.parse(line);
        } catch {
          continue;
        }
        const u = o.message && o.message.usage;
        if (!u) continue;

        // Dedup by message id (+ request id) — matches billed totals.
        const id = (o.message.id || '') + ':' + (o.requestId || '');
        if (id !== ':' && seen.has(id)) continue;
        if (id !== ':') seen.add(id);

        const input = u.input_tokens || 0;
        const output = u.output_tokens || 0;
        const cacheRead = u.cache_read_input_tokens || 0;
        const cc = u.cache_creation || {};
        const cacheWrite5m = cc.ephemeral_5m_input_tokens || 0;
        const cacheWrite1h = cc.ephemeral_1h_input_tokens || 0;
        const cacheWriteTotal =
          cacheWrite5m + cacheWrite1h || u.cache_creation_input_tokens || 0;

        const project = o.cwd ? path.basename(o.cwd) : decodeFolder(ent.name);

        records.push({
          project,
          session: o.sessionId || sessionFromFile,
          model: o.message.model || 'unknown',
          ts: o.timestamp ? Date.parse(o.timestamp) : 0,
          input,
          output,
          cacheWrite5m,
          cacheWrite1h,
          cacheRead,
          totalTokens: input + output + cacheWriteTotal + cacheRead,
          cost: costOf(o.message.model, u),
        });
      }
    }
  }
  return records;
}

// Group + filter records. opts: { since, until (epoch ms), groupBy: 'project'|'session' }
function aggregate(records, opts = {}) {
  const { since = 0, until = Infinity, groupBy = 'project' } = opts;
  const groups = new Map();
  const totals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, totalTokens: 0, cost: 0 };

  for (const r of records) {
    if (r.ts < since || r.ts > until) continue;
    const key = r[groupBy] || 'unknown';
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        input: 0, output: 0, cacheWrite: 0, cacheRead: 0,
        totalTokens: 0, cost: 0, lastActivity: 0, models: {},
      };
      groups.set(key, g);
    }
    const cw = r.cacheWrite5m + r.cacheWrite1h;
    g.input += r.input;
    g.output += r.output;
    g.cacheWrite += cw;
    g.cacheRead += r.cacheRead;
    g.totalTokens += r.totalTokens;
    g.cost += r.cost;
    g.lastActivity = Math.max(g.lastActivity, r.ts);
    g.models[r.model] = (g.models[r.model] || 0) + r.totalTokens;

    totals.input += r.input;
    totals.output += r.output;
    totals.cacheWrite += cw;
    totals.cacheRead += r.cacheRead;
    totals.totalTokens += r.totalTokens;
    totals.cost += r.cost;
  }

  const rows = [...groups.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  return { rows, totals };
}

module.exports = { projectsDir, parseAll, aggregate, decodeFolder };
