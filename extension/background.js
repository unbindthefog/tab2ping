// tab2ping service worker. Keeps one connection to the helper (helper/main.swift), which runs the
// pings, and hands the results on:
// - "icon": the host of the active tab in the focused window, pinged as long as the tab is active;
//   its state colours the dot in the toolbar icon and feeds the popup and the ping window with AUTO.
// - "held": the host a ping window keeps while its AUTO is off (one ping window at a time).
// The open connection to the helper also keeps this worker alive.

const HOST_NAME = 'com.unbindthefog.tab2ping';
const COLORS = { up: '#2e9e44', error: '#e08a00', down: '#d43c2f', none: '#9a9a9a' };

let helper = null;           // native port, null while not connected
let helperState = 'unknown'; // 'ok' | 'missing' | 'unknown'
const streams = {};          // id -> { host, result } with result { state, ms, text, at }
const listeners = new Set(); // ports of the popup and the ping window

// --- Helper --------------------------------------------------------------------------------------

function connectHelper() {
  if (helper) return;
  helper = chrome.runtime.connectNative(HOST_NAME);
  helper.onMessage.addListener(onHelperMessage);
  helper.onDisconnect.addListener(() => {
    // Not installed, or gone (e.g. replaced by a new install): pings ended with it.
    console.debug('[tab2ping] helper disconnected:', chrome.runtime.lastError?.message);
    helper = null;
    helperState = 'missing';
    for (const id of Object.keys(streams)) streams[id].result = null;
    showIcon();
    broadcast();
  });
  helper.postMessage({ cmd: 'hello' });
}

function onHelperMessage(msg) {
  if (msg.type === 'hello') {
    helperState = 'ok';
    // Restart the pings that were wanted before the helper answered.
    for (const [id, s] of Object.entries(streams)) helper.postMessage({ cmd: 'ping', id, host: s.host });
    broadcast();
    return;
  }
  if (msg.id === 'terminal') { broadcast({ terminalError: msg.text }); return; }
  const s = streams[msg.id];
  if (!s) return;
  const state = { reply: 'up', timeout: 'down', unreachable: 'down', error: 'error' }[msg.type];
  if (!state) return;   // 'ended': the last state stays (e.g. the error that ended it)
  s.result = { state, ms: msg.ms, text: msg.text, at: Date.now() };
  if (msg.id === 'icon') showIcon();
  broadcast({ event: { id: msg.id, host: s.host, ...s.result } });
}

// Starts or moves a stream; null host stops it.
function setStream(id, host) {
  if (streams[id]?.host === host) return;
  if (!host) {
    delete streams[id];
    helper?.postMessage({ cmd: 'stop', id });
  } else {
    streams[id] = { host, result: null };
    connectHelper();
    if (helperState === 'ok') helper.postMessage({ cmd: 'ping', id, host });
  }
  if (id === 'icon') showIcon();
  broadcast();
}

// --- Toolbar icon --------------------------------------------------------------------------------

// A ring with a dot in the state colour (no image files needed).
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
let shownColor = null;
function showIcon() {
  const color = COLORS[streams.icon?.result?.state] || COLORS.none;
  if (color === shownColor) return;
  shownColor = color;
  chrome.action.setIcon({ imageData: { 16: drawIcon(16, color), 32: drawIcon(32, color) } }).catch(() => {});
}

// --- Active tab ----------------------------------------------------------------------------------

// Host of a web page (http/https), or null.
function hostOf(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.hostname.replace(/^\[(.*)\]$/, '$1') : null;
  } catch {
    return null;
  }
}

// Our own pages and the pinned ping window (about:blank) don't count as the user's tab: focusing
// them keeps the current host.
const OWN = chrome.runtime.getURL('');
function ignored(tab) {
  const url = tab?.url || tab?.pendingUrl || '';
  return !url || url.startsWith(OWN) || url.startsWith('about:blank');
}

async function followActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || ignored(tab)) return;
  setStream('icon', hostOf(tab.url));
}

chrome.tabs.onActivated.addListener(followActiveTab);
chrome.tabs.onUpdated.addListener((tabId, change, tab) => { if (change.url && tab.active) followActiveTab(); });
chrome.windows.onFocusChanged.addListener(id => { if (id !== chrome.windows.WINDOW_ID_NONE) followActiveTab(); });
chrome.runtime.onStartup.addListener(followActiveTab);
chrome.runtime.onInstalled.addListener(followActiveTab);
followActiveTab();   // worker (re)started
showIcon();

// --- Popup and ping window -----------------------------------------------------------------------

// Everything a display needs, plus what just happened.
function snapshot(extra) {
  return { helper: helperState, icon: streams.icon || null, held: streams.held || null, ...extra };
}
function broadcast(extra = {}) {
  for (const port of listeners) port.postMessage(snapshot(extra));
}

chrome.runtime.onConnect.addListener(port => {
  if (port.sender?.id !== chrome.runtime.id) return;
  listeners.add(port);
  port.onDisconnect.addListener(() => {
    listeners.delete(port);
    if (port.name === 'window') setStream('held', null);   // the window's own ping ends with it
  });
  port.onMessage.addListener(msg => {
    if (msg.type === 'retry') connectHelper();             // e.g. the popup waits for an install
    if (msg.type === 'hold') setStream('held', msg.host);  // ping window: AUTO off (null: on)
    if (msg.type === 'terminal' && msg.host) {
      connectHelper();
      helper.postMessage({ cmd: 'terminal', host: msg.host });
    }
  });
  connectHelper();
  port.postMessage(snapshot());
});
