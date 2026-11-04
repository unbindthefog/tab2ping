// Ping window: one line per ping, like ping in a terminal. The pings run in the helper; the service
// worker passes them on (port "window"). With AUTO (switched under the BROWSER key, takes effect at
// once) it shows the active tab's host; without, it keeps the host it shows (the worker pings it
// as "held" for as long as this window is open). The first click pins the window on top: its
// content moves into a picture-in-picture window, the only kind a page may keep above all others.
const port = chrome.runtime.connect({ name: 'window' });
// References kept: once pinned, the elements live in the other window's document.
const el = Object.fromEntries(['app', 'dot', 'host', 'follow', 'pin', 'log', 'sheet', 'style']
  .map(id => [id, document.getElementById(id)]));
const LABELS = { up: 'Antwort', down: 'keine Antwort', error: 'Fehler' };
const MAX_LINES = 200;

let auto = true;
let shownHost = new URLSearchParams(location.search).get('host');
let snapshot = null;

function line(cls, html) {
  const log = el.log;
  const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  const div = log.ownerDocument.createElement('div');
  div.className = cls;
  div.innerHTML = html;
  log.append(div);
  while (log.childElementCount > MAX_LINES) log.firstElementChild.remove();
  if (atEnd) log.scrollTop = log.scrollHeight;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function showHost(host) {
  if (!host || host === shownHost && el.host.textContent) return;
  if (el.host.textContent) line('sep', '→ ' + esc(host));
  shownHost = host;
  el.host.textContent = host;
  el.app.ownerDocument.title = document.title = 'tab2ping – ' + host;
}

// The stream this window shows: the icon's with AUTO, otherwise its own.
const streamId = () => auto ? 'icon' : 'held';

function setAuto(on) {
  auto = on;
  el.follow.textContent = auto ? 'auto' : '';
  port.postMessage({ type: 'hold', host: auto ? null : shownHost });
  if (auto && snapshot?.icon) showHost(snapshot.icon.host);
}
chrome.storage.local.get({ auto: true }).then(s => setAuto(s.auto));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'auto' in changes) setAuto(changes.auto.newValue);
});

port.onMessage.addListener(s => {
  snapshot = s;
  if (s.helper === 'missing') { el.dot.className = 'dot'; el.host.textContent ||= shownHost || ''; return; }
  const stream = s[streamId()];
  if (stream) showHost(stream.host);
  else if (auto) el.dot.className = 'dot';   // active tab without a web page: nothing to ping
  const e = s.event;
  if (!e || e.id !== streamId()) return;
  el.dot.className = 'dot ' + e.state;
  const time = new Date(e.at).toLocaleTimeString('de-DE');
  const detail = e.state === 'up' ? ' ' + e.ms.toFixed(e.ms < 10 ? 1 : 0) + ' ms' : e.state === 'error' && e.text ? ': ' + esc(e.text) : '';
  // The host stands in the header; a change gets its own "→ host" line.
  line(e.state, `<span class="t">${time}</span> <span class="s">${LABELS[e.state]}${detail}</span>`);
});
el.host.textContent = shownHost || '';

// Opened under the mouse right after the click on BROWSER: the next click anywhere pins it.
async function pin() {
  if (!el.app.classList.contains('unpinned')) return;
  el.app.classList.remove('unpinned');
  let pip;
  try {
    pip = await documentPictureInPicture.requestWindow({ width: innerWidth, height: innerHeight });
  } catch {
    el.app.classList.add('unpinned');   // e.g. another picture-in-picture window is open: try again
    return;
  }
  pip.document.title = document.title;
  // The picture-in-picture document is about:blank: the stylesheet needs its full address there.
  const sheet = el.sheet.cloneNode();
  sheet.href = chrome.runtime.getURL('style.css');
  pip.document.head.append(sheet, el.style.cloneNode(true));
  pip.document.body.append(el.app);
  el.log.scrollTop = el.log.scrollHeight;   // moving it reset the scroll position
  el.pin.hidden = true;
  // The window behind it isn't needed while pinned (it stays, minimized: it owns the pinned one and
  // the connection to the worker). Closing the pinned window ends everything.
  chrome.windows.getCurrent().then(w => chrome.windows.update(w.id, { state: 'minimized' }));
  pip.addEventListener('pagehide', () => window.close());
}
document.addEventListener('click', pin);
document.addEventListener('keydown', e => {   // a key press is a user activation too
  if (e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  pin();
});
