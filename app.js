/* ==========================================================================
   app.js — Kid Check-In Tally

   Plain JavaScript, no frameworks. Rough layout of this file:
     1. Helpers (DOM building, dates)
     2. App state + rendering the cards
     3. Edit mode: add / rename / change photo / delete / reorder
     4. Dialog (custom confirm / prompt)
     5. Tallies: tap / long-press
     6. Toast with Undo
     7. Reset all
     8. Offline support (service worker) + persistent storage
     9. Backup: export / import

   The `db` object comes from db.js, which is loaded first.
   ========================================================================== */

'use strict';

/* ---------- 1. Helpers ---------- */

/** Shorthand for document.querySelector. */
const $ = (selector, root = document) => root.querySelector(selector);

/**
 * Build a DOM element. Text is always set with textContent, so a kid named
 * "<b>Bob</b>" just shows those characters — no HTML injection.
 *   el('button', { class: 'btn', text: 'Hi', 'data-id': 'x' })
 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('data-') || key.startsWith('aria-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/** "Nov 14, 2026" in the phone's own locale. */
function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "just now", "5 minutes ago", "yesterday", "2 days ago"… or "—" if never. */
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function relativeTime(ts) {
  if (!ts) return '—';
  const seconds = Math.round((ts - Date.now()) / 1000); // negative = in the past
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  const units = [
    ['minute', 60], ['hour', 3600], ['day', 86400],
    ['week', 604800], ['month', 2629800], ['year', 31557600],
  ];
  let [unit, size] = units[0];
  for (const [u, s] of units) if (abs >= s) { unit = u; size = s; }
  return relativeFormat.format(Math.round(seconds / size), unit);
}

/** Short buzz on phones that support it (silently ignored elsewhere). */
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

/* ---------- 2. State + rendering ---------- */

// The two kinds of tally. `last` is the matching timestamp field on a kid.
const FIELDS = {
  talked: { label: 'Talked', emoji: '💬', last: 'lastTalked' },
  texted: { label: 'Texted', emoji: '✉️', last: 'lastTexted' },
};

const state = {
  kids: [],          // kid records, kept sorted by `order`
  lastReset: null,   // timestamp
  editing: false,    // edit mode on/off
};

const findKid = id => state.kids.find(k => k.id === id);

// Photos are Blobs. To show one in an <img> we need an object URL. We cache
// one URL per kid and free it when the photo changes or the kid is deleted.
const photoUrls = new Map();
function photoUrl(kid) {
  let url = photoUrls.get(kid.id);
  if (!url) {
    url = URL.createObjectURL(kid.photo);
    photoUrls.set(kid.id, url);
  }
  return url;
}
function forgetPhotoUrl(id) {
  const url = photoUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  photoUrls.delete(id);
}

/** Redraw the whole screen from `state`. Cheap enough for a handful of kids. */
function render() {
  $('#since').textContent = 'Counting since ' + formatDate(state.lastReset);

  document.body.classList.toggle('editing', state.editing);
  const toggle = $('#edit-toggle');
  toggle.textContent = state.editing ? 'Done' : '⚙️';
  toggle.setAttribute('aria-pressed', String(state.editing));
  toggle.setAttribute('aria-label', state.editing ? 'Done editing' : 'Edit kids');

  const hasKids = state.kids.length > 0;
  $('#empty').hidden = hasKids || state.editing;
  $('#reset-area').hidden = !hasKids;

  $('#grid').replaceChildren(...state.kids.map(renderCard));
}

function renderCard(kid, index) {
  const photo = kid.photo
    ? el('img', { class: 'photo', src: photoUrl(kid), alt: '' })
    : el('div', { class: 'photo placeholder', 'aria-hidden': 'true', text: (kid.name.trim()[0] || '?').toUpperCase() });

  const editButtons = el('div', { class: 'card-edit' }, [
    editButton('up', kid, '⬆️', `Move ${kid.name} up`, index === 0),
    editButton('down', kid, '⬇️', `Move ${kid.name} down`, index === state.kids.length - 1),
    editButton('rename', kid, '✏️', `Rename ${kid.name}`),
    editButton('photo', kid, '📷', `Change photo for ${kid.name}`),
    editButton('delete', kid, '🗑️', `Delete ${kid.name}`),
  ]);

  return el('article', { class: 'card', 'data-id': kid.id }, [
    photo,
    el('h2', { class: 'name', text: kid.name }),
    tallyButton(kid, 'talked'),
    tallyButton(kid, 'texted'),
    editButtons,
  ]);
}

function editButton(action, kid, icon, label, disabled = false) {
  return el('button', {
    type: 'button', class: 'icon-btn', text: icon, disabled,
    title: label, 'aria-label': label, 'data-action': action, 'data-id': kid.id,
  });
}

function tallyButton(kid, field) {
  const button = el('button', {
    type: 'button', class: `tally tally-${field}`, 'data-id': kid.id, 'data-field': field,
  }, [
    el('span', { class: 'tally-label', text: `${FIELDS[field].emoji} ${FIELDS[field].label}` }),
    el('span', { class: 'tally-count' }),
    el('span', { class: 'tally-last' }),
  ]);
  fillTallyButton(button, kid, field);
  return button;
}

/** Update the numbers/text inside an existing tally button. */
function fillTallyButton(button, kid, field) {
  const info = FIELDS[field];
  button.querySelector('.tally-count').textContent = kid[field];
  button.querySelector('.tally-last').textContent = 'last: ' + relativeTime(kid[info.last]);
  button.setAttribute('aria-label',
    `${info.label} ${kid.name}: ${kid[field]}. Tap to add one, long-press to subtract one.`);
}

/** Refresh just the "last: …" lines (called every minute). */
function refreshTimes() {
  document.querySelectorAll('.tally').forEach(button => {
    const kid = findKid(button.dataset.id);
    if (kid) fillTallyButton(button, kid, button.dataset.field);
  });
}

/* ---------- 3. Edit mode ---------- */

function setEditing(on) {
  state.editing = on;
  render();
}

/**
 * Turn a picked image file into a 512×512 JPEG Blob:
 * centre-crop to a square, scale, then re-encode at 85% quality.
 * (Chrome applies the camera's EXIF rotation automatically.)
 */
async function processPhoto(file, size = 512) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();

    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

    return await new Promise((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Photo chosen in the "Add a kid" form — process it now and show a preview.
let pendingPhoto = null;
async function onAddPhotoPicked(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingPhoto = await processPhoto(file);
    const preview = $('#add-preview');
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = URL.createObjectURL(pendingPhoto);
    preview.hidden = false;
  } catch (err) {
    console.warn(err);
    pendingPhoto = null;
    showToast("Couldn't read that photo. Try another one.");
  }
}

function clearAddForm() {
  $('#add-form').reset();
  pendingPhoto = null;
  const preview = $('#add-preview');
  if (preview.src) URL.revokeObjectURL(preview.src);
  preview.removeAttribute('src');
  preview.hidden = true;
}

async function onAddKid(e) {
  e.preventDefault();
  const name = $('#add-name').value.trim();
  if (!name) return;

  const kid = {
    id: crypto.randomUUID(),
    name,
    photo: pendingPhoto,       // may be null; the card then shows the initial
    talked: 0,
    texted: 0,
    lastTalked: null,
    lastTexted: null,
    order: state.kids.length ? Math.max(...state.kids.map(k => k.order)) + 1 : 0,
  };
  // Add to the screen and clear the form right away, before the (async) save,
  // so a quick second entry can't be wiped or get the same `order`.
  state.kids.push(kid);
  clearAddForm();
  render();
  await db.putKid(kid);
  showToast(`Added ${name}`);
}

/** Swap a kid with its neighbour, then renumber everyone 0,1,2… and save. */
async function moveKid(kid, direction) {
  const i = state.kids.indexOf(kid);
  const j = i + direction;
  if (j < 0 || j >= state.kids.length) return;
  [state.kids[i], state.kids[j]] = [state.kids[j], state.kids[i]];
  state.kids.forEach((k, n) => { k.order = n; });
  await db.putKids(state.kids);
  render();
}

async function renameKid(kid) {
  const name = await askDialog({
    title: 'Rename', message: `New name for ${kid.name}:`, input: kid.name, okLabel: 'Save',
  });
  if (!name || name === kid.name) return;
  kid.name = name;
  await db.putKid(kid);
  render();
}

// The hidden #photo-change input is shared by every card; remember which kid.
let photoTargetId = null;
function pickNewPhoto(kid) {
  photoTargetId = kid.id;
  $('#photo-change').click();
}
async function onChangePhotoPicked(e) {
  const file = e.target.files[0];
  e.target.value = '';                       // so picking the same file again still fires
  const kid = findKid(photoTargetId);
  if (!file || !kid) return;
  try {
    kid.photo = await processPhoto(file);
  } catch (err) {
    console.warn(err);
    showToast("Couldn't read that photo. Try another one.");
    return;
  }
  forgetPhotoUrl(kid.id);
  await db.putKid(kid);
  render();
}

async function deleteKid(kid) {
  const ok = await askDialog({
    title: `Delete ${kid.name}?`,
    message: 'Their photo and counts will be removed from this phone.',
    okLabel: 'Delete', danger: true,
  });
  if (!ok) return;
  await db.deleteKid(kid.id);
  state.kids = state.kids.filter(k => k !== kid);
  forgetPhotoUrl(kid.id);
  render();

  // Undo puts the whole record (photo Blob included) back.
  showToast(`Deleted ${kid.name}`, async () => {
    await db.putKid(kid);
    state.kids.push(kid);
    state.kids.sort((a, b) => a.order - b.order);
    render();
  });
}

/** One click handler on the grid handles every card's edit buttons. */
function onGridClick(e) {
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const kid = findKid(button.dataset.id);
  if (!kid) return;
  switch (button.dataset.action) {
    case 'up':     moveKid(kid, -1); break;
    case 'down':   moveKid(kid, +1); break;
    case 'rename': renameKid(kid); break;
    case 'photo':  pickNewPhoto(kid); break;
    case 'delete': deleteKid(kid); break;
  }
}

/* ---------- 4. Dialog (replaces window.confirm / window.prompt) ---------- */

/**
 * Show the custom dialog and wait for an answer.
 *   confirm mode: resolves true (OK) or null (Cancel / Back button)
 *   prompt mode (pass `input`): resolves the trimmed text, or null
 */
function askDialog({ title, message = '', okLabel = 'OK', danger = false, input = null }) {
  const dialog = $('#dialog');
  const field = $('#dialog-input');
  $('#dialog-title').textContent = title;
  $('#dialog-message').textContent = message;
  $('#dialog-message').hidden = !message;

  const ok = $('#dialog-ok');
  ok.textContent = okLabel;
  ok.className = 'btn ' + (danger ? 'danger' : 'primary');

  const wantsText = input !== null;
  field.hidden = !wantsText;
  field.required = wantsText;
  field.value = wantsText ? input : '';

  dialog.returnValue = '';
  dialog.showModal();
  if (wantsText) { field.focus(); field.select(); } else { ok.focus(); }

  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'ok') return resolve(null);
      resolve(wantsText ? field.value.trim() || null : true);
    }, { once: true });
  });
}

/* ---------- 5. Tallies: tap = +1, long-press = −1 ---------- */

const LONG_PRESS_MS = 500;
let press = null;   // the press in progress: { button, pointerId, timer, fired }

function cancelPress() {
  if (!press) return;
  clearTimeout(press.timer);
  press.button.classList.remove('pressing');
  press = null;
}

function onPointerDown(e) {
  const button = e.target.closest('.tally');
  if (!button || e.button !== 0) return;   // ignore right/middle mouse buttons
  cancelPress();
  press = { button, pointerId: e.pointerId, fired: false, timer: null };
  button.classList.add('pressing');
  // If the finger is still down after 500 ms, it's a long-press: subtract one.
  press.timer = setTimeout(() => {
    press.fired = true;
    button.classList.remove('pressing');
    changeTally(button.dataset.id, button.dataset.field, -1);
  }, LONG_PRESS_MS);
}

function onPointerUp(e) {
  if (!press || e.pointerId !== press.pointerId) return;
  const { button, fired } = press;
  cancelPress();
  if (fired) return;                       // long-press already handled
  // Only count it if the finger was lifted while still over the button.
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (under && button.contains(under)) changeTally(button.dataset.id, button.dataset.field, +1);
}

// Keyboard users (Enter/Space) produce a click with detail === 0; count those too.
// Pointer clicks are ignored here because pointerup already handled them.
function onTallyKeyboardClick(e) {
  const button = e.target.closest('.tally');
  if (button && e.detail === 0) changeTally(button.dataset.id, button.dataset.field, +1);
}

/** Add `delta` (+1 or −1) to one kid's tally, save it, and offer Undo. */
async function changeTally(id, field, delta) {
  const kid = findKid(id);
  if (!kid) return;
  const lastField = FIELDS[field].last;
  const button = document.querySelector(`.tally[data-id="${id}"][data-field="${field}"]`);

  if (delta < 0 && kid[field] === 0) {     // never go below zero
    vibrate([10, 40, 10]);
    return;
  }

  // Remember the old values so Undo can put them back exactly.
  const before = { [field]: kid[field], [lastField]: kid[lastField] };

  kid[field] += delta;
  if (delta > 0) kid[lastField] = Date.now();
  else if (kid[field] === 0) kid[lastField] = null;   // back to zero: "never"

  // Update the screen first so it feels instant, then save.
  vibrate(delta > 0 ? 10 : [15, 60, 15]);
  if (button) {
    fillTallyButton(button, kid, field);
    pulse(button, delta > 0 ? 'bump' : 'dip');
  }
  await db.putKid(kid);

  const sign = delta > 0 ? '+1' : '−1';
  showToast(`${sign} ${FIELDS[field].label} · ${kid.name}`, async () => {
    Object.assign(kid, before);
    await db.putKid(kid);
    render();
  });
}

/** Restart a CSS animation class on an element. */
function pulse(element, className) {
  element.classList.remove('bump', 'dip');
  void element.offsetWidth;                // forces the browser to restart the animation
  element.classList.add(className);
}

/* ---------- 6. Toast with optional Undo ---------- */

const TOAST_MS = 4000;
let toastTimer = null;
let toastUndo = null;   // function to call if Undo is tapped

/** Show a message at the bottom for 4 seconds. Pass `undo` to show an Undo button. */
function showToast(message, undo = null) {
  $('#toast-msg').textContent = message;
  $('#toast-undo').hidden = !undo;
  toastUndo = undo;
  $('#toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').classList.remove('show');
  toastUndo = null;
}

async function onUndo() {
  const undo = toastUndo;
  hideToast();
  if (undo) {
    await undo();
    vibrate(10);
  }
}

/* ---------- 7. Reset all ---------- */

async function resetAll() {
  const ok = await askDialog({
    title: 'Reset all tallies to zero?',
    message: 'Every Talked and Texted count goes back to 0, and "Counting since" starts today.',
    okLabel: 'Reset', danger: true,
  });
  if (!ok) return;

  // Snapshot the old numbers in memory so Undo can restore them.
  const snapshot = state.kids.map(k => ({
    id: k.id, talked: k.talked, texted: k.texted, lastTalked: k.lastTalked, lastTexted: k.lastTexted,
  }));
  const previousReset = state.lastReset;

  state.kids.forEach(k => {
    k.talked = 0;
    k.texted = 0;
    k.lastTalked = null;
    k.lastTexted = null;
  });
  state.lastReset = Date.now();
  await db.putKids(state.kids);
  await db.setMeta('lastReset', state.lastReset);
  render();
  vibrate(30);

  showToast('All tallies reset', async () => {
    snapshot.forEach(saved => {
      const kid = findKid(saved.id);
      if (kid) Object.assign(kid, saved);
    });
    state.lastReset = previousReset;
    await db.putKids(state.kids);
    await db.setMeta('lastReset', previousReset);
    render();
  });
}

/* ---------- 8. Offline support + storage ---------- */

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  // When a new version's service worker takes over, reload once so the new
  // files are used. (Skipped on the very first install: nothing to refresh.)
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  navigator.serviceWorker.register('./sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(showVersion)
    .catch(err => console.warn('Service worker registration failed:', err));
}

/** Ask the service worker for its CACHE_VERSION and show it in the footer. */
function showVersion(registration) {
  if (!registration.active) return;
  const channel = new MessageChannel();
  channel.port1.onmessage = e => { $('#version').textContent = 'Version ' + e.data; };
  registration.active.postMessage('version', [channel.port2]);
}

/** Ask Chrome not to evict our data when the phone runs low on space. */
async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return;
  if (await navigator.storage.persisted()) return;
  const granted = await navigator.storage.persist();
  console.log('Persistent storage', granted ? 'granted' : 'not granted (yet)');
}

/* ---------- 9. Backup: export / import ---------- */

const BACKUP_APP_ID = 'kid-tally';

/** Blob -> "data:image/jpeg;base64,..." */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** "data:image/jpeg;base64,..." -> Blob (or null if it isn't an image). */
function dataUrlToBlob(dataUrl) {
  const match = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!match) return null;
  const bytes = atob(match[2]);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: match[1] });
}

/** Download everything (photos included) as one JSON file. */
async function exportBackup() {
  const kids = await Promise.all(state.kids.map(async kid => ({
    ...kid,
    photo: kid.photo ? await blobToDataUrl(kid.photo) : null,
  })));
  const backup = {
    app: BACKUP_APP_ID,
    format: 1,
    exportedAt: new Date().toISOString(),
    lastReset: state.lastReset,
    kids,
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
  const link = el('a', { href: url, download: `kid-checkin-backup-${stamp}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showToast(`Backup saved (${kids.length} kid${kids.length === 1 ? '' : 's'})`);
}

/** Read a backup file and, after confirming, replace everything with it. */
async function importBackup(e) {
  const file = e.target.files[0];
  e.target.value = '';                                    // allow re-picking the same file
  if (!file) return;

  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    backup = null;
  }
  if (!backup || backup.app !== BACKUP_APP_ID || !Array.isArray(backup.kids)) {
    showToast("That file isn't a Kid Check-In backup.");
    return;
  }

  const when = backup.exportedAt ? ` from ${formatDate(Date.parse(backup.exportedAt))}` : '';
  const ok = await askDialog({
    title: 'Restore backup?',
    message: `This replaces everything on this phone (${state.kids.length} kid${state.kids.length === 1 ? '' : 's'}) ` +
             `with the backup${when} (${backup.kids.length} kid${backup.kids.length === 1 ? '' : 's'}).`,
    okLabel: 'Restore', danger: true,
  });
  if (!ok) return;

  // Rebuild clean records, so a hand-edited file can't sneak in odd values.
  const count = n => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
  const time = t => (Number.isFinite(t) && t > 0 ? t : null);
  const kids = [...backup.kids]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((k, i) => ({
      id: typeof k.id === 'string' && k.id ? k.id : crypto.randomUUID(),
      name: String(k.name || 'Unnamed').slice(0, 40),
      photo: dataUrlToBlob(k.photo),
      talked: count(k.talked),
      texted: count(k.texted),
      lastTalked: time(k.lastTalked),
      lastTexted: time(k.lastTexted),
      order: i,
    }));
  const lastReset = time(backup.lastReset) || Date.now();

  await db.replaceAll(kids, lastReset);
  photoUrls.forEach(url => URL.revokeObjectURL(url));
  photoUrls.clear();
  state.kids = kids;
  state.lastReset = lastReset;
  render();
  showToast(`Restored ${kids.length} kid${kids.length === 1 ? '' : 's'}`);
}

/* ---------- Start-up ---------- */

async function init() {
  // Wire up buttons and inputs
  $('#edit-toggle').addEventListener('click', () => setEditing(!state.editing));
  $('#empty-add').addEventListener('click', () => { setEditing(true); $('#add-name').focus(); });
  $('#add-form').addEventListener('submit', onAddKid);
  $('#add-photo').addEventListener('change', onAddPhotoPicked);
  $('#photo-change').addEventListener('change', onChangePhotoPicked);
  $('#grid').addEventListener('click', onGridClick);
  $('#dialog-cancel').addEventListener('click', () => $('#dialog').close('cancel'));

  // Tallies: pointer events cover both touch and mouse.
  const grid = $('#grid');
  grid.addEventListener('pointerdown', onPointerDown);
  grid.addEventListener('pointerup', onPointerUp);
  grid.addEventListener('pointercancel', cancelPress);   // e.g. the finger started scrolling
  grid.addEventListener('click', onTallyKeyboardClick);
  grid.addEventListener('contextmenu', e => {            // no long-press menu on tally buttons
    if (e.target.closest('.tally')) e.preventDefault();
  });
  $('#toast-undo').addEventListener('click', onUndo);
  $('#reset-btn').addEventListener('click', resetAll);
  $('#export-btn').addEventListener('click', exportBackup);
  $('#import-file').addEventListener('change', importBackup);

  // Load saved data
  state.kids = await db.getAllKids();
  state.lastReset = await db.getMeta('lastReset');
  if (!state.lastReset) {
    // First run: start counting from now.
    state.lastReset = Date.now();
    await db.setMeta('lastReset', state.lastReset);
  }
  render();

  // Keep "last: 5 minutes ago" fresh while the app is open or comes back.
  setInterval(refreshTimes, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshTimes();
  });
}

registerServiceWorker();
requestPersistentStorage().catch(err => console.warn(err));

init().catch(err => {
  console.error(err);
  document.body.prepend(el('p', { class: 'empty', text: 'Something went wrong loading your data: ' + err.message }));
});
