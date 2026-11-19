import {
  addDays, calendarFile, calendarPlan, categories, daysBetween, events, examples, formatDate, frequencies, leadOptions,
  limits, money, nextPayment, parseAmount, parseDate, shortDate, today, totals
} from './model.js';
import {
  readState, changeState, saveAttachment, removeAttachment, readAttachment, backupSnapshot, importBackup
} from './storage.js';
import {
  attachmentBytes, attachmentLimits, createBackup, fileLabel, fileSize, prepareAttachment, readBackup
} from './attachments.js';
import { disablePush, enablePush, preparePush, pushConfigured, pushProblem, syncPush, testPush } from './push.js';

const paths = {
  home: '<path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-6h6v6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  receipt: '<path d="M5 3v18l3-2 4 2 4-2 3 2V3l-3 2-4-2-4 2zM9 10h6M9 14h6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 15h2m4 0h2"/>',
  settings: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="17" r="2" fill="currentColor"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 18 6-6-6-6"/>',
  right: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  wallet: '<path d="M20 8H5a2 2 0 0 1 0-4h13v4M3 6v13a1 1 0 0 0 1 1h16v-5m0-7v3"/><path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-12h-8z"/>',
  shield: '<path d="m12 21 3.5-2c3-1.7 4.5-4.4 4.5-8V6l-8-3-8 3v5c0 3.6 1.5 6.3 4.5 8z"/><path d="m9 12 2 2 4-4"/>',
  play: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
  wifi: '<path d="M3 8a14 14 0 0 1 18 0M6 11a9 9 0 0 1 12 0m-9 4a5 5 0 0 1 6 0m-3 4h.01"/>',
  car: '<path d="m5 10 2-5h10l2 5m-15 0h16l1 3v5H3v-5zM6 18v2m12-2v2M7 14h.01M17 14h.01"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m16 16 4 4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8m-8 12h4"/>',
  download: '<path d="M12 3v11m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  archive: '<path d="M4 8v12h16V8M3 4h18v4H3zm6 8h6"/>'
};

const icon = name => '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + paths[name] + '</svg>';
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const button = (label, action, variant = 'subtle', symbol = '', extra = '') =>
  '<button type="button" class="button ' + variant + '" data-action="' + action + '" ' + extra + '>' +
  (symbol ? icon(symbol) : '') + label + '</button>';
const addButton = () => button('Add bill', 'add', 'primary', 'plus');
const categoryIcon = key => '<span class="category-icon cat-' + key + '">' + icon(categories[key].icon) + '</span>';
const $ = selector => document.querySelector(selector);

const main = $('#main');
const dialog = $('#dialog');
const backupInput = $('#backup-input');
const attachmentInput = $('#attachment-input');
const nav = $('#nav');
const tabs = {
  home: { title: 'Overview', mobile: 'Home', icon: 'grid' },
  bills: { title: 'Your bills', mobile: 'Bills', icon: 'receipt' },
  dates: { title: 'Upcoming', mobile: 'Upcoming', icon: 'calendar' },
  settings: { title: 'Settings', mobile: 'Settings', icon: 'settings' }
};
nav.innerHTML = Object.entries(tabs).map(([id, tab]) =>
  '<a class="nav-link" href="#' + id + '">' + icon(tab.icon) + '<span class="nav-desktop">' + tab.title +
  '</span><span class="nav-mobile">' + tab.mobile + '</span></a>').join('');
$('#privacy-icon').innerHTML = icon('lock');
$('#install-top').innerHTML = icon('phone') + 'Install app';

let state;
let storageIssue = false;
let toastTimer;
let installPrompt;
let dialogRecord;
let calendarDraft;
let documentPreview;
let pendingRemoval;
let attachmentRecordId;
let restoreFocus;
let pushQueue = Promise.resolve();
let pushSetupContext;
let pushStatus = '';
let filter = { search: '', category: '', archived: 'active' };
let liveDay = today();
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('billnest-state') : null;
const route = () => Object.hasOwn(tabs, location.hash.slice(1)) ? location.hash.slice(1) : 'home';
const shown = () => state.showExamples ? examples(liveDay) : state.records;
const recordFor = id => shown().find(record => record.id === id);
const balanceTitle = count => count === 1 ? '1 active bill' : count + ' active bills';
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const inWindow = event => event.date <= addDays(liveDay, 30);

function toast(message) {
  $('#toast').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 4700);
}

function welcome(title, text, action = '') {
  return '<header class="welcome"><div><h1>' + title + '</h1><p>' + text + '</p></div>' + action + '</header>';
}

function exampleBanner() {
  return state.showExamples ? '<div class="example-banner"><span>' + icon('info') +
    '<span><strong>Example bills.</strong> <span class="example-long">Add a bill to make this yours.</span></span></span>' +
    button('Start fresh', 'clear-demo', 'quiet compact') + '</div>' : '';
}

function spendPanel(records) {
  const { annual, monthly } = totals(records);
  const total = money(monthly);
  const long = total.length > 8;
  return '<section class="panel spend-card" aria-labelledby="spend-label" data-long="' + long + '">' +
    '<div class="spend-content"><div id="spend-label" class="spend-label">' + icon('wallet') +
    'Average monthly spend</div><div class="spend-amount' + (long ? ' long' : '') + '">' + total +
    '</div><div class="annual"><strong>' + money(annual) +
    '</strong><span class="annual-label">per year</span></div><p class="spend-count">' + balanceTitle(records.filter(item => !item.archived).length) +
    '</p></div><div class="hero-art" aria-hidden="true"><img src="olly.webp" width="174" height="174" alt="">' +
    '<span class="hero-receipt">' + icon('receipt') + '</span></div></section>';
}

function eventRows(list, emptyText) {
  if (!list.length) return '<div class="empty"><strong>No dates to show</strong><p>' + emptyText + '</p></div>';
  return list.map(({ kind, date, record }) => {
    const days = daysBetween(liveDay, date);
    const badge = days < 0 ? 'Overdue' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : 'In ' + days + ' days';
    const [day, month] = shortDate(date).split(' ');
    return '<button class="event-row" type="button" data-action="detail" data-id="' + record.id + '">' +
      '<time class="date-tile" datetime="' + date + '" aria-label="' + formatDate(date) + '"><strong>' +
      day + '</strong><small>' + month + '</small></time><span class="event-text"><span class="event-title">' +
      escape(record.title) + '</span><span class="event-subtitle">' +
      (kind === 'payment' ? 'Payment · ' + money(record.amount) : 'Renewal') +
      '</span></span><span class="event-badge ' + (days < 0 ? 'late' : days <= 7 ? 'soon' : '') + '">' +
      badge + '</span></button>';
  }).join('');
}

function upcomingPanel(records) {
  return '<section class="panel upcoming" aria-labelledby="upcoming-title"><div class="upcoming-header">' +
    '<h2 id="upcoming-title">Upcoming</h2><a class="button quiet compact" href="#dates">See all ' + icon('right') +
    '</a></div><div class="upcoming-list">' + eventRows(events(records).filter(inWindow).slice(0, 3),
      'Payment and renewal dates will show here.') + '</div></section>';
}

function filteredRows() {
  const records = shown();
  const search = filter.search.toLocaleLowerCase('en-GB').trim();
  const matches = records.filter(record => (filter.archived === 'all' || record.archived === (filter.archived === 'archived')) &&
    (!filter.category || record.category === filter.category) &&
    [record.title, record.provider, record.reference, categories[record.category].name].some(value =>
      value.toLocaleLowerCase('en-GB').includes(search)));
  if (!matches.length) {
    const first = !records.length && filter.archived === 'active' && !search && !filter.category;
    return '<div class="empty">' + categoryIcon('other') + '<strong>' +
      (first ? 'Add your first bill' : 'No matching bills') + '</strong><p>' +
      (first ? 'A bill, subscription or policy is a good place to start.' : 'Try a different search or change the filters.') +
      '</p>' + (first ? addButton() : button('Clear filters', 'clear-filter', 'subtle compact')) + '</div>';
  }
  return '<div class="table-heading" aria-hidden="true"><span>Bill / provider</span><span class="table-category">Category</span>' +
    '<span>Amount</span><span class="table-date">Next date</span><span></span></div>' + matches.map(record => {
      const date = [record.payment, record.renewal].filter(Boolean).sort()[0];
      return '<button type="button" class="record-row" data-action="detail" data-id="' + record.id + '">' +
        '<span class="record-main">' + categoryIcon(record.category) + '<span><span class="record-title">' +
        escape(record.title) + (record.archived ? ' · Archived' : '') + '</span><span class="record-provider">' +
        escape(record.provider) + '</span></span></span><span class="category-pill cat-' + record.category + '">' +
        categories[record.category].name + '</span><span class="record-cost">' + money(record.amount) +
        '<small>per ' + frequencies[record.frequency].short + '</small></span><span class="record-date">' +
        (date ? '<time datetime="' + date + '">' + formatDate(date) + '</time>' : '—') +
        '</span>' + icon('arrow').replace('class="icon"', 'class="icon record-arrow"') + '</button>';
    }).join('');
}

const option = (key, label, current) => '<option value="' + key + '"' + (key === current ? ' selected' : '') + '>' + label + '</option>';

function billsPanel(label) {
  return '<section class="panel bills-panel" aria-labelledby="bills-title"><div class="bills-header section-heading">' +
    '<div><h2 id="bills-title">' + label + '</h2></div></div><div class="filters"><div class="search-wrap">' +
    icon('search') + '<input type="search" id="bill-search" maxlength="100" aria-label="Search bills" placeholder="Search bills or providers" autocomplete="off" value="' +
    escape(filter.search) + '"></div><select id="category-filter" aria-label="Filter by category">' +
    option('', 'All categories', filter.category) +
    Object.entries(categories).map(([key, value]) => option(key, value.name, filter.category)).join('') +
    '</select><select id="archive-filter" aria-label="Filter by status">' +
    option('active', 'Active bills', filter.archived) + option('archived', 'Archived bills', filter.archived) +
    option('all', 'All bills', filter.archived) + '</select></div><div id="bill-rows">' + filteredRows() +
    '</div><span id="search-feedback" class="visually-hidden" role="status"></span></section>';
}

function settingsPanel() {
  const pushCopy = pushConfigured
    ? 'Get a generic lock-screen alert at 9am UK time. Set how early it arrives when you edit a bill.'
    : 'Open a bill, choose its lead time and add a reminder to Apple Calendar. Direct app alerts are available after the hosting setup.';
  const pushHelp = pushConfigured ? pushProblem() : '';
  const pushControls = pushConfigured && (state.push
    ? button('Send test alert', 'test-push', 'subtle compact') + button('Set up again', 'push-setup', 'quiet compact') +
      button('Turn off', 'push-disable', 'quiet compact')
    : button('Set up notifications', 'push-setup', 'subtle compact', 'bell'));
  return '<div class="settings-grid">' +
    '<section class="panel settings-card">' + categoryIcon('other') + '<h2>Phone reminders</h2><p>' + pushCopy +
    '</p><p class="status-line" id="push-status">' + escape(pushStatus || (state.push ? 'Notifications enabled on this device.' : pushHelp)) +
    '</p><div class="actions">' + (pushControls || '') + '</div></section>' +
    '<section class="panel settings-card">' + categoryIcon('home') + '<h2>Install on your phone</h2>' +
    '<p>Open Olly’s Outgoings from your Home Screen and use it offline after the first online visit.</p>' +
    button(installed() ? 'View install help' : 'Install app', 'install', 'subtle compact', 'phone') + '</section>' +
    '<section class="panel settings-card">' + categoryIcon('insurance') + '<h2>Back up your bills</h2>' +
    '<p>A backup contains your private bill details and documents in a readable file. Keep it somewhere safe. If you lose this phone or clear its site data, you’ll need it to restore your bills.</p>' +
    '<div class="actions">' + button('Download backup', 'export', 'subtle compact', 'download') +
    button('Import backup', 'import', 'quiet compact') + '</div></section>' +
    '<section class="panel settings-card">' + categoryIcon('utilities') + '<h2>Your data</h2>' +
    '<p>Records are stored in this browser or installed app. Protect access with your device passcode.</p>' +
    '<p>With direct alerts enabled, the service stores this device’s push address and reminder times.</p>' +
    (!state.records.length && !state.showExamples ? button('Show example bills', 'show-demo', 'quiet compact') : '') +
    '</section></div>';
}

function render() {
  const page = route();
  $('#breadcrumb').textContent = tabs[page].title;
  $('#install-top').hidden = installed();
  nav.querySelectorAll('a').forEach(link => {
    if (link.hash === '#' + page) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (storageIssue) {
    main.innerHTML = welcome('Storage unavailable', 'Bill details need browser storage on this device.') +
      '<p class="message error" role="alert">Check that site data is allowed and then reload. Your records have not been changed.</p>' +
      button('Reload', 'reload', 'primary');
    return;
  }
  if (!state) return;
  const records = shown();
  if (page === 'home') {
    main.innerHTML = welcome('Hello, Olly.', 'Your bills, policies and renewals in one place.', addButton()) + exampleBanner() +
      '<div class="dashboard-grid">' + spendPanel(records) + upcomingPanel(records) + '</div>' + billsPanel('Your bills');
  } else if (page === 'bills') {
    main.innerHTML = welcome('Your bills', 'Manage bills, subscriptions and policies.', addButton()) +
      exampleBanner() + billsPanel('All records');
  } else if (page === 'dates') {
    main.innerHTML = welcome('Upcoming dates', 'Payment and renewal dates, including anything overdue.', addButton()) +
      exampleBanner() + '<section class="panel date-panel" aria-label="Payment and renewal dates">' +
      eventRows(events(records), 'Add a payment or renewal date to a bill to see it here.') + '</section>';
  } else {
    main.innerHTML = welcome('Settings', 'Make Olly’s Outgoings work for you.') + settingsPanel();
  }
}

function releaseDocumentPreview() {
  if (documentPreview) URL.revokeObjectURL(documentPreview.url);
  documentPreview = null;
}

function openDialog(title, body, footer = '', { form = false } = {}) {
  releaseDocumentPreview();
  const content = '<header class="dialog-header"><h2 id="dialog-title">' + title +
    '</h2><button class="icon-button" type="button" data-action="close" aria-label="Close">' + icon('close') + '</button></header>' +
    '<div class="dialog-body">' + body + '</div>' +
    (footer ? '<footer class="dialog-footer">' + footer + '</footer>' : '');
  if (!dialog.open) restoreFocus = document.activeElement;
  dialog.innerHTML = form ? '<form id="record-form" autocomplete="off" novalidate>' + content + '</form>' : content;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  const target = dialog.querySelector('[data-dialog-focus]') ?? dialog.querySelector('[data-action="close"]');
  target?.focus({ preventScroll: true });
}

function detail(record) {
  dialogRecord = record;
  const sample = record.id.startsWith('sample-');
  const dates = ['payment', 'renewal'].map(kind => {
    if (!record[kind]) return '';
    const remind = !sample && !record.archived ? button('Calendar', 'calendar', 'subtle compact', 'calendar', 'data-kind="' + kind +
      '" aria-label="Calendar reminder for ' + kind + '"') : '';
    const paid = kind === 'payment' && !sample && !record.archived
      ? button('Mark paid', 'paid', 'quiet compact') : '';
    return '<div class="detail-date"><span><strong>' + (kind === 'payment' ? 'Next payment' : 'Renewal date') +
      '</strong><time datetime="' + record[kind] + '">' + formatDate(record[kind]) +
      '</time></span><div class="actions">' + remind + paid + '</div></div>';
  }).join('');
  const fields = [['Policy or account reference', record.reference], ['Contact details', record.contact], ['Notes', record.notes]]
    .filter(([, value]) => value).map(([label, value]) => '<div><dt>' + label + '</dt><dd>' + escape(value) + '</dd></div>').join('');
  const footer = sample ? addButton() :
    button(record.archived ? 'Restore bill' : 'Archive', record.archived ? 'restore' : 'archive', 'quiet', 'archive') +
    button('Edit bill', 'edit', 'primary');
  openDialog(escape(record.title),
    '<div class="details-hero">' + categoryIcon(record.category) + '<div><strong>' + money(record.amount) +
    '</strong><br><small>per ' + frequencies[record.frequency].short + ' · ' + escape(record.provider) +
    '</small></div><span class="category-pill cat-' + record.category + '">' + categories[record.category].name +
    '</span></div>' + (sample ? '<p class="message">Example bill.</p>' : '') +
    '<div class="detail-dates">' + (dates || '<div class="detail-date"><small>No payment or renewal dates added.</small></div>') +
    '</div><dl class="detail-fields"><div><dt>Reminder lead time</dt><dd>' + leadOptions.get(record.lead) +
    '</dd></div>' + fields + '</dl>' + (sample ? '' : documentsSection(record)), footer);
}

function documentsSection(record) {
  const files = record.attachments ?? [];
  const used = fileSize(attachmentBytes(state.records));
  const rows = files.map(file => '<li class="document-row"><button type="button" class="document-open" data-action="view-document" data-file-id="' +
    file.id + '">' + icon('folder') + '<span><strong>' + escape(file.name) + '</strong><small>' +
    fileLabel(file.type) + ' · ' + fileSize(file.size) + '</small></span></button>' +
    '<button class="icon-button" type="button" data-action="remove-document" data-file-id="' + file.id +
    '" aria-label="Remove ' + escape(file.name) + '">' + icon('close') + '</button></li>').join('');
  return '<section class="documents-section" id="documents-section" aria-labelledby="documents-title">' +
    '<div class="section-heading"><h3 id="documents-title">Documents</h3>' +
    button('Add document', 'attach', 'subtle compact', 'plus', files.length >= attachmentLimits.perBill ? 'disabled' : '') +
    '</div><p class="document-help">PDFs and photos · up to 5 MB each · ' + files.length + '/10 files</p>' +
    '<p id="document-error" class="message error" role="alert" hidden></p>' +
    (rows ? '<ul class="document-list">' + rows + '</ul>' :
      '<p class="document-empty">Keep a policy, bill or screenshot here.</p>') +
    '<p class="document-help">Saved on this device. Included in backups. ' + used + ' of 50 MB used.</p></section>';
}

function documentError(message) {
  const error = $('#document-error');
  if (!error) return toast(message);
  error.textContent = message;
  error.hidden = false;
}

async function viewDocument(record, fileId) {
  const metadata = record.attachments?.find(file => file.id === fileId);
  if (!metadata) throw new Error('Document unavailable');
  const blob = await readAttachment(fileId);
  if (!blob) throw new Error('Document unavailable');
  if (!dialog.open || dialogRecord?.id !== record.id || !$('#documents-section')) return;
  const url = URL.createObjectURL(blob);
  const file = new File([blob], metadata.name, { type: metadata.type });
  const share = navigator.canShare?.({ files: [file] });
  const content = metadata.type === 'application/pdf'
    ? '<iframe class="document-pdf" src="' + url + '" title="PDF document preview" sandbox=""></iframe>'
    : '<img class="document-image" src="' + url + '" alt="Preview of ' + escape(metadata.name) + '">';
  openDialog(escape(metadata.name),
    content + '<p class="document-help">If the preview is unavailable, download or share the file to open it on your phone.</p>',
    button('Back to bill', 'back-detail', 'quiet') + button('Download', 'download-document', 'subtle', 'download') +
    (share ? button('Share', 'share-document', 'primary') : ''));
  documentPreview = { url, blob, metadata };
}

const field = (label, control, full = false) => '<label class="field' + (full ? ' full' : '') + '"><span>' + label + '</span>' + control + '</label>';
const input = (key, value, attrs = '') => '<input name="' + key + '" value="' + escape(value ?? '') + '" ' + attrs + '>';
const placeholder = key => 'maxlength="' + limits[key] + '"';
const dateField = (key, value, label) => field(label, input(key, formatDate(value),
  'inputmode="numeric" maxlength="10" placeholder="DD/MM/YYYY" aria-describedby="date-help"'));
const select = (key, options, selected) => '<select name="' + key + '">' +
  options.map(([value, label]) => option(value, label, selected)).join('') + '</select>';

function editor(record) {
  dialogRecord = record;
  const categoryOptions = Object.entries(categories).map(([key, value]) => [key, value.name]);
  const frequencyOptions = Object.entries(frequencies).map(([key, value]) => [key, value.label]);
  openDialog(record ? 'Edit bill' : 'Add a bill',
    '<p id="form-error" class="message error" role="alert" hidden></p><div class="form-grid">' +
    field('Bill name', input('title', record?.title, placeholder('title') + ' required placeholder="e.g. Car insurance"'), true) +
    field('Provider', input('provider', record?.provider, placeholder('provider') + ' required placeholder="e.g. Admiral"')) +
    field('Category', select('category', categoryOptions, record?.category ?? 'utilities')) +
    field('Amount (£)', input('amount', record ? (record.amount / 100).toFixed(2) : '', 'required maxlength="9" inputmode="decimal" placeholder="0.00"')) +
    field('Billing frequency', select('frequency', frequencyOptions, record?.frequency ?? 'monthly')) +
    dateField('payment', record?.payment, 'Next payment · optional') +
    dateField('renewal', record?.renewal, 'Renewal · optional') +
    '<small class="form-hint" id="date-help">Enter DD/MM/YYYY or eight digits.</small>' +
    field('Remind me', select('lead', [...leadOptions], record?.lead ?? 7), true) +
    '<small class="form-hint">Use Calendar from the bill, or enable direct alerts in Settings.</small></div>' +
    '<details class="more-fields"' + (record?.reference || record?.contact || record?.notes ? ' open' : '') +
    '><summary>Policy, contact and notes</summary><div class="form-grid">' +
    field('Policy or account reference', input('reference', record?.reference, placeholder('reference'))) +
    field('Contact details', input('contact', record?.contact, placeholder('contact') + ' placeholder="Phone, email or website"')) +
    field('Notes', '<textarea name="notes" maxlength="' + limits.notes + '">' + escape(record?.notes ?? '') + '</textarea>', true) +
    '</div></details>', button('Cancel', record ? 'back-detail' : 'close', 'quiet') +
    '<button class="button primary" type="submit">Save bill</button>', { form: true });
}

function showDialogError(message, fieldName) {
  const error = dialog.querySelector('#form-error');
  if (!error) return toast(message);
  error.hidden = false;
  error.textContent = message;
  if (fieldName) {
    const field = dialog.querySelector('[name="' + fieldName + '"]');
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

function findEditable(previous, viewed) {
  const record = previous.records.find(item => item.id === viewed.id);
  if (!record || record.revision !== viewed.revision) throw new Error('This bill changed in another tab. Reopen it and try again.');
  return record;
}

async function mutate(change, { refresh = true } = {}) {
  savedState(await changeState(change), refresh);
}

function savedState(next, refresh = true) {
  state = next;
  channel?.postMessage('changed');
  if (refresh) render();
  syncReminders();
}

const writeError = error => error?.constructor === Error ? error.message : 'The change could not be saved. Check available storage and try again.';

async function saveBill(form) {
  const viewed = dialogRecord;
  const values = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
  form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  if (!values.title) return showDialogError('Enter a bill name.', 'title');
  if (!values.provider) return showDialogError('Enter a provider.', 'provider');
  const amount = parseAmount(values.amount);
  if (amount === null) return showDialogError('Enter a GBP amount, such as 35 or 35.50.', 'amount');
  const payment = values.payment ? parseDate(values.payment) : '';
  if (payment === null) return showDialogError('Enter a valid payment date as DD/MM/YYYY.', 'payment');
  const renewal = values.renewal ? parseDate(values.renewal) : '';
  if (renewal === null) return showDialogError('Enter a valid renewal date as DD/MM/YYYY.', 'renewal');
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const id = viewed?.id ?? crypto.randomUUID();
    await mutate(previous => {
      if (viewed) findEditable(previous, viewed);
      if (!viewed && previous.records.length >= limits.records) throw new Error('This device already has 500 bills.');
      const record = { ...values, id, amount, payment, renewal, lead: Number(values.lead),
        anchorDay: payment === viewed?.payment ? viewed.anchorDay : payment ? Number(payment.slice(-2)) : 1,
        attachments: viewed?.attachments ?? [], archived: viewed?.archived ?? false, revision: (viewed?.revision ?? 0) + 1 };
      const records = viewed ? previous.records.map(item => item.id === id ? record : item) : [record, ...previous.records];
      return { ...previous, records, showExamples: false };
    });
    dialog.close();
    main.querySelector('[data-id="' + id + '"]')?.focus({ preventScroll: true });
    toast(viewed ? 'Bill updated.' : 'Bill added.');
  } catch (error) {
    showDialogError(writeError(error));
  } finally {
    submit.disabled = false;
  }
}

async function updateRecord(action, viewed) {
  if (!viewed || viewed.id.startsWith('sample-')) return;
  const next = action === 'paid' ? nextPayment(viewed.payment, viewed.frequency, viewed.anchorDay) : '';
  if (next && !parseDate(formatDate(next))) {
    toast('Choose a new payment date in Edit bill.');
    return;
  }
  try {
    await mutate(previous => {
      const record = findEditable(previous, viewed);
      const change = action === 'paid' ? { payment: next } : { archived: action === 'archive' };
      return { ...previous, records: previous.records.map(item =>
        item.id === record.id ? { ...item, ...change, revision: item.revision + 1 } : item) };
    });
    if (action === 'paid') detail(recordFor(viewed.id));
    else dialog.close();
    toast(action === 'paid' ? 'Next payment moved to ' + formatDate(next) + '.' :
      action === 'archive' ? 'Bill archived.' : 'Bill restored.');
  } catch (error) {
    toast(writeError(error));
  }
}

function focusAfterClose() {
  if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
  else if (!main.contains(document.activeElement)) main.focus({ preventScroll: true });
  restoreFocus = null;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function makeCalendarFile() {
  const { record, kind } = calendarDraft;
  return new File([calendarFile(record, kind, new Date(), $('#calendar-repeat').checked)],
    'outgoings-reminder.ics', { type: 'text/calendar' });
}

function calendarPreview() {
  const { record, kind } = calendarDraft;
  const { date, alert } = calendarPlan(record, kind, $('#calendar-repeat').checked);
  $('#calendar-date').textContent = formatDate(date);
  $('#calendar-alert').textContent = alert
    ? 'Requested alert on ' + formatDate(today(alert)) + ' at 9am UK time.'
    : 'There’s no future alert on this event. Edit the date or lead time to schedule one.';
}

function calendarDialog(record, kind) {
  calendarDraft = { record, kind };
  const isPayment = kind === 'payment';
  const repeatLabel = isPayment ? 'Repeat ' + frequencies[record.frequency].label.toLowerCase() : 'Repeat annually';
  const share = Boolean(navigator.canShare?.({ files: [
    new File([''], 'outgoings-reminder.ics', { type: 'text/calendar' })
  ] }));
  openDialog('Calendar reminder',
    '<label class="check-field"><input id="calendar-repeat" type="checkbox"' + (isPayment ? ' checked' : '') +
    '> ' + repeatLabel + '</label><p>' + (isPayment ? 'Next exported payment' : 'Exported renewal') +
    ' <strong id="calendar-date"></strong>.</p><p id="calendar-alert" role="status"></p>' +
    '<p>On iPhone, share the file to Mail, open the attachment and add it to Apple Calendar. Check the alert and repeat setting when saving it.</p>' +
    '<p>Calendar gets a generic event title. Update or remove the event there if the bill changes.</p>',
    button('Back', 'back-detail', 'quiet') + button('Download .ics', 'calendar-download', 'subtle', 'download') +
    (share ? button('Share file', 'calendar-share', 'primary') : ''));
  calendarPreview();
}

async function install() {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try { await prompt.prompt(); return; } catch { /* Use the manual instructions. */ }
  }
  openDialog('Install Olly’s Outgoings',
    '<p><strong>iPhone</strong> Open in Safari, tap Share, choose <strong>Add to Home Screen</strong>, turn on <strong>Open as Web App</strong> if shown, then tap Add.</p>' +
    '<p><strong>Android</strong> Open in Chrome and choose <strong>Install app</strong> or <strong>Add to Home screen</strong> from the menu.</p>' +
    '<p>Open from the Home Screen before adding bills. If you already added bills in Safari, move them using a backup.</p>', button('Done', 'close', 'primary'));
}

function pushFeedback(message) {
  pushStatus = message;
  const status = $('#push-status');
  if (status) status.textContent = message;
}

function syncReminders() {
  if (!state?.push || !pushConfigured) return;
  pushQueue = pushQueue.then(async () => {
    const current = state;
    if (!current.push) return;
    if (!navigator.onLine) {
      pushFeedback('Offline. Reminder changes will sync when you reconnect and open the app.');
      return;
    }
    try {
      await syncPush(current);
      pushFeedback('Reminders synced on this device.');
    } catch {
      pushFeedback(pushProblem() || 'Reminder sync failed. Reopen while online or set up notifications again.');
    }
  });
}

async function pushSetup() {
  pushSetupContext = null;
  openDialog('Enable iPhone alerts',
    '<p>Open from the Home Screen first. Enter the setup code from whoever hosted the app, then tap Allow when your phone asks.</p>' +
    '<p id="form-error" class="message error" role="alert" hidden></p>' +
    field('Setup code', input('push-invite', '', 'type="password" maxlength="128" autocomplete="off"')) +
    '<p>Push receives reminder times and a device subscription. The alert hides bill details.</p>',
    button('Cancel', 'close', 'quiet') + button('Enable alerts', 'push-enable', 'primary', 'bell', 'disabled'));
  const enable = dialog.querySelector('[data-action="push-enable"]');
  try {
    const context = await preparePush();
    if (enable.isConnected) {
      pushSetupContext = context;
      enable.disabled = false;
    }
  } catch (error) {
    if (enable.isConnected) showDialogError(writeError(error));
  }
}

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const { action, id, kind } = target.dataset;
  if (action === 'reload') return location.reload();
  if (action === 'install') return install();
  if (!state) return;
  if (action === 'add') return editor(null);
  if (action === 'edit') return editor(dialogRecord);
  if (action === 'close') return dialog.close();
  if (action === 'back-detail') return detail(dialogRecord);
  if (action === 'detail') {
    const record = recordFor(id);
    if (record) detail(record);
    return;
  }
  if (action === 'archive' || action === 'restore' || action === 'paid') {
    target.disabled = true;
    return updateRecord(action, dialogRecord).finally(() => { target.disabled = false; });
  }
  if (action === 'calendar') return calendarDialog(dialogRecord, kind);
  if (action === 'calendar-download') {
    const file = makeCalendarFile();
    return download(file, file.name);
  }
  if (action === 'calendar-share') {
    try { await navigator.share({ files: [makeCalendarFile()], title: 'Calendar reminder' }); }
    catch (error) { if (error.name !== 'AbortError') toast('Sharing is unavailable. Download the calendar file instead.'); }
    return;
  }
  if (action === 'clear-demo' || action === 'show-demo') {
    try {
      await mutate(previous => ({ ...previous, showExamples: action === 'show-demo' && !previous.records.length }));
      main.focus();
    } catch (error) { toast(writeError(error)); }
    return;
  }
  if (action === 'clear-filter') {
    filter = { search: '', category: '', archived: 'active' };
    render();
    $('#bill-search')?.focus();
    return;
  }
  if (action === 'attach') {
    attachmentRecordId = dialogRecord.id;
    return attachmentInput.click();
  }
  if (action === 'view-document') {
    target.disabled = true;
    try { await viewDocument(dialogRecord, target.dataset.fileId); }
    catch { documentError('This document could not be opened. Try again.'); }
    finally { target.disabled = false; }
    return;
  }
  if (action === 'download-document') return download(documentPreview.blob, documentPreview.metadata.name);
  if (action === 'share-document') {
    const preview = documentPreview;
    try {
      await navigator.share({ files: [new File([preview.blob], preview.metadata.name, { type: preview.metadata.type })] });
    } catch (error) {
      if (error.name !== 'AbortError') toast('Sharing is unavailable. Download the document instead.');
    }
    return;
  }
  if (action === 'remove-document') {
    const record = dialogRecord;
    const metadata = record.attachments.find(file => file.id === target.dataset.fileId);
    pendingRemoval = { recordId: record.id, fileId: metadata.id };
    return openDialog('Remove document?',
      '<p>Remove <strong>' + escape(metadata.name) + '</strong> from this bill and this device? Keep a backup if you need it later.</p>',
      button('Keep document', 'back-detail', 'quiet') + button('Remove document', 'confirm-remove-document', 'danger'));
  }
  if (action === 'confirm-remove-document') {
    target.disabled = true;
    try {
      const { recordId, fileId } = pendingRemoval;
      savedState(await removeAttachment(recordId, fileId));
      const record = recordFor(recordId);
      if (record) detail(record);
      toast('Document removed.');
    } catch (error) { toast(writeError(error)); }
    finally { target.disabled = false; }
    return;
  }
  if (action === 'export') {
    target.disabled = true;
    target.textContent = 'Preparing backup…';
    try {
      const snapshot = await backupSnapshot();
      const backup = await createBackup(snapshot.state, snapshot.files);
      download(new Blob([JSON.stringify(backup)], { type: 'application/json' }), 'ollys-outgoings-' + today() + '.json');
      toast('Backup ready, including your documents.');
    } catch (error) { toast(writeError(error)); }
    finally {
      target.disabled = false;
      target.innerHTML = icon('download') + 'Download backup';
    }
    return;
  }
  if (action === 'import') return backupInput.click();
  if (action === 'push-setup') return pushSetup();
  if (action === 'push-enable') {
    const invite = dialog.querySelector('[name="push-invite"]').value.trim();
    if (!invite) return showDialogError('Enter the setup code.', 'push-invite');
    target.disabled = true;
    try {
      const device = await enablePush(invite, state.push, pushSetupContext);
      await mutate(previous => ({ ...previous, push: device }));
      dialog.close();
      toast('Notifications enabled. Send a test from Settings.');
    } catch (error) { showDialogError(writeError(error)); }
    finally { target.disabled = false; }
    return;
  }
  if (action === 'push-disable' || action === 'test-push') {
    target.disabled = true;
    try {
      if (action === 'test-push') {
        await testPush(state.push);
        toast('Test alert sent. Check Notification Centre.');
      } else {
        await pushQueue;
        await disablePush(state.push);
        pushStatus = '';
        await mutate(previous => ({ ...previous, push: null }));
        toast('Direct alerts turned off.');
      }
    } catch (error) { toast(writeError(error)); }
    finally { target.disabled = false; }
  }
});

function filterResults(announce = false) {
  const rows = $('#bill-rows');
  if (!rows) return;
  rows.innerHTML = filteredRows();
  if (announce) {
    const count = rows.querySelectorAll('.record-row').length;
    $('#search-feedback').textContent = count + (count === 1 ? ' bill' : ' bills') + ' found.';
  }
}

main.addEventListener('input', event => {
  if (event.target.id !== 'bill-search') return;
  filter.search = event.target.value;
  filterResults(true);
});
main.addEventListener('change', event => {
  if (event.target.id === 'category-filter') filter.category = event.target.value;
  else if (event.target.id === 'archive-filter') filter.archived = event.target.value;
  else return;
  filterResults(true);
});
dialog.addEventListener('change', event => {
  if (event.target.id === 'calendar-repeat') calendarPreview();
});
dialog.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'record-form') void saveBill(event.target);
});
dialog.addEventListener('close', () => {
  releaseDocumentPreview();
  focusAfterClose();
});
backupInput.addEventListener('change', async () => {
  const file = backupInput.files?.[0];
  backupInput.value = '';
  if (!file) return;
  try {
    if (file.size > attachmentLimits.backup) throw new Error('Choose an Outgoings backup up to 75 MB.');
    let json;
    try { json = JSON.parse(await file.text()); }
    catch { throw new Error('This file is not a readable Outgoings backup.'); }
    const incoming = await readBackup(json);
    const imported = await importBackup(incoming);
    savedState(imported.state);
    toast(imported.count + (imported.count === 1 ? ' bill imported with its documents.' : ' bills imported with their documents.') +
      (imported.skipped ? ' Existing bills and their documents kept.' : ''));
  } catch (error) { toast(writeError(error)); }
});

attachmentInput.addEventListener('change', async () => {
  const file = attachmentInput.files?.[0];
  const recordId = attachmentRecordId;
  attachmentInput.value = '';
  if (!file) return;
  const attachButton = dialog.querySelector('[data-action="attach"]');
  if (attachButton) {
    attachButton.disabled = true;
    attachButton.textContent = 'Saving document…';
  }
  try {
    const prepared = await prepareAttachment(file);
    savedState(await saveAttachment(recordId, prepared));
    if (dialog.open && dialogRecord?.id === recordId && $('#documents-section')) detail(recordFor(recordId));
    toast('Document saved on this device.');
  } catch (error) {
    if (dialog.open && dialogRecord?.id === recordId) documentError(writeError(error));
    else toast(writeError(error));
  } finally {
    if (attachButton?.isConnected) {
      attachButton.disabled = false;
      attachButton.textContent = 'Add document';
    }
  }
});

async function refresh() {
  try {
    const next = await readState();
    const day = today();
    const changed = !state || state.revision !== next.revision || liveDay !== day;
    state = next;
    liveDay = day;
    storageIssue = false;
    if (changed) {
      if (document.activeElement?.id === 'bill-search') filterResults();
      else render();
    }
  } catch {
    storageIssue = true;
    render();
  }
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#main') return;
  render();
  main.focus();
  scrollTo(0, 0);
});
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => { $('#install-top').hidden = true; });
window.addEventListener('online', syncReminders);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh().then(syncReminders);
});
channel?.addEventListener('message', () => void refresh());
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(syncReminders).catch(() => {});
}
void refresh().then(syncReminders);
