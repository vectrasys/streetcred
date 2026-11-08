import test from 'node:test';
import assert from 'node:assert/strict';
import { payoutState } from '../public/js/common.js';

// «Payout completed» — только для записи sandbox-пакета; образцы и SUCCESS без источника не выдаются за выплату.
test('payoutState: SUCCESS completed только при source sandbox_record', () => {
  assert.equal(payoutState({ status: 'SUCCESS', source: 'seeded_sample' }).label, 'Sample payout (demo data)');
  assert.equal(payoutState({ status: 'SUCCESS', source: 'sandbox_record' }).label, 'Payout completed');
  assert.equal(payoutState({ status: 'SUCCESS' }).label, 'Recorded SUCCESS · source unknown');
});
