// Ping window: one line per second, like ping in a terminal. With AUTO (switched under the BROWSER
// key, takes effect at once) it follows the web page the user looks at; without, it stays on the
// host it shows. The pin moves the content into a picture-in-picture window, the only kind of
// window a page may keep on top of all others.
const params = new URLSearchParams(location.search);
let auto = true;
let held = { host: params.get('host'), origin: params.get('origin') };   // the host kept without AUTO
// References kept: once pinned, the elements live in the other window's document.
const el = Object.fromEntries(['app', 'dot', 'host', 'follow', 'pin', 'log', 'sheet', 'style'].map(id => [id, document.getElementById(id)]));
const LABELS = { up: 'antwortet', error: 'Fehler', timeout: 'Zeitüberschreitung' };
const MAX_LINES = 200;

let shownOrigin = null;
let timerWin = window;   // whose timer runs the probes (the pinned window stays visible, so unthrottled)
let timer = null;
let busy = false;        // a probe can take up to 2 s: no second one meanwhile

function showAuto() { el.follow.textContent = auto ? 'auto' : ''; }
// Probing starts once AUTO is known, so the first line already has the right host.
const autoKnown = chrome.storage.local.get({ autoBrowser: true }).then(s => { auto = s.autoBrowser; showAuto(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('autoBrowser' in changes)) return;
  auto = changes.autoBrowser.newValue;
  showAuto();
});

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
    r = await chrome.runtime.sendMessage({ type: 'probe', auto, target: held });
  } catch {
    // e.g. the extension was reloaded: this window can't ask any more
  } finally {
    busy = false;
  }
  if (!r?.target) { if (!shownOrigin) el.host.textContent = 'Keine Webseite'; return; }
  if (r.target.origin !== shownOrigin) {
    if (shownOrigin) line('sep', '→ ' + esc(r.target.host));
    shownOrigin = r.target.origin;
    held = r.target;   // switching AUTO off keeps the host shown now
    el.host.textContent = r.target.host;
    el.app.ownerDocument.title = document.title = 'tab2ping – ' + r.target.host;
  }
  el.dot.className = 'dot ' + r.state;
  const time = new Date().toLocaleTimeString('de-DE');
  const ms = r.state === 'timeout' ? '' : ' ' + r.ms + ' ms';
  // The host stands in the header; a change gets its own "→ host" line.
  line(r.state, `<span class="t">${time}</span> <span class="s">${LABELS[r.state]}${ms}</span>`);
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
  // The picture-in-picture document is about:blank: the stylesheet needs its full address there.
  const sheet = el.sheet.cloneNode();
  sheet.href = chrome.runtime.getURL('style.css');
  pip.document.head.append(sheet, el.style.cloneNode(true));
  pip.document.body.append(el.app);
  el.log.scrollTop = el.log.scrollHeight;   // moving it reset the scroll position
  // Brave may zoom the picture-in-picture window differently from this one (e.g. the default page
  // zoom): keep the content the size it had here.
  const ratio = pip.devicePixelRatio / devicePixelRatio;
  if (Math.abs(ratio - 1) > 0.01) el.app.style.fontSize = (12 / ratio).toFixed(2) + 'px';
  // MOCKUP diagnosis: why the pinned window looks bigger in some profiles.
  const f = w => w.getComputedStyle(el.app).fontSize;
  line('sep', `Diagnose: dpr ${devicePixelRatio} → ${pip.devicePixelRatio}, Breite ${innerWidth} → ${pip.innerWidth}, `
    + `Schrift ${f(pip)}, Fenster ${pip.outerWidth}×${pip.outerHeight}`);
  el.pin.hidden = true;
  run(pip);
  // The window behind it isn't needed while pinned; closing the pinned window ends everything.
  chrome.windows.getCurrent().then(w => chrome.windows.update(w.id, { state: 'minimized' }));
  pip.addEventListener('pagehide', () => window.close());
});

autoKnown.finally(() => { tick(); run(window); });
