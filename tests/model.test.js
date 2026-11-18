import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarFile, examples, events, nextPayment, parseAmount, parseDate, reminderSlots, totals, ukMorning,
  validateBackup
} from '../dist/model.js';

const record = {
  id: '50e4d265-16c6-4e6d-b702-6f09c7bdb50f', title: 'Sample policy', provider: 'Example',
  category: 'insurance', amount: 12000, frequency: 'annual', payment: '2027-04-02',
  renewal: '2027-04-02', reference: 'LOCAL-REFERENCE', contact: '', notes: '',
  lead: 7, anchorDay: 2, archived: false
};

test('annualizes each supported cadence using integer pence and rounds the combined monthly average', () => {
  const records = [
    { amount: 100, frequency: 'weekly' },
    { amount: 100, frequency: 'monthly' },
    { amount: 1200, frequency: 'quarterly' },
    { amount: 12000, frequency: 'annual' },
    { amount: 99900, frequency: 'annual', archived: true }
  ];
  assert.deepEqual(totals(records), { annual: 23200, monthly: 1933 });
  assert.deepEqual(totals([record]), { annual: 12000, monthly: 1000 });
  assert.deepEqual(totals(examples('2026-11-18')), { annual: 270956, monthly: 22580 });
});

test('accepts UK dates and GBP while rejecting impossible dates and sub-penny amounts', () => {
  assert.equal(parseDate('29022028'), '2028-02-29');
  assert.equal(parseDate('18/11/2026'), '2026-11-18');
  for (const invalid of ['29/02/2027', '31/04/2027', '2027-03-09', '31/032027']) assert.equal(parseDate(invalid), null);
  assert.equal(parseAmount('120.05'), 12005);
  assert.equal(parseAmount('0,5'), 50);
  assert.equal(parseAmount('0'), 0);
  for (const invalid of ['-1', '1.999', '1e3', '£15', '1000000']) assert.equal(parseAmount(invalid), null);
});

test('advances exactly one period and restores end-of-month anchors after February', () => {
  assert.equal(nextPayment('2027-01-31', 'monthly', 31), '2027-02-28');
  assert.equal(nextPayment('2027-02-28', 'monthly', 31), '2027-03-31');
  assert.equal(nextPayment('2027-11-30', 'quarterly', 30), '2028-02-29');
  assert.equal(nextPayment('2028-02-29', 'annual', 29), '2029-02-28');
  assert.equal(nextPayment('2027-03-26', 'weekly', 26), '2027-04-02');
});

test('keeps UTC offsets aligned to 9am UK time and sends at most one alert per day', () => {
  assert.equal(ukMorning('2027-03-26').toISOString(), '2027-03-26T09:00:00.000Z');
  assert.equal(ukMorning('2027-04-02').toISOString(), '2027-04-02T08:00:00.000Z');
  assert.deepEqual(reminderSlots([record], new Date('2027-03-25Z')), ['2027-03-26T09:00:00.000Z']);
  assert.deepEqual(reminderSlots([record], new Date('2027-03-26T09:00:01Z')), ['2028-03-26T08:00:00.000Z']);
  assert.deepEqual(reminderSlots([{ ...record, archived: true }, { ...record, lead: -1 }], new Date('2027-03-25Z')), []);
  assert.equal(events([record]).length, 2);
});

test('exports a private one-time calendar event with the DST-correct alarm and no record content', () => {
  const file = calendarFile(record, 'renewal', new Date('2027-03-25Z'));
  assert.match(file, /DTSTART:20270402T080000Z\r\n/);
  assert.match(file, /TRIGGER;VALUE=DATE-TIME:20270326T090000Z\r\n/);
  assert.doesNotMatch(file, /LOCAL-REFERENCE|Sample policy|Example|12000/);
  assert.doesNotMatch(calendarFile(record, 'renewal', new Date('2027-03-29Z')), /VALARM/);
});

test('validates and sanitizes a full backup before import', () => {
  const backup = { app: 'billnest', version: 1, records: [{ ...record, token: 'ignore' }] };
  assert.deepEqual(validateBackup(backup), [{ ...record, revision: 1 }]);
  for (const invalid of [{ ...record, category: 'constructor' }, { ...record, amount: -1 },
    { ...record, lead: 2 }, { ...record, payment: '2027-02-29' }]) {
    assert.throws(() => validateBackup({ ...backup, records: [invalid] }), /invalid/);
  }
  assert.throws(() => validateBackup({ ...backup, records: [record, record] }), /invalid/);
});

test('exports recurring monthly alarms, including the last day of short months', () => {
  const monthly = { ...record, payment: '2027-01-31', frequency: 'monthly', anchorDay: 31, lead: 3 };
  const file = calendarFile(monthly, 'payment', new Date('2027-02-23T12:00:00Z'), true);
  assert.match(file, /DTSTART;TZID=Europe\/London:20270228T090000/);
  assert.match(file, /RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1/);
  assert.match(file, /TRIGGER:-P3D/);
  assert.deepEqual(reminderSlots([monthly], new Date('2027-02-23T12:00:00Z')).slice(0, 2),
    ['2027-02-25T09:00:00.000Z', '2027-03-28T08:00:00.000Z']);
});
