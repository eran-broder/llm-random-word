// Can an LLM pick a random word?
// Asks three Claude models for "a single random word" N times under three
// prompt conditions, then prints the spread (unique words out of N).
//
//   1. plain      — "come up with a single random word"
//   2. structured — same prompt, forced to a bare { single_word } JSON field
//   3. grounded   — per-call GUID, must derive the word from its letters/numbers
//
// Setup:  npm install  &&  cp .env.example .env  (add your ANTHROPIC_API_KEY)
// Run:    node experiment.mjs            # all models, all conditions, 30 calls
//         node experiment.mjs 50         # 50 calls each
//
// Requires Node.js 20+ (built-in process.loadEnvFile). Prompt caching is off.
import Anthropic from "@anthropic-ai/sdk";

process.loadEnvFile();
const client = new Anthropic();

const MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"];
const N = Number(process.argv[2] ?? 30);

const SINGLE_WORD_SCHEMA = {
  type: "object",
  properties: { single_word: { type: "string" } },
  required: ["single_word"],
  additionalProperties: false,
};

const GROUNDED_SCHEMA = {
  type: "object",
  properties: {
    contemplate_randomness: { type: "string" },
    single_word: { type: "string" },
  },
  required: ["contemplate_randomness", "single_word"],
  additionalProperties: false,
};

const CONDITIONS = {
  plain: {
    label: "plain text prompt",
    build: () => ({
      max_tokens: 64,
      messages: [{ role: "user", content: "come up with a single random word" }],
    }),
  },
  structured: {
    label: "structured output, single_word only",
    build: () => ({
      max_tokens: 64,
      messages: [{ role: "user", content: "come up with a single random word" }],
      output_config: { format: { type: "json_schema", schema: SINGLE_WORD_SCHEMA } },
    }),
  },
  grounded: {
    label: "per-call GUID, word must derive from its letters/numbers",
    build: () => {
      const guid = crypto.randomUUID();
      return {
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: `come up with a single random word. the word needs to reflect this value : ${guid}. you MUST force yourself to find reason within this value, and the word MUST relate to it. in contemplate_randomness, come up with an imaginative relation to the content itself — its letters, its look, its numbers. contemplate_randomness MUST BE SHORT — one sentence, max 25 words.`,
        }],
        output_config: { format: { type: "json_schema", schema: GROUNDED_SCHEMA } },
      };
    },
  },
};

// Pull a clean word out of any response shape (plain text or structured JSON).
function extractWord(res) {
  const text = res.content.find((b) => b.type === "text")?.text ?? "";
  let raw = text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.single_word === "string") raw = parsed.single_word;
  } catch { /* plain text response */ }
  const m = raw.toLowerCase().match(/[a-z]+/g) ?? [];
  return m.length ? m[0] : "(empty)";
}

async function oneCall(model, condition, attempt = 0) {
  try {
    const res = await client.messages.create({ model, ...CONDITIONS[condition].build() });
    return extractWord(res);
  } catch (err) {
    if (attempt < 3) return oneCall(model, condition, attempt + 1); // e.g. truncated JSON
    return "(error)";
  }
}

function printSpread(words) {
  const counts = {};
  for (const w of words) counts[w] = (counts[w] ?? 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  console.log(`    ${sorted.length}/${words.length} unique`);
  for (const [word, count] of sorted.slice(0, 6)) {
    console.log(`      ${word.padEnd(16)} ${"█".repeat(count)} ${count}`);
  }
  if (sorted.length > 6) console.log(`      … +${sorted.length - 6} more`);
}

for (const [key, cond] of Object.entries(CONDITIONS)) {
  console.log(`\n=== ${key} — ${cond.label} ===`);
  for (const model of MODELS) {
    process.stdout.write(`  ${model} ...\n`);
    const words = await Promise.all(Array.from({ length: N }, () => oneCall(model, key)));
    printSpread(words);
  }
}
