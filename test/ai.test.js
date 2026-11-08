import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePresence, decide, askModel, presencePrompt, workersAiVision } from '../src/ai.js';

const ok = { ok: true };
const yes = (c = 0.9) => ({ answer: true, confidence: c });
const no = (c = 0.9) => ({ answer: false, confidence: c });

test('разбор ответа: JSON внутри текста, границы уверенности', () => {
  assert.deepEqual(parsePresence('Sure: {"answer": true, "confidence": 1.4}'), { answer: true, confidence: 1 });
  assert.equal(parsePresence('{"answer": "yes"}'), null);
  assert.equal(parsePresence('no json'), null);
});

// Вопрос к модели — «здесь чисто?»: «до» должно быть «нет», «после» — «да».
test('деньги — только если пиксели «за», «до» грязно, «после» чисто', () => {
  assert.equal(decide(ok, { before: no(), after: yes() }).status, 'approved');
  assert.equal(decide({ ok: false }, { before: no(), after: yes() }).status, 'rejected');
});

test('сомнения модели уходят человеку, а не в выплату', () => {
  assert.equal(decide(ok, { before: yes(), after: yes() }).status, 'review'); // «до» уже чисто
  assert.equal(decide(ok, { before: no(), after: no() }).status, 'review');   // «после» не чисто
  assert.equal(decide(ok, { before: no(0.5), after: yes() }).status, 'review');
  assert.equal(decide(ok, { before: null, after: null }).status, 'review');
});

test('модель недоступна или болтает — проверка не падает', async () => {
  const broken = { name: 'x', async ask() { throw new Error('refused'); } };
  assert.equal((await askModel(broken, 'q', { before: new Uint8Array(1), after: new Uint8Array(1) })).before, null);
  const chatty = { name: 'y', async ask() { return 'I think so'; } };
  assert.match((await askModel(chatty, 'q', { before: new Uint8Array(1), after: new Uint8Array(1) })).error, /no usable answer/);
  assert.match((await askModel(null, 'q', {})).error, /no vision model/);
});

test('вопрос к модели требует JSON да/нет', () => {
  assert.match(presencePrompt('Is there litter?'), /"answer": true or false/);
});

test('Workers AI: без привязки — ошибка, ответ из response', async () => {
  assert.throws(() => workersAiVision(undefined), /binding is missing/);
  const p = workersAiVision({ async run() { return { response: '{"answer": false, "confidence": 0.8}' }; } });
  assert.deepEqual(parsePresence(await p.ask('q', new Uint8Array(2))), { answer: false, confidence: 0.8 });
});

test('Workers AI: llava — prompt+байты и поле description; scout — сообщения; повтор при 3040', async () => {
  const { workersAiVision } = await import('../src/ai.js');
  const png = new Uint8Array([137, 80, 78, 71]);
  const calls = [];
  let busy = 1;
  const ai = { async run(model, input) {
    calls.push({ model, input });
    if (model.includes('scout') && busy-- > 0) throw new Error('3040: Capacity temporarily exceeded');
    return model.includes('llava') ? { description: '{"answer":true,"confidence":0.9}' } : { response: '{"answer":false,"confidence":0.8}' };
  } };
  assert.match(await workersAiVision(ai, { model: '@cf/llava-hf/llava-1.5-7b-hf' }).ask('Is it clean?', png), /true/);
  assert.ok(Array.isArray(calls[0].input.image) && calls[0].input.prompt);
  assert.match(await workersAiVision(ai, { model: '@cf/meta/llama-4-scout-17b-16e-instruct' }).ask('Is it clean?', png), /false/);
  const last = calls.at(-1).input.messages[0].content;
  assert.equal(calls.filter((c) => c.model.includes('scout')).length, 2, 'одна повторная попытка');
  assert.ok(last[1].image_url.url.startsWith('data:image/png;base64,iVBORw'));
});
