import { phonemize } from "phonemizer";

// Stay well below the model's 512-token context to bound activation memory.
const MAX_TOKENS = 160;

let vocab;
let chunks = [];
let voice;
let index = 0;

function splitText(text) {
  const result = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/u)) {
    let remaining = sentence.trim();
    while (remaining) {
      // A short first phrase gets speech started without waiting for a long sentence.
      const limit = result.length === 0 ? 80 : 160;
      if (remaining.length <= limit) { result.push(remaining); break; }
      const space = remaining.lastIndexOf(" ", limit);
      const end = space > 0 ? space : limit;
      result.push(remaining.slice(0, end));
      remaining = remaining.slice(end).trim();
    }
  }
  return result;
}

async function encode(text) {
  // Always select English explicitly; the selected voice controls the accent.
  const language = voice.startsWith("b") ? "en-gb" : "en-us";
  const parts = text.replace(/[‘’]/gu, "'").split(/([;:,.!?—…()“”"]+)/u);
  const phones = [];
  for (const part of parts) {
    if (!part.trim()) { phones.push(part); continue; }
    if (/^[;:,.!?—…()“”"]+$/u.test(part)) phones.push(part);
    else phones.push((await phonemize(part, language)).join(" "));
  }
  // Match Kokoro's English IPA conventions used by its reference phonemizer.
  const phonemes = phones.join("").replace(/ʲ/gu, "j").replace(/r/gu, "ɹ")
    .replace(/x/gu, "k").replace(/ɬ/gu, "l").trim();
  const ids = Array.from(phonemes).filter((phone) => Object.hasOwn(vocab, phone))
    .map((phone) => vocab[phone]);
  // Separators and punctuation-only fragments contain no speech to synthesize.
  if (!ids.some((id) => id >= 24)) return [];
  return [0, ...ids, 0];
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") {
      const response = await fetch(`${data.base}/tokenizer.json`);
      if (!response.ok) throw new Error("Kokoro's tokenizer is unavailable. Retry its download in settings.");
      vocab = (await response.json()).model.vocab;
      self.postMessage({ type: "ready" });
    } else if (data.type === "start") {
      chunks = splitText(data.text);
      voice = data.voice;
      index = 0;
      self.postMessage({ type: "started" });
    } else if (data.type === "next") {
      while (index < chunks.length) {
        const text = chunks[index];
        const tokens = await encode(text);
        if (tokens.length > MAX_TOKENS) {
          // Expanded numbers and unusual words can exceed the memory budget despite a short input.
          const middle = Math.floor(text.length / 2);
          const space = text.lastIndexOf(" ", middle);
          const end = space > 0 ? space : middle;
          if (end === 0) throw new Error("This phrase exceeds Kokoro's phoneme limit.");
          chunks.splice(index, 1, text.slice(0, end).trim(), text.slice(end).trim());
          continue;
        }
        index += 1;
        if (tokens.length <= 2) continue;
        self.postMessage({ type: "tokens", tokens });
        return;
      }
      self.postMessage({ type: "finished" });
    }
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || String(error) });
  }
};
