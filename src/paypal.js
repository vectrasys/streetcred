// PayPal только для sandbox: адрес зашит, настоящее движение денег невозможно.
// Payouts — выплаты жителям (на PayPal или Venmo), Orders — приём денег от
// соседей и местных бизнесов, которые добавляют к награде за задание.
const SANDBOX = 'https://api-m.sandbox.paypal.com';

function sandboxClient({ clientId, clientSecret, fetchImpl = fetch }) {
  if (!clientId || !clientSecret) throw new Error('PayPal sandbox credentials are missing');
  let token = null;
  let until = 0;
  async function auth() {
    if (token && Date.now() < until) return token;
    const res = await fetchImpl(`${SANDBOX}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error_description || `oauth ${res.status}`);
    token = body.access_token;
    until = Date.now() + (body.expires_in - 60) * 1000;
    return token;
  }
  async function call(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetchImpl(`${SANDBOX}${path}`, {
      method, headers: { Authorization: `Bearer ${await auth()}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.details?.[0]?.issue || data.name || data.message || `paypal ${res.status}`);
    return data;
  }
  return { call };
}

/** Элемент пакета Payouts: PayPal по email или Venmo по номеру телефона (только США). */
export function payoutItem(it) {
  const venmo = it.wallet === 'venmo';
  return {
    recipient_type: venmo ? 'PHONE' : 'EMAIL', receiver: it.receiver, sender_item_id: it.claimId,
    amount: { value: it.amount, currency: it.currency }, note: it.note,
    ...(venmo ? { recipient_wallet: 'Venmo' } : {}),
  };
}
export const payoutBody = (batchId, items) => ({
  sender_batch_header: { sender_batch_id: batchId, email_subject: 'StreetCred: Port Calloway thanks you for your good deed' },
  items: items.map(payoutItem),
});

export function createPayouts(opts) {
  const { call } = sandboxClient(opts);
  return {
    /**
     * Пакет выплат. batchId — ключ идемпотентности: PayPal отклонит пакет
     * с уже использованным sender_batch_id, и повтор не заплатит дважды.
     */
    async send(batchId, items) {
      const body = await call('/v1/payments/payouts', { method: 'POST', body: payoutBody(batchId, items) });
      return { payoutBatchId: body.batch_header.payout_batch_id, status: body.batch_header.batch_status };
    },
    async status(payoutBatchId) {
      const body = await call(`/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
      return {
        status: body.batch_header.batch_status,
        items: (body.items || []).map((i) => ({ claimId: i.payout_item.sender_item_id, status: i.transaction_status })),
      };
    },
  };
}

export function createOrders(opts) {
  const { call } = sandboxClient(opts);
  return {
    /** Заказ на добавку к награде; сумму задаёт сервер, а не браузер. */
    async create({ taskId, amount, description, requestId }) {
      const body = await call('/v2/checkout/orders', {
        method: 'POST', headers: { 'PayPal-Request-Id': requestId },
        body: { intent: 'CAPTURE', purchase_units: [{ reference_id: taskId, custom_id: taskId, description,
          amount: { currency_code: 'USD', value: amount } }],
        payment_source: { paypal: { experience_context: { brand_name: 'StreetCred · Port Calloway', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' } } } },
      });
      return { id: body.id, status: body.status };
    },
    async capture(orderId) {
      const body = await call(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', body: {} });
      const unit = body.purchase_units?.[0] || {};
      const cap = unit.payments?.captures?.[0] || {};
      return { status: body.status, taskId: unit.custom_id || unit.reference_id, amount: cap.amount?.value, captureId: cap.id,
        payer: [body.payer?.name?.given_name, body.payer?.name?.surname?.[0]].filter(Boolean).join(' ') || 'A neighbor',
        source: Object.keys(body.payment_source || { paypal: 1 })[0] };
    },
  };
}
