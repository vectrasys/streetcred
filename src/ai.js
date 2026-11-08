// Второе мнение модели для картинок. Маленькие модели плохо сравнивают два
// кадра (на склейке «до | после» почти всегда отвечали «сделано») и склонны
// отвечать «да» на вопрос «есть ли проблема?». Надёжным оказался обратный
// вопрос «здесь чисто?» по увеличенной зоне задания: 8 из 8 на наших кадрах.
// Модель спрашивается дважды: чисто ли «до» (должно быть «нет») и «после»
// (должно быть «да»).

export const AI_MIN_CONFIDENCE = 0.6;

export function presencePrompt(question) {
  return `${question}\nLook carefully at this street camera frame. Reply with exactly one JSON object and nothing else: {"answer": true or false, "confidence": number from 0 to 1}`;
}

export function parsePresence(text) {
  if (!text) return null;
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    const v = JSON.parse(text.slice(s, e + 1));
    if (typeof v.answer !== 'boolean') return null;
    const c = Number(v.confidence);
    return { answer: v.answer, confidence: Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.5 };
  } catch {
    return null;
  }
}

const b64 = (bytes) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
};

/** Локальная Ollama с vision-моделью. По замерам лучшая из маленьких — qwen2.5vl:3b. */
export function ollamaVision({ model, url = 'http://127.0.0.1:11434', fetchImpl = fetch, timeoutMs = 120000 }) {
  return {
    name: `ollama:${model}`,
    async ask(question, png) {
      const res = await fetchImpl(`${url}/api/chat`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0 },
          messages: [{ role: 'user', content: presencePrompt(question), images: [b64(png)] }] }),
      });
      if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
      const d = await res.json();
      return d.message ? d.message.content : '';
    },
  };
}

/** Cloudflare Workers AI. */
export function workersAiVision(ai, { model = '@cf/meta/llama-3.2-11b-vision-instruct' } = {}) {
  if (!ai || typeof ai.run !== 'function') throw new Error('Workers AI binding is missing');
  // llava и llama-3.2-vision принимают prompt + байты; новые мультимодальные — сообщения с data URL.
  const legacy = /llava|llama-3\.2/.test(model);
  const b64 = (png) => { let s = ''; for (let i = 0; i < png.length; i += 0x8000) s += String.fromCharCode(...png.subarray(i, i + 0x8000)); return btoa(s); };
  const input = (question, png) => (legacy
    ? { prompt: presencePrompt(question), image: [...png], max_tokens: 60 }
    : { messages: [{ role: 'user', content: [{ type: 'text', text: presencePrompt(question) }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64(png)}` } }] }], max_tokens: 60, temperature: 0 });
  return {
    name: `workers-ai:${model}`,
    async ask(question, png) {
      // 3040 — у Workers AI временно не хватает мощности: одна повторная попытка.
      let out;
      for (let i = 0; i < 2; i += 1) {
        try { out = await ai.run(model, input(question, png)); break; } catch (err) {
          if (i || !/3040/.test(err.message)) throw err;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      // llava отвечает полем description, llama-vision — response.
      if (typeof out === 'string') return out;
      const r = out && (out.response ?? out.description ?? out.choices?.[0]?.message?.content);
      return typeof r === 'string' ? r : r ? JSON.stringify(r) : '';
    },
  };
}

/** Спрашивает модель про кадры «до» и «после». Ошибки не роняют проверку. */
export async function askModel(provider, question, frames) {
  if (!provider) return { before: null, after: null, error: 'no vision model configured' };
  const one = async (png) => {
    try { return parsePresence(await provider.ask(question, png)); } catch { return null; }
  };
  const before = await one(frames.before);
  const after = await one(frames.after);
  return { before, after, model: provider.name, error: before && after ? null : 'model gave no usable answer' };
}

/**
 * Итог. Деньги уходят, только если пиксели подтвердили изменение, а модель
 * видит проблему «до» и не видит её «после». Иначе — отказ или решение человека.
 */
export function decide(pixels, ai) {
  if (!pixels.ok) return { status: 'rejected', reason: 'Pixel checks failed' };
  if (!ai || !ai.before || !ai.after) return { status: 'review', reason: 'Vision model unavailable — needs a human decision' };
  if (ai.before.answer) return { status: 'review', reason: 'AI sees no problem in the BEFORE frame' };
  if (!ai.after.answer) return { status: 'review', reason: 'AI does not see the area clean in the AFTER frame' };
  const conf = Math.min(ai.before.confidence, ai.after.confidence);
  if (conf < AI_MIN_CONFIDENCE) return { status: 'review', reason: `AI is unsure (${Math.round(conf * 100)}%)` };
  return { status: 'approved', reason: `AI: problem visible before, gone after (${Math.round(conf * 100)}%)`, confidence: conf };
}
