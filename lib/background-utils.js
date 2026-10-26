'use strict';

// BrowserLink background (service worker) pure helpers.
// Loaded via importScripts() in background.js, and via CommonJS in Vitest.

const SCREENCAST_MAX_WIDTH = 3840;
const SCREENCAST_MAX_HEIGHT = 2160;
const OPENER_AUTO_FOLLOW_MAX_ATTEMPTS = 8;
const OPENER_AUTO_FOLLOW_MAX_PENDING_AGE_MS = 30 * 1000;

function getCaptureSize(width, height, devicePixelRatio = 1) {
  if (!width || !height) {
    return {
      width: SCREENCAST_MAX_WIDTH,
      height: SCREENCAST_MAX_HEIGHT
    };
  }

  const scaleFactor = Math.max(1, Number(devicePixelRatio) || 1);
  const targetWidth = Math.max(1, Math.round(width * scaleFactor));
  const targetHeight = Math.max(1, Math.round(height * scaleFactor));

  const scale = Math.min(
    1,
    SCREENCAST_MAX_WIDTH / targetWidth,
    SCREENCAST_MAX_HEIGHT / targetHeight
  );

  return {
    width: Math.max(1, Math.round(targetWidth * scale)),
    height: Math.max(1, Math.round(targetHeight * scale))
  };
}


// Allowlist, not denylist. A denylist of chrome://, chrome-extension://,
// edge:// and about: silently admitted every other non-web scheme —
// file://, devtools://, chrome-untrusted://, view-source:, chrome-search://,
// data:, blob: — all of which would then be listable, switchable and
// closeable by anyone holding a Viewer URL. Only ordinary web pages are
// capturable.
var CAPTURABLE_PROTOCOLS = ['http:', 'https:'];

// --- Address classification ---
// A public DNS name can resolve to a private address (127.0.0.1.nip.io, or a
// rebinding name that flips between answers), so matching hostnames is not a
// boundary on its own. These helpers classify the addresses a name resolves
// to and the address the tab actually connected to. Everything fails closed:
// input that cannot be parsed is treated as private.

// inet_aton semantics, which is what browsers and resolvers accept: one to
// four parts, each decimal, 0x-hex or 0-prefixed octal, with the last part
// filling the remaining bytes (127.1 is 127.0.0.1). Returns the address as an
// unsigned 32-bit number, or null.
function parseIPv4Address(value) {
  var text = String(value == null ? '' : value).replace(/\.$/, '');
  if (!text) return null;
  var parts = text.split('.');
  if (parts.length > 4) return null;
  var nums = [];
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    var num;
    if (/^0x[0-9a-f]*$/i.test(part)) {
      num = part.length > 2 ? parseInt(part.slice(2), 16) : 0;
    } else if (/^0[0-7]*$/.test(part)) {
      num = parseInt(part, 8);
    } else if (/^[1-9][0-9]*$/.test(part)) {
      num = parseInt(part, 10);
    } else {
      return null;
    }
    if (!Number.isFinite(num)) return null;
    nums.push(num);
  }
  var last = nums.pop();
  for (var j = 0; j < nums.length; j++) {
    if (nums[j] > 255) return null;
  }
  if (last >= Math.pow(256, 4 - nums.length)) return null;
  var result = last;
  for (var k = 0; k < nums.length; k++) {
    result += nums[k] * Math.pow(256, 3 - k);
  }
  return result;
}

// Returns the eight 16-bit groups, or null. Accepts [brackets], a %zone
// suffix and a dotted IPv4 tail (::ffff:127.0.0.1).
function parseIPv6Address(value) {
  var text = String(value == null ? '' : value).trim().replace(/^\[|\]$/g, '');
  var zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (!text || text.indexOf(':') === -1) return null;

  // Rewrite a dotted IPv4 tail as its two hex groups.
  var lastColon = text.lastIndexOf(':');
  var maybeV4 = text.slice(lastColon + 1);
  if (maybeV4.indexOf('.') !== -1) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(maybeV4)) return null;
    var octets = maybeV4.split('.').map(Number);
    if (octets.some(function (o) { return o > 255; })) return null;
    text = text.slice(0, lastColon + 1) +
      (octets[0] * 256 + octets[1]).toString(16) + ':' +
      (octets[2] * 256 + octets[3]).toString(16);
  }

  var halves = text.split('::');
  if (halves.length > 2) return null;
  var parseGroups = function (chunk) {
    if (!chunk) return [];
    return chunk.split(':').map(function (group) {
      return /^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN;
    });
  };
  var head = parseGroups(halves[0]);
  var rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  var groups;
  if (halves.length === 2) {
    var missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = head.concat(new Array(missing).fill(0), rest);
  } else {
    groups = head;
  }
  if (groups.length !== 8 || groups.some(function (g) { return !Number.isFinite(g); })) return null;
  return groups;
}

function isPrivateIPv4Number(n) {
  var a = Math.floor(n / 16777216) % 256;
  var b = Math.floor(n / 65536) % 256;
  var c = Math.floor(n / 256) % 256;
  if (a === 0 || a === 10 || a === 127) return true;           // this-network, RFC1918, loopback
  if (a === 100 && b >= 64 && b <= 127) return true;           // CGNAT 100.64/10
  if (a === 169 && b === 254) return true;                     // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;            // RFC1918
  if (a === 192 && b === 168) return true;                     // RFC1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true;        // benchmarking 198.18/15
  if (a === 198 && b === 51 && c === 100) return true;         // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;          // TEST-NET-3
  if (a >= 224) return true;                                   // multicast, reserved, broadcast
  return false;
}

function isPrivateIPv6Groups(g) {
  var embeddedV4 = function (hi, lo) { return isPrivateIPv4Number(hi * 65536 + lo); };
  var zeroPrefix = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0;
  if (zeroPrefix && g[5] === 0xffff) return embeddedV4(g[6], g[7]); // IPv4-mapped
  if (zeroPrefix && g[5] === 0) {
    if (g[6] === 0 && g[7] <= 1) return true;                       // :: and ::1
    return embeddedV4(g[6], g[7]);                                  // IPv4-compatible (deprecated)
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return embeddedV4(g[6], g[7]);                                  // NAT64 64:ff9b::/96
  }
  // Only global unicast (2000::/3) is public. That excludes ULA fc00::/7,
  // link-local fe80::/10, site-local fec0::/10, multicast ff00::/8, the
  // discard prefix 100::/64 and everything unassigned.
  if ((g[0] & 0xe000) !== 0x2000) return true;
  if (g[0] === 0x2001 && g[1] === 0) return true;                  // Teredo 2001::/32
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;             // documentation
  if ((g[0] & 0xfff0) === 0x3ff0) return true;                     // documentation 3fff::/20
  if (g[0] === 0x2002) return embeddedV4(g[1], g[2]);              // 6to4
  return false;
}

function isPrivateIpAddress(value) {
  if (value == null) return true;
  var text = String(value).trim();
  if (!text) return true;
  var v4 = parseIPv4Address(text);
  if (v4 !== null) return isPrivateIPv4Number(v4);
  var v6 = parseIPv6Address(text);
  if (v6 !== null) return isPrivateIPv6Groups(v6);
  return true;
}

function isIpLiteralHostname(host) {
  return parseIPv4Address(host) !== null || parseIPv6Address(host) !== null;
}

// A name may only be visited when every address it resolves to is public:
// with mixed answers Chrome may connect to any of them.
function evaluateResolvedAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { allowed: false, reason: 'no_addresses' };
  }
  for (var i = 0; i < addresses.length; i++) {
    if (isPrivateIpAddress(addresses[i])) {
      return { allowed: false, reason: 'private_address', address: String(addresses[i]) };
    }
  }
  return { allowed: true };
}

// Parses a DNS JSON API answer (RFC 8484 JSON flavour served by the DoH
// resolvers). Returns the A/AAAA addresses, or null when the lookup failed so
// the caller fails closed.
function parseDnsJsonAddresses(answer) {
  if (!answer || typeof answer !== 'object' || answer.Status !== 0) return null;
  var records = Array.isArray(answer.Answer) ? answer.Answer : [];
  return records
    .filter(function (record) { return record && (record.type === 1 || record.type === 28) && typeof record.data === 'string'; })
    .map(function (record) { return record.data; });
}

// Checks a CDP Network.responseReceived event for a document the tab loaded.
// The remote address is where Chrome actually connected, so it catches a
// name that rebinds between the pre-navigation lookup and the load.
function evaluateConnectedAddress(event) {
  if (!event || event.type !== 'Document' || !event.response) return { private: false };
  var response = event.response;
  var url;
  try {
    url = new URL(response.url);
  } catch (e) {
    return { private: false };
  }
  if (CAPTURABLE_PROTOCOLS.indexOf(url.protocol) === -1) return { private: false };
  var address = response.remoteIPAddress;
  if (!address) {
    // Served without a connection of its own; the hostname policy still
    // applies to where the tab is.
    if (response.fromDiskCache || response.fromServiceWorker || response.fromPrefetchCache) {
      return { private: false };
    }
    return { private: true, reason: 'no_remote_address' };
  }
  if (isPrivateIpAddress(address)) {
    return { private: true, reason: 'private_address', address: String(address) };
  }
  return { private: false };
}

// Private, loopback and link-local destinations are refused too. The Viewer
// URL is a bearer capability that can drive navigate/newTab/switchTab, so
// without this a link holder could use the agent's browser as an interactive
// client for http://127.0.0.1:*, router admin panels, RFC1918 LAN services or
// cloud metadata endpoints reachable from the host machine. Fail closed.
function isPrivateHostname(hostname) {
  if (!hostname) return true;
  // Strip the FQDN root dot(s): new URL('http://localhost.:3000').hostname
  // is 'localhost.', which otherwise slips past every check below.
  var host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');

  if (host === 'localhost' || host === '0.0.0.0') return true;
  // IP literals are classified by value, which covers every range above plus
  // mapped, NAT64, 6to4 and encoded forms the string checks below miss.
  if (isIpLiteralHostname(host)) return isPrivateIpAddress(host);
  // IPv6 loopback and unspecified, plus unique-local (fc00::/7) and
  // link-local (fe80::/10).
  if (host === '::1' || host === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
  // Internal-ish names: bare hostnames with no dot, mDNS, and common
  // internal suffixes.
  if (host.indexOf('.') === -1) return true;
  if (/\.(local|internal|localdomain|home|lan)$/.test(host)) return true;

  var v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    var a = Number(v4[1]);
    var b = Number(v4[2]);
    if (a === 127 || a === 0 || a === 10) return true;             // loopback, this-network, RFC1918
    if (a === 192 && b === 168) return true;                        // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true;               // RFC1918
    if (a === 169 && b === 254) return true;                        // link-local + cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;              // CGNAT
  }
  return false;
}

function isForbiddenTab(tab) {
  if (!tab || !tab.url) return true;
  var parsed;
  try {
    parsed = new URL(tab.url);
  } catch (e) {
    // Unparseable URL — treat as forbidden rather than guessing.
    return true;
  }
  if (CAPTURABLE_PROTOCOLS.indexOf(parsed.protocol.toLowerCase()) === -1) return true;
  return isPrivateHostname(parsed.hostname);
}


// Where a share goes when its captured tab closes. Only a capturable tab is a
// candidate: Chrome activates whatever neighbour is left, which may be a
// loopback or chrome:// tab that the share must not pick up. Returns null when
// nothing capturable remains, so the host can show a no-tab state instead.
function pickReplacementCapturableTab(tabs, options) {
  var closedTabId = options && options.closedTabId;
  var windowId = options && options.windowId;
  var candidates = (Array.isArray(tabs) ? tabs : []).filter(function (tab) {
    return tab && tab.id !== closedTabId && !isForbiddenTab(tab);
  });
  return candidates.find(function (tab) { return tab.active && tab.windowId === windowId; }) ||
    candidates.find(function (tab) { return tab.active; }) ||
    candidates[0] ||
    null;
}

function createSwitchSerializer() {
  let tail = Promise.resolve();

  return function runSerializedSwitch({ beforeSwitch, switchFn, onCancelled } = {}) {
    if (typeof switchFn !== 'function') {
      return Promise.reject(new TypeError('switchFn is required'));
    }

    const run = tail.catch(() => {}).then(async () => {
      if (typeof beforeSwitch === 'function') {
        const allowed = await beforeSwitch();
        if (!allowed) {
          if (typeof onCancelled === 'function') await onCancelled();
          return false;
        }
      }

      const result = await switchFn();
      return result !== false;
    });

    tail = run.catch(() => {});
    return run;
  };
}

function isTransientOpenerAutoFollowTab(tab) {
  if (!tab || !tab.url) return true;
  if (tab.url === 'about:blank') return true;
  return false;
}

function getOpenerAutoFollowDecision(tab, pendingEntry, options = {}) {
  if (!pendingEntry) {
    return { action: 'ignore', reason: 'not-pending' };
  }
  if (!tab || tab.id !== pendingEntry.tabId) {
    return { action: 'cancel', reason: 'missing-tab' };
  }

  if (Object.prototype.hasOwnProperty.call(options, 'capturedTabId') &&
      pendingEntry.openerTabId !== options.capturedTabId) {
    return { action: 'cancel', reason: 'opener-no-longer-captured' };
  }

  if (!isForbiddenTab(tab)) {
    return { action: 'switch', reason: 'capturable' };
  }

  if (isTransientOpenerAutoFollowTab(tab)) {
    const maxAttempts = Number.isFinite(options.maxAttempts)
      ? options.maxAttempts
      : OPENER_AUTO_FOLLOW_MAX_ATTEMPTS;
    const maxPendingAgeMs = Number.isFinite(options.maxPendingAgeMs)
      ? options.maxPendingAgeMs
      : OPENER_AUTO_FOLLOW_MAX_PENDING_AGE_MS;
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    const createdAt = Number.isFinite(pendingEntry.createdAt)
      ? pendingEntry.createdAt
      : null;

    if (createdAt === null && (pendingEntry.attempts || 0) >= maxAttempts) {
      return { action: 'cancel', reason: 'attempts-exhausted' };
    }
    if (createdAt !== null && now - createdAt > maxPendingAgeMs) {
      return { action: 'cancel', reason: 'max-age-exceeded' };
    }

    return { action: 'wait', reason: 'transient-uncapturable' };
  }

  return { action: 'cancel', reason: 'forbidden' };
}

function getViewerTabListQueryInfo() {
  return {};
}

function buildViewerTabList(tabs, capturedTabId) {
  return (Array.isArray(tabs) ? tabs : [])
    .filter((tab) => !isForbiddenTab(tab))
    .map((tab) => ({
      id: tab.id,
      title: tab.title || '',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
      active: tab.id === capturedTabId
    }));
}

// Viewport dimensions arrive over the data channel, which is a bearer-link
// protocol surface — a link holder can send anything, including NaN, zero,
// negatives or absurd sizes, and those flow straight into chrome.windows.update
// and Emulation.setDeviceMetricsOverride. Coerce to a finite integer and clamp
// to a range Chrome can actually honour; return null when there is no sane
// interpretation so the caller can ignore the request.
var VIEWPORT_MIN_DIMENSION = 200;
var VIEWPORT_MAX_DIMENSION = 8192;

function normalizeViewportDimension(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' || typeof value === 'boolean') return null;
  var num = Number(value);
  if (!Number.isFinite(num)) return null;
  var rounded = Math.round(num);
  if (rounded < VIEWPORT_MIN_DIMENSION) return VIEWPORT_MIN_DIMENSION;
  if (rounded > VIEWPORT_MAX_DIMENSION) return VIEWPORT_MAX_DIMENSION;
  return rounded;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildViewerTabList,
    createSwitchSerializer,
    evaluateConnectedAddress,
    evaluateResolvedAddresses,
    isPrivateIpAddress,
    parseDnsJsonAddresses,
    parseIPv4Address,
    parseIPv6Address,
    getCaptureSize,
    getOpenerAutoFollowDecision,
    getViewerTabListQueryInfo,
    isForbiddenTab,
    isPrivateHostname,
    CAPTURABLE_PROTOCOLS,
    normalizeViewportDimension,
    pickReplacementCapturableTab,
    VIEWPORT_MIN_DIMENSION,
    VIEWPORT_MAX_DIMENSION,
    OPENER_AUTO_FOLLOW_MAX_ATTEMPTS,
    OPENER_AUTO_FOLLOW_MAX_PENDING_AGE_MS,
    SCREENCAST_MAX_WIDTH,
    SCREENCAST_MAX_HEIGHT
  };
}
