export const categories = {
  utilities: { name: 'Utilities', icon: 'bolt' },
  insurance: { name: 'Insurance', icon: 'shield' },
  subscriptions: { name: 'Subscriptions', icon: 'play' },
  home: { name: 'Home', icon: 'home' },
  phone: { name: 'Phone & internet', icon: 'wifi' },
  transport: { name: 'Transport', icon: 'car' },
  other: { name: 'Other', icon: 'folder' }
};

export const frequencies = {
  weekly: { label: 'Weekly', short: 'week', perYear: 52 },
  monthly: { label: 'Monthly', short: 'month', perYear: 12 },
  quarterly: { label: 'Quarterly', short: 'quarter', perYear: 4 },
  annual: { label: 'Annually', short: 'year', perYear: 1 }
};

export const leadOptions = new Map([
  [-1, 'Off'], [0, 'On the day'], [1, '1 day before'], [3, '3 days before'],
  [7, '1 week before'], [14, '2 weeks before'], [30, '30 days before']
]);

export const limits = { title: 80, provider: 100, reference: 100, contact: 160, notes: 1000, records: 500 };
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const uk = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23'
});
const monthAndDay = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short', day: 'numeric' });
export const money = pence => gbp.format(pence / 100);

const dayMs = 86400000;
const iso = date => date.toISOString().slice(0, 10);
const asDate = value => new Date(value + 'T00:00:00Z');

export function today(now = new Date()) {
  const parts = Object.fromEntries(uk.formatToParts(now).map(part => [part.type, part.value]));
  return [parts.year, parts.month, parts.day].join('-');
}

export function addDays(date, days) {
  return iso(new Date(asDate(date).getTime() + days * dayMs));
}

export function daysBetween(from, to) {
  return (asDate(to) - asDate(from)) / dayMs;
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^(?:19|20|21)\d\d-\d\d-\d\d$/.test(value)) return false;
  const date = asDate(value);
  return Number.isFinite(date.getTime()) && iso(date) === value;
}

export function parseDate(value) {
  const parts = /^(\d{2})\/?(\d{2})\/?(\d{4})$/.exec(value.trim());
  if (!parts || !/^(?:\d{8}|\d{2}\/\d{2}\/\d{4})$/.test(value.trim())) return null;
  const date = [parts[3], parts[2], parts[1]].join('-');
  return validDate(date) ? date : null;
}

export const formatDate = value => value ? value.split('-').reverse().join('/') : '';
export const shortDate = value => monthAndDay.format(asDate(value));

export function parseAmount(value) {
  const decimal = value.trim();
  if (!/^\d{1,6}(?:[.,]\d{1,2})?$/.test(decimal)) return null;
  const [pounds, pence = ''] = decimal.replace(',', '.').split('.');
  return Number(pounds) * 100 + Number(pence.padEnd(2, '0'));
}

export function totals(records) {
  const annual = records.reduce((sum, record) => record.archived ? sum :
    sum + record.amount * frequencies[record.frequency].perYear, 0);
  return { annual, monthly: Math.round(annual / 12) };
}

const monthSteps = { monthly: 1, quarterly: 3, annual: 12 };

function paymentAt(date, frequency, anchorDay, intervals) {
  if (intervals === 0) return date;
  if (frequency === 'weekly') return addDays(date, intervals * 7);
  const previous = asDate(date);
  const target = new Date(Date.UTC(previous.getUTCFullYear(),
    previous.getUTCMonth() + monthSteps[frequency] * intervals, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, lastDay));
  return iso(target);
}

export const nextPayment = (date, frequency, anchorDay) => paymentAt(date, frequency, anchorDay, 1);

function* occurrences(date, frequency, anchor, first, last) {
  if (!frequency) {
    if (date >= first && date <= last) yield date;
    return;
  }
  const monthDistance = (Number(first.slice(0, 4)) - Number(date.slice(0, 4))) * 12 +
    Number(first.slice(5, 7)) - Number(date.slice(5, 7));
  const estimate = frequency === 'weekly' ? daysBetween(date, first) / 7 : monthDistance / monthSteps[frequency];
  let interval = Math.max(0, Math.floor(estimate));
  for (let due = paymentAt(date, frequency, anchor, interval); due <= last;
    due = paymentAt(date, frequency, anchor, ++interval)) {
    if (due >= first) yield due;
  }
}

export function events(records) {
  return records.filter(record => !record.archived).flatMap(record => [
    { kind: 'payment', date: record.payment, record }, { kind: 'renewal', date: record.renewal, record }
  ].filter(event => event.date)).sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

export function ukMorning(date) {
  const utc = new Date(date + 'T09:00:00Z');
  const hour = Number(uk.formatToParts(utc).find(part => part.type === 'hour').value);
  return new Date(utc.getTime() - (hour - 9) * 3600000);
}

export function reminderSlots(records, now = new Date()) {
  const slots = new Set();
  const base = today(now);
  for (const { date, kind, record } of events(records)) {
    if (record.lead < 0) continue;
    const first = addDays(base, record.lead);
    const last = addDays(first, 366);
    const frequency = kind === 'payment' ? record.frequency : '';
    for (const due of occurrences(date, frequency, record.anchorDay, first, last)) {
      const alert = ukMorning(addDays(due, -record.lead));
      if (alert > now && alert - now <= 366 * dayMs) slots.add(alert.toISOString());
    }
  }
  return [...slots].sort();
}

function icalDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function calendarPlan(record, kind, repeat, now = new Date()) {
  const base = record[kind];
  const frequency = repeat ? kind === 'payment' ? record.frequency : 'annual' : '';
  const anchor = kind === 'payment' ? record.anchorDay : Number(base.slice(-2));
  const todayUK = today(now);
  const lead = Math.max(0, record.lead);
  let earliest = addDays(todayUK, lead);
  if (ukMorning(todayUK) <= now && record.lead >= 0) earliest = addDays(earliest, 1);
  const date = frequency
    ? occurrences(base, frequency, anchor, earliest, addDays(earliest > base ? earliest : base, 366)).next().value ?? base
    : base;
  const alert = ukMorning(addDays(date, -lead));
  return { date, alert: record.lead >= 0 && alert > now ? alert : null, frequency, anchor };
}

function recurrence(frequency, date, anchor) {
  if (frequency === 'weekly') return 'FREQ=WEEKLY';
  const monthDays = anchor <= 28
    ? 'BYMONTHDAY=' + anchor
    : 'BYMONTHDAY=' + Array.from({ length: anchor - 27 }, (_, index) => index + 28).join(',') + ';BYSETPOS=-1';
  if (frequency === 'annual') return 'FREQ=YEARLY;BYMONTH=' + Number(date.slice(5, 7)) + ';' + monthDays;
  return 'FREQ=MONTHLY;' + (frequency === 'quarterly' ? 'INTERVAL=3;' : '') + monthDays;
}

const londonTimeZone = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/London',
  'BEGIN:STANDARD', 'DTSTART:19961027T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0000', 'TZNAME:GMT', 'END:STANDARD',
  'BEGIN:DAYLIGHT', 'DTSTART:19960331T010000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'TZOFFSETFROM:+0000', 'TZOFFSETTO:+0100', 'TZNAME:BST', 'END:DAYLIGHT', 'END:VTIMEZONE'
];

export function calendarFile(record, kind, now = new Date(), repeat = false) {
  const eventTitle = kind === 'payment' ? 'Bill payment due' : 'Policy or plan renewal';
  const { date, alert, frequency, anchor } = calendarPlan(record, kind, repeat, now);
  const start = ukMorning(date);
  const duration = frequency
    ? ['DTSTART;TZID=Europe/London:' + date.replace(/-/g, '') + 'T090000',
      'DURATION:PT15M', 'RRULE:' + recurrence(frequency, date, anchor)]
    : ['DTSTART:' + icalDate(start), 'DTEND:' + icalDate(new Date(start.getTime() + 900000))];
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ollys Outgoings//Bill reminders//EN',
    'CALSCALE:GREGORIAN', ...(frequency ? londonTimeZone : []), 'BEGIN:VEVENT',
    'UID:' + record.id + '-' + kind + (frequency ? '-repeat' : '-' + date) + '@outgoings',
    'DTSTAMP:' + icalDate(now), ...duration, 'SUMMARY:' + eventTitle,
    'CLASS:PRIVATE', 'TRANSP:TRANSPARENT'
  ];
  if (alert) {
    const trigger = frequency
      ? 'TRIGGER:' + (record.lead === 0 ? 'PT0S' : '-P' + record.lead + 'D')
      : 'TRIGGER;VALUE=DATE-TIME:' + icalDate(alert);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + eventTitle, trigger, 'END:VALARM');
  }
  return [...lines, 'END:VEVENT', ''].join('\r\n');
}

export function validateBackup(data) {
  if (!data || data.app !== 'billnest' || data.version !== 1 || !Array.isArray(data.records) ||
      data.records.length > limits.records) throw new Error('Choose a valid Outgoings backup (up to 500 bills).');
  const ids = new Set();
  return data.records.map(raw => {
    if (!raw || typeof raw.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(raw.id) ||
        ids.has(raw.id) || !Object.hasOwn(categories, raw.category) || !Object.hasOwn(frequencies, raw.frequency) ||
        !Number.isInteger(raw.amount) || raw.amount < 0 || raw.amount > 99999999 ||
        !leadOptions.has(raw.lead) || !Number.isInteger(raw.anchorDay) || raw.anchorDay < 1 || raw.anchorDay > 31 ||
        typeof raw.archived !== 'boolean' ||
        !['payment', 'renewal'].every(key => raw[key] === '' || validDate(raw[key])) ||
        !Object.entries(limits).filter(([key]) => key !== 'records').every(([key, size]) =>
          typeof raw[key] === 'string' && raw[key].length <= size) ||
        !raw.title.trim() || !raw.provider.trim()) {
      throw new Error('A bill in the backup is invalid. No bills were imported.');
    }
    ids.add(raw.id);
    const { id, title, provider, category, amount, frequency, payment, renewal, reference, contact,
      notes, lead, anchorDay, archived } = raw;
    return { id, title, provider, category, amount, frequency, payment, renewal, reference, contact,
      notes, lead, anchorDay, archived, revision: 1 };
  });
}

export function examples(base) {
  const rows = [
    ['Electricity & gas', 'Octopus Energy', 'utilities', 11240, 'monthly', 3, null],
    ['Car insurance', 'Admiral', 'insurance', 48500, 'annual', null, 8],
    ['Broadband', 'BT', 'phone', 3200, 'monthly', 13, null],
    ['Spotify Premium', 'Spotify', 'subscriptions', 1199, 'monthly', 17, null],
    ['Water', 'Thames Water', 'utilities', 5400, 'quarterly', 24, null],
    ['TV & streaming', 'Netflix', 'subscriptions', 1099, 'monthly', 35, null]
  ];
  return rows.map(([title, provider, category, amount, frequency, payDays, renewDays], index) => {
    const payment = payDays === null ? '' : addDays(base, payDays);
    return { id: 'sample-' + index, title, provider, category, amount, frequency, payment,
      renewal: renewDays === null ? '' : addDays(base, renewDays), reference: '', contact: '', notes: '',
      lead: 7, anchorDay: payment ? Number(payment.slice(-2)) : 1, archived: false, revision: 0 };
  });
}
