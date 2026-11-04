// Ping window: one line per second, like ping in a terminal. With auto it follows the web page the
// user looks at. The pin moves the content into a picture-in-picture window, the only kind of
// window a page may keep on top of all others.
const params = new URLSearchParams(location.search);
const auto = !!params.get('auto');
const startTarget = { host: params.get('host'), origin: params.get('origin') };
// References kept: once pinned, the elements live in the other window's document.
const el = Object.fromEntries(['app', 'dot', 'host', 'follow', 'pin', 'log', 'style'].map(id => [id, document.getElementById(id)]));
const LABELS = { up: 'antwortet', error: 'Fehler', timeout: 'Zeitüberschreitung' };
const MAX_LINES = 200;

let shownOrigin = null;
let timerWin = window;   // whose timer runs the probes (the pinned window stays visible, so unthrottled)
let timer = null;
let busy = false;        // a probe can take up to 2 s: no second one meanwhile

el.follow.textContent = auto ? 'folgt dem Tab' : '';

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

async function tick() {
  if (busy) return;
  busy = true;
  let r = null;
  try {
    r = await chrome.runtime.sendMessage({ type: 'probe', auto, target: startTarget });
  } catch {
    // e.g. the extension was reloaded: this window can't ask any more
  } finally {
    busy = false;
  }
  if (!r?.target) { if (!shownOrigin) el.host.textContent = 'Keine Webseite'; return; }
  if (r.target.origin !== shownOrigin) {
    if (shownOrigin) line('sep', '→ ' + esc(r.target.host));
    shownOrigin = r.target.origin;
    el.host.textContent = r.target.host;
    el.app.ownerDocument.title = document.title = 'tab2ping – ' + r.target.host;
  }
  el.dot.className = 'dot ' + r.state;
  const time = new Date().toLocaleTimeString('de-DE');
  const ms = r.state === 'timeout' ? '' : ' ' + r.ms + ' ms';
  line(r.state, `<span class="t">${time}</span> ${esc(r.target.host)} <span class="s">${LABELS[r.state]}${ms}</span>`);
}

function run(win) {
  if (timer) timerWin.clearInterval(timer);
  timerWin = win;
  timer = timerWin.setInterval(tick, 1000);
}

el.pin.addEventListener('click', async () => {
  let pip;
  try {
    pip = await documentPictureInPicture.requestWindow({ width: innerWidth, height: innerHeight });
  } catch {
    return;   // e.g. another picture-in-picture window is open; the pin stays
  }
  pip.document.title = document.title;
  pip.document.head.append(el.style.cloneNode(true));
  pip.document.body.append(el.app);
  el.log.scrollTop = el.log.scrollHeight;   // moving it reset the scroll position
  el.pin.hidden = true;
  run(pip);
  // The window behind it isn't needed while pinned; closing the pinned window ends everything.
  chrome.windows.getCurrent().then(w => chrome.windows.update(w.id, { state: 'minimized' }));
  pip.addEventListener('pagehide', () => window.close());
});

tick();
run(window);
