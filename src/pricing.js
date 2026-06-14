// Per-model pricing for Claude Code usage. USD per 1,000,000 tokens.
// ── EDIT THESE if rates change. Cache multipliers below are Anthropic standard. ──
const PRICES = {
  'claude-opus-4-8':   { input: 15,  output: 75 },
  'claude-sonnet-4-6': { input: 3,   output: 15 },
  'claude-haiku-4-5':  { input: 1,   output: 5  },
  'claude-fable-5':    { input: 10,  output: 50 },
};
// Fallback for any model id we don't recognise.
const DEFAULT_PRICE = { input: 3, output: 15 };

// Cache multipliers, applied to the model's INPUT rate.
const CACHE_READ_MULT   = 0.1;   // reading from cache is cheap
const CACHE_WRITE_5M_MULT = 1.25; // 5-minute ephemeral cache write
const CACHE_WRITE_1H_MULT = 2.0;  // 1-hour ephemeral cache write

// Normalise a model id ("claude-opus-4-8", "us.anthropic.claude-opus-4-8", …)
function priceFor(model) {
  if (!model) return DEFAULT_PRICE;
  if (PRICES[model]) return PRICES[model];
  const hit = Object.keys(PRICES).find((k) => model.includes(k));
  return hit ? PRICES[hit] : DEFAULT_PRICE;
}

// usage = the raw `message.usage` object from a log line.
function costOf(model, usage) {
  if (!usage) return 0;
  const p = priceFor(model);
  const M = 1e6;
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;

  // Split cache writes into 5m / 1h when the breakdown is present.
  const cc = usage.cache_creation || {};
  let write5m = cc.ephemeral_5m_input_tokens || 0;
  let write1h = cc.ephemeral_1h_input_tokens || 0;
  if (!write5m && !write1h) {
    write5m = usage.cache_creation_input_tokens || 0; // fall back: treat all as 5m
  }

  const cost =
    (input * p.input +
      output * p.output +
      cacheRead * p.input * CACHE_READ_MULT +
      write5m * p.input * CACHE_WRITE_5M_MULT +
      write1h * p.input * CACHE_WRITE_1H_MULT) /
    M;
  return cost;
}

module.exports = { PRICES, priceFor, costOf };
