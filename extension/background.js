// tab2ping service worker. MOCKUP (feature/mockup): without the native helper there is no real
// ping, so a HEAD request to the host stands in for it. It tells "answers" (web server replied),
// "error" (fast failure: refused, certificate, unknown name) and "timeout" (nothing came back).

const TIMEOUT_MS = 2000;
const COLORS = { up: '#2e9e44', error: '#e08a00', timeout: '#d43c2f', none: '#9a9a9a' };

// The last web page (http/https) the user looked at: the target of every "auto" display. Kept in
// session storage, as the worker may be suspended between probes.
async function getLastTarget() {
  return (await chrome.storage.session.get({ lastTarget: null })).lastTarget;
}
async function noteTab(tab) {
  const target = targetOf(tab?.url);
  if (!target) return;
  const { iconOrigin } = await chrome.storage.session.get({ iconOrigin: null });
  await chrome.storage.session.set({ lastTarget: target, iconOrigin: target.origin });
  if (iconOrigin !== target.origin) showState('none');   // until the new host answered, not the old colour
  probeAndShow(target);
}
// Active tab without a web page: grey icon, until a web page is active again. The ping window
// (our own page, or its picture-in-picture window) keeps the previous target.
const OWN_PAGES = chrome.runtime.getURL('');
function noteNoTarget(tab) {
  const url = tab.url || tab.pendingUrl || '';
  if (!url || url.startsWith(OWN_PAGES) || url.startsWith('about:blank')) return;   // still loading, or ours
  chrome.storage.session.set({ iconOrigin: null });
  showState('none');
}

// Host and origin of a tab's URL, or null for pages without one (new tab, settings, about:blank,
// the picture-in-picture window itself).
function targetOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? { host: u.hostname, origin: u.origin } : null;
  } catch {
    return null;
  }
}

async function probe(target) {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    await fetch(target.origin + '/', {
      method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', redirect: 'manual',
      signal: ctrl.signal,
    });
    return { state: 'up', ms: Math.round(performance.now() - t0) };
  } catch {
    if (ctrl.signal.aborted) return { state: 'timeout', ms: TIMEOUT_MS };
    return { state: 'error', ms: Math.round(performance.now() - t0) };
  } finally {
    clearTimeout(timer);
  }
}

// Toolbar icon: a ring with a dot in the state color (no image files needed).
function drawIcon(size, color) {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d');
  const r = size / 2;
  g.strokeStyle = '#666';
  g.lineWidth = size / 10;
  g.beginPath(); g.arc(r, r, r - g.lineWidth, 0, 2 * Math.PI); g.stroke();
  g.fillStyle = color;
  g.beginPath(); g.arc(r, r, r * 0.55, 0, 2 * Math.PI); g.fill();
  return g.getImageData(0, 0, size, size);
}
function showState(state) {
  const color = COLORS[state] || COLORS.none;
  chrome.action.setIcon({ imageData: { 16: drawIcon(16, color), 32: drawIcon(32, color) } }).catch(() => {});
}

// The icon always shows the active web page's host.
async function probeAndShow(target) {
  if (!target) return null;
  const result = await probe(target);
  const { iconOrigin } = await chrome.storage.session.get({ iconOrigin: null });
  if (iconOrigin === target.origin) showState(result.state);
  return result;
}

// The active tab of the focused window, if it shows a web page (focus on the ping window itself or
// on a settings page keeps the previous target).
async function noteActive() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) return;
  if (targetOf(tab.url)) await noteTab(tab);
  else noteNoTarget(tab);
}

// Only the focused window counts: a page navigating in a background window doesn't take over.
async function inFocusedWindow(tab) {
  const w = await chrome.windows.getLastFocused().catch(() => null);
  return w?.id === tab.windowId;
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !(await inFocusedWindow(tab))) return;
  targetOf(tab.url) ? noteTab(tab) : noteNoTarget(tab);
});
chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (!change.url || !tab.active || !(await inFocusedWindow(tab))) return;
  targetOf(change.url) ? noteTab(tab) : noteNoTarget(tab);
});
chrome.windows.onFocusChanged.addListener(id => { if (id !== chrome.windows.WINDOW_ID_NONE) noteActive(); });
// Without an open display nothing probes every second: refresh the icon now and then.
chrome.alarms.create('refresh', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async () => {
  const { iconOrigin } = await chrome.storage.session.get({ iconOrigin: null });
  if (iconOrigin) probeAndShow({ origin: iconOrigin });
});
chrome.runtime.onStartup.addListener(() => { showState('none'); noteActive(); });
chrome.runtime.onInstalled.addListener(() => { showState('none'); noteActive(); });

// Every open display (popup, ping window) asks once a second. auto: the last web page the user
// looked at; otherwise the target it started with.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'probe') return;
  (async () => {
    // auto before any web page was noted (e.g. right after an extension reload): the start target.
    let target = msg.target;
    if (msg.auto) {
      target = (await getLastTarget()) ?? msg.target;
      if (target && !(await getLastTarget())) await chrome.storage.session.set({ lastTarget: target });
    }
    if (!target) return sendResponse({ target: null });
    sendResponse({ target, ...(await probeAndShow(target)) });
  })().catch(() => sendResponse({ target: null }));
  return true;
});
