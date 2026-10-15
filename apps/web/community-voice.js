// community-voice.js — backend for Markov mimicry + word cloud from discord_messages
// Pure Node; no ML dependencies. Fast enough for on-the-fly generation.
const fs = require("fs");
const path = require("path");

const STOP = new Set([
  "the","be","to","of","and","a","in","that","have","i","it","for","not","on","with","he","as","you","do","at","this","but","his","by","from","they","we","say","her","she","or","an","will","my","one","all","would","there","their","what","so","up","out","if","about","who","get","which","go","me","when","make","can","like","time","no","just","him","know","take","people","into","year","your","good","some","could","them","see","other","than","then","now","look","only","come","its","over","think","also","back","after","use","two","how","our","work","first","well","way","even","new","want","because","any","these","give","day","most","us","is","was","are","were","been","has","had","did","does","doing","done","am","im","its","its","its","ive","id","youre","youve","youll","youd","theyre","theyve","theyll","theyd","shes","hes","its","thats","theres","whats","wheres","whens","whys","hows","isnt","arent","wasnt","werent","hasnt","havent","hadnt","dont","doesnt","didnt","wont","wouldnt","shouldnt","couldnt","cant","cannot","mightnt","mustnt","shant","neednt","darent","oughtnt","lets","thats","heres","theres","everywhere","somewhere","anywhere","nowhere","someone","everyone","anyone","noone","somebody","everybody","anybody","nobody","something","everything","anything","nothing","this","that","these","those","i","me","my","myself","we","our","ours","ourselves","you","your","yours","yourself","yourselves","he","him","his","himself","she","her","hers","herself","it","its","itself","they","them","their","theirs","themselves","what","which","who","whom","whose","this","that","these","those","am","is","are","was","were","be","been","being","have","has","had","having","do","does","did","doing","a","an","the","and","but","if","or","because","as","until","while","of","at","by","for","with","about","against","between","into","through","during","before","after","above","below","to","from","up","down","in","out","on","off","over","under","again","further","then","once","here","there","when","where","why","how","all","each","few","more","most","other","some","such","no","nor","not","only","own","same","so","than","too","very","s","t","can","will","just","don","should","now","d","ll","m","o","re","ve","y","ma","u","r","n","href","https","http","com","www","discord","channels","channel","message","id","png","jpg","gif","webp","amp",
  // Discord-specific noise
  "@everyone","@here","<@","<#","<:",":",
]);

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")         // remove Discord mentions/emojis
    .replace(/https?:\/\/\S+/g, " ") // remove URLs
    .replace(/[^a-z0-9'\-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function sentenceize(text) {
  return String(text)
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .split(/(?<=[.!?])\s+/) // split after sentence terminator
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && s.length <= 220);
}

function normalize(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9\-]+/g, " ").trim();
}

function normalizeAuthor(author) {
  return String(author).trim();
}

// Build an order-2 Markov chain for a single author.
// Uses all messages in the MongoDB discord_messages collection for that author.
async function buildAuthorModel(db, author) {
  const rows = await db
    .collection("discord_messages")
    .find({ author }, { projection: { content: 1, _id: 0 } })
    .toArray();
  const sentences = rows.flatMap((r) => sentenceize(r.content || ""));
  const starts = [];
  const chain = new Map(); // key "w1 w2" -> {next: Map(word->count), total}
  let totalTokens = 0;
  for (const sent of sentences) {
    const words = tokenize(sent);
    if (words.length < 3) continue;
    starts.push(words[0] + " " + words[1]);
    for (let i = 0; i < words.length - 2; i++) {
      const k = words[i] + " " + words[i + 1];
      const next = words[i + 2];
      if (!chain.has(k)) chain.set(k, { next: new Map(), total: 0 });
      const node = chain.get(k);
      node.next.set(next, (node.next.get(next) || 0) + 1);
      node.total++;
      totalTokens++;
    }
  }
  return { sentences, starts, chain, totalTokens, messages: rows.length };
}

function pickStart(chain, starts, seed) {
  if (seed) {
    const needle = seed.toLowerCase();
    const found = starts.find((s) => s.includes(needle));
    if (found) return found.split(" ");
  }
  if (starts.length) {
    const s = starts[Math.floor(Math.random() * starts.length)];
    return s.split(" ");
  }
  const firstKey = chain.keys().next().value;
  return firstKey ? firstKey.split(" ") : ["i", "think"];
}

function weightedPick(node) {
  const entries = Array.from(node.next.entries());
  const total = entries.reduce((n, [, c]) => n + c, 0);
  let pick = Math.random() * total;
  for (const [w, c] of entries) {
    pick -= c;
    if (pick <= 0) return w;
  }
  return entries[entries.length - 1]?.[0] || "the";
}

function generateSentence(chain, starts, seed, maxLen = 28) {
  const words = pickStart(chain, starts, seed);
  if (!words.length) return "";
  for (let i = 0; i < maxLen; i++) {
    const key = words[words.length - 2] + " " + words[words.length - 1];
    const node = chain.get(key);
    if (!node || node.next.size === 0) break;
    const next = weightedPick(node);
    words.push(next);
    if (/[.!?]$/.test(next)) break;
  }
  let sentence = words.join(" ").replace(/\s+([,.!?;:])/g, "$1");
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  if (!/[.!?]$/.test(sentence)) sentence += ".";
  return sentence;
}

async function generateMarkov(db, author, seed, n) {
  const model = await buildAuthorModel(db, author);
  if (model.starts.length === 0) return { sentences: [], tokens: model.totalTokens, messages: model.messages };
  const sentences = [];
  for (let i = 0; i < n; i++) sentences.push(generateSentence(model.chain, model.starts, seed));
  return { sentences, tokens: model.totalTokens, messages: model.messages };
}

async function buildWordCloud(db, { channel, author, limit = 60 }) {
  const filter = {};
  if (channel) filter.channelName = channel;
  if (author) filter.author = author;
  const rows = await db.collection("discord_messages").find(filter, { projection: { content: 1, _id: 0 } }).toArray();
  const counts = new Map();
  for (const r of rows) {
    for (const w of tokenize(r.content || "")) counts.set(w, (counts.get(w) || 0) + 1);
  }
  const words = Array.from(counts.entries())
    .filter(([w, c]) => c >= 2 && w.length >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
  return { words, messages: rows.length };
}

module.exports = { generateMarkov, buildWordCloud, tokenize };
