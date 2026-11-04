// Toolbar popup: the active tab's host with a live dot, and the two ways to keep pinging it.
const $ = id => document.getElementById(id);

let target = null;   // { host, origin } of the active tab, or null
let busy = false;    // a probe can take up to 2 s: no second one meanwhile

function targetOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? { host: u.hostname, origin: u.origin } : null;
  } catch {
    return null;
  }
}

function render(r) {
  $('dot').className = 'dot ' + (r?.state || '');
  $('ms').textContent = r?.state === 'timeout' ? '–' : r?.ms != null ? r.ms + ' ms' : '';
}

async function tick() {
  if (!target || busy) return;
  busy = true;
  try {
    render(await chrome.runtime.sendMessage({ type: 'probe', auto: false, target }));
  } catch {
    render(null);
  } finally {
    busy = false;
  }
}

// Host as typed in a terminal, or null if it could do more there than name a host: browsers allow
// characters like ; $ ( ) in host names. IPv6 without its brackets.
function shellHost(host) {
  const h = host.replace(/^\[(.*)\]$/, '$1');
  return /^[A-Za-z0-9._:-]+$/.test(h) && !h.startsWith('-') ? h : null;   // '-f' would be an option
}

// AUTO under each key: green when on, dim when off. An open ping window follows the change at once.
const auto = { autoBrowser: true, autoTerminal: false };
function showAuto() {
  for (const k of Object.keys(auto)) {
    $(k).classList.toggle('on', auto[k]);
    $(k).setAttribute('aria-pressed', String(auto[k]));
  }
}
for (const k of Object.keys(auto)) {
  $(k).addEventListener('click', () => {
    auto[k] = !auto[k];
    chrome.storage.local.set({ [k]: auto[k] });
    showAuto();
  });
}

async function init() {
  Object.assign(auto, await chrome.storage.local.get(Object.keys(auto)));
  showAuto();
  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  target = targetOf(tab?.url);
  $('host').textContent = target?.host || 'Keine Webseite';
  $('browser').disabled = $('terminal').disabled = !target;
  tick();
  setInterval(tick, 1000);
}

// A small window with the results; it can be pinned on top from there. Placed top right on the
// screen the popup is on.
$('browser').addEventListener('click', async () => {
  $('browser').disabled = true;   // one window per click
  const params = new URLSearchParams({ host: target.host, origin: target.origin });
  const width = 340, height = 260;
  try {
    await chrome.windows.create({
      url: 'ping.html?' + params, type: 'popup', width, height,
      left: (screen.availLeft ?? 0) + screen.availWidth - width - 20, top: (screen.availTop ?? 0) + 40,
    });
    window.close();
  } catch {
    $('browser').disabled = false;
  }
});

// MOCKUP: without the helper there is no way to open Terminal; the command goes to the clipboard.
$('terminal').addEventListener('click', async () => {
  const host = shellHost(target.host);
  if (!host) { $('note').textContent = 'Dieser Hostname enthält Zeichen, die im Terminal etwas anderes bedeuten würden.'; return; }
  try {
    await navigator.clipboard.writeText('ping ' + host);
  } catch {
    $('note').textContent = 'Kopieren hat nicht geklappt.';
    return;
  }
  $('terminalLamp').textContent = 'KOPIERT';
  $('terminalLamp').className = 'lamp info';
  $('note').textContent = '„ping ' + host + '“ im Terminal einfügen. Mit dem Helfer öffnet tab2ping das Terminal selbst'
    + (auto.autoTerminal ? ' und wechselt den Ping mit dem Tab.' : '.');
});

init();
