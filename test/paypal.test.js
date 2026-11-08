import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPayouts } from '../src/paypal.js';

function fakeFetch() {
  const calls = [];
  const seen = new Set();
  const impl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
    if (url.endsWith('/payments/payouts') && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      const id = body.sender_batch_header.sender_batch_id;
      if (seen.has(id)) return new Response(JSON.stringify({ name: 'DUPLICATE_REQUEST_ID' }), { status: 400 });
      seen.add(id);
      return new Response(JSON.stringify({ batch_header: { payout_batch_id: `PB-${seen.size}`, batch_status: 'PENDING' } }), { status: 201 });
    }
    return new Response(JSON.stringify({ batch_header: { batch_status: 'SUCCESS' },
      items: [{ payout_item: { sender_item_id: 'c1' }, transaction_status: 'UNCLAIMED' }] }));
  };
  return { impl, calls };
}

test('выплаты идут только в sandbox', async () => {
  const f = fakeFetch();
  const p = createPayouts({ clientId: 'a', clientSecret: 'b', fetchImpl: f.impl });
  await p.send('day-1', [{ receiver: 'x@personal.example.com', claimId: 'c1', amount: '5.00', currency: 'EUR', note: 'n' }]);
  assert.ok(f.calls.every((c) => c.url.startsWith('https://api-m.sandbox.paypal.com/')));
});

test('повтор пакета с тем же ключом не платит дважды', async () => {
  const f = fakeFetch();
  const p = createPayouts({ clientId: 'a', clientSecret: 'b', fetchImpl: f.impl });
  const item = [{ receiver: 'x@personal.example.com', claimId: 'c1', amount: '5.00', currency: 'EUR', note: 'n' }];
  await p.send('day-1', item);
  await assert.rejects(() => p.send('day-1', item), /DUPLICATE_REQUEST_ID/);
});

test('статус пакета разбирается по позициям', async () => {
  const p = createPayouts({ clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch().impl });
  const s = await p.status('PB-1');
  assert.equal(s.status, 'SUCCESS');
  assert.deepEqual(s.items, [{ claimId: 'c1', status: 'UNCLAIMED' }]);
});

test('без ключей — понятная ошибка', () => {
  assert.throws(() => createPayouts({}), /credentials are missing/);
});
