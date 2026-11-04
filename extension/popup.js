// Toolbar popup: the active tab's host with its live dot, and the two ways to keep pinging it.
// Everything comes from the service worker (port "popup"), which holds the helper connection.
const $ = id => document.getElementById(id);
const port = chrome.runtime.connect({ name: 'popup' });
let host = null;      // host of the active tab, as the worker pings it for the icon
let helper = 'unknown';
let auto = true;      // AUTO under BROWSER: the ping window follows the active tab
let terminalError = null;   // stays until TERMINAL is pressed again
const INSTALL = 'curl -fsSL https://github.com/unbindthefog/tab2ping/releases/latest/download/install.sh | sh';
$('command').textContent = INSTALL;
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(INSTALL);
    $('copy').textContent = 'KOPIERT';
    $('copy').classList.add('on');
  } catch {
    $('copy').textContent = 'MARKIEREN UND KOPIEREN';
  }
});

$('version').textContent = 'v' + chrome.runtime.getManifest().version;

function render(s) {
  helper = s.helper;
  host = s.icon?.host || null;
  const r = s.icon?.result;
  $('host').textContent = host || 'Keine Webseite';
  $('dot').className = 'dot ' + (r?.state || '');
  $('ms').textContent = r?.state === 'up' ? Math.round(r.ms) + ' ms' : r?.state === 'down' ? '–' : '';
  const usable = helper === 'ok' && !!host;
  $('browser').disabled = $('terminal').disabled = !usable;
  if (s.terminalError) {
    terminalError = s.terminalError;
    $('terminalLamp').textContent = '';
  }
  $('install').hidden = helper !== 'missing';   // disappears by itself once the helper answers
  if (helper === 'missing') {
    $('note').textContent = '';
  } else if (terminalError) {
    $('note').textContent = 'Terminal ließ sich nicht öffnen: ' + terminalError;
  } else {
    $('note').textContent = r?.state === 'error' ? (r.text || 'Fehler') : '';
  }
}
port.onMessage.addListener(render);

// While the helper is missing, look again every 2 s: the install may happen meanwhile.
setInterval(() => { if (helper === 'missing') port.postMessage({ type: 'retry' }); }, 2000);

chrome.storage.local.get({ auto: true }).then(s => { auto = s.auto; showAuto(); });
function showAuto() {
  $('auto').classList.toggle('on', auto);
  $('auto').setAttribute('aria-pressed', String(auto));
}
$('auto').addEventListener('click', () => {
  auto = !auto;
  chrome.storage.local.set({ auto });   // an open ping window follows at once
  showAuto();
});

// The ping window opens centred under the mouse: the next click there pins it on top (only a click
// in that window may open the pinned window, see ping.js). From the keyboard: centre of the screen.
$('browser').addEventListener('click', async e => {
  $('browser').disabled = true;
  const width = 340, height = 260;
  const left0 = screen.availLeft ?? 0, top0 = screen.availTop ?? 0;
  const x = e.detail ? e.screenX : left0 + screen.availWidth / 2;
  const y = e.detail ? e.screenY : top0 + screen.availHeight / 2;
  const clamp = (v, min, size, avail) => Math.round(Math.min(Math.max(v, min), min + avail - size));
  try {
    await chrome.windows.create({
      url: 'ping.html?' + new URLSearchParams({ host }), type: 'popup', width, height,
      left: clamp(x - width / 2, left0, width, screen.availWidth),
      top: clamp(y - height / 2, top0, height, screen.availHeight),
    });
    window.close();
  } catch {
    $('browser').disabled = false;
  }
});

// The helper opens Terminal with ping; the first time, macOS asks whether tab2ping may control it.
$('terminal').addEventListener('click', () => {
  terminalError = null;
  port.postMessage({ type: 'terminal', host });
  $('terminalLamp').textContent = 'GEÖFFNET';
  $('terminalLamp').className = 'lamp info';
});
