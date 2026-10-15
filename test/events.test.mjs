import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { buildEvent, queuedCount, sendEvents } from '../scripts/lib/events.mjs';
import { fakeTimatic, useTemporaryHome } from './helpers.mjs';

beforeEach(() => useTemporaryHome());

const event = (overrides = {}) => buildEvent({
  eventTypeId: 'claude_prompt_submitted',
  userId: 1,
  endedAt: new Date('2026-10-15T10:00:00Z'),
  project: {},
  ...overrides,
});

test('leaves out a start that would make the event invalid', () => {
  assert.equal(event({ startedAt: new Date('2026-10-15T11:00:00Z') }).data.attributes.startedAt, undefined);
  assert.equal(event({ startedAt: new Date('2026-10-13T10:00:00Z') }).data.attributes.startedAt, undefined);
  assert.equal(event({ startedAt: new Date('2026-10-15T09:00:00Z') }).data.attributes.startedAt, '2026-10-15T09:00:00.000Z');
});

test('only sends what the project config sets', () => {
  const { attributes } = event({ project: { customerId: 4, budgetId: 9, isInternal: false } }).data;

  assert.equal(attributes.customerId, 4);
  assert.equal(attributes.budgetId, 9);
  assert.equal(attributes.isInternal, false);
  assert.equal('ticketNumber' in attributes, false);
});

test('keeps an event when Timatic cannot be reached and delivers it later', async () => {
  const credentials = { baseUrl: 'http://127.0.0.1:9', token: 't' };

  assert.deepEqual(await sendEvents(credentials, [event()]), { sent: 0, queued: 1, dropped: [] });

  const timatic = await fakeTimatic(() => ({ status: 201, json: {} }));
  const result = await sendEvents({ ...credentials, baseUrl: timatic.baseUrl }, [event()]);
  await timatic.close();

  assert.deepEqual(result, { sent: 2, queued: 0, dropped: [] });
  assert.equal(queuedCount(), 0);
});

test('drops an event Timatic refuses', async () => {
  const timatic = await fakeTimatic(() => ({ status: 422, json: { message: 'The selected data.attributes.source id is invalid.' } }));
  const result = await sendEvents({ baseUrl: timatic.baseUrl, token: 't' }, [event()]);
  await timatic.close();

  assert.equal(result.sent, 0);
  assert.equal(result.queued, 0);
  assert.match(result.dropped[0], /source id is invalid/);
});
