// ============================================================
// SHAMIM IPTV — app.js
// ============================================================

const M3U_URL_SHIPTV = "https://raw.githubusercontent.com/shiptv75/SHIPTV/refs/heads/main/playlist.m3u";
const M3U_URL_DEVM3U = "https://m3u.devm3u.top/?u=admin&s=5&p=4545&f=.m3u8";
const M3U_URL = "https://raw.githubusercontent.com/ahan443/FAST-IPTV/refs/heads/main/premium121.m3u";
const M3U_URL_2 = "https://raw.githubusercontent.com/ahan443/FAST-IPTV/refs/heads/main/z.m3u";
const M3U_URL_FANCODE = "https://raw.githubusercontent.com/sportlive18/Fancode-New-Auto-Update/refs/heads/main/fancode.m3u";
const M3U_URL_XNIPTV = "https://raw.githubusercontent.com/tvbd/m3uplayer/refs/heads/main/m3u/xniptv.m3u";
const M3U_URL_NAFITV = "https://raw.githubusercontent.com/nfiptv24-max/NAFITV/refs/heads/main/Nafitv24.m3u";
const M3U_URL_TV9_TOFFEE = "https://tv9.workerbot-tv9.workers.dev/toffee.m3u";
const M3U_URL_SKYTOP = "https://raw.githubusercontent.com/shiptv75/skytop/refs/heads/main/playlist.m3u";
const M3U_URL_JAGOBD = "https://raw.githubusercontent.com/sm-monirulislam/jago_bd_auto_update_playlist-/refs/heads/main/jago_bd.m3u";


// ---- Live Events playlists (rendered in their own auto-scrolling "Live Events" bar) ----
const M3U_URL_TAPMAD = "https://gist.githubusercontent.com/albatr0ssss/3cff7a26be49b1d352c15f615067e7cd/raw/tapmad_bd.m3u";
const M3U_URL_FANCODE_BD = "https://raw.githubusercontent.com/srhady/Fancode-bd/refs/heads/main/main_playlist.m3u";
const M3U_URL_CRICHD = "https://raw.githubusercontent.com/srhady/CricketLive/refs/heads/main/playlist.m3u";
const M3U_URL_WILLOW = "https://raw.githubusercontent.com/srhady/willow-event/refs/heads/main/live_sports.m3u";
const M3U_URL_SONY_LIV = "https://raw.githubusercontent.com/srhady/SonyLiv/refs/heads/main/sonyliv_playlist.m3u";


const M3U_SOURCES = [
  { url: M3U_URL_2, type: "m3u", source: "Z Playlist" },
  { url: M3U_URL_SHIPTV, type: "m3u", source: "SHIPTV" },
  { url: M3U_URL_DEVM3U, type: "m3u", source: "DEV M3U" },
  { url: M3U_URL, type: "m3u", source: "FAST IPTV" },
  { url: M3U_URL_XNIPTV, type: "m3u", source: "XNIPTV" },
  { url: M3U_URL_NAFITV, type: "m3u", source: "NafiTV" },
  { url: M3U_URL_TV9_TOFFEE, type: "m3u", source: "Toffee" },
  { url: M3U_URL_SKYTOP, type: "m3u", source: "SkyTop" },
  { url: M3U_URL_CRICHD, type: "m3u", source: "CRICHD" },
  { url: M3U_URL_FANCODE, type: "m3u", source: "FanCode" },
  { url: M3U_URL_TAPMAD, type: "m3u", source: "TapMad" },
  { url: M3U_URL_WILLOW, type: "m3u", source: "WILLOW" },
  { url: M3U_URL_SONY_LIV, type: "m3u", source: "SONY_LIV" },
  { url: M3U_URL_JAGOBD , type: "m3u", source: "JAGOBD" },

];
const SOURCE_NAMES = M3U_SOURCES.map((s) => s.source);

// Any channel carrying one of these source tags shows up in the "Live Events" bar
const LIVE_EVENTS_SOURCE_TAGS = new Set([
  "TapMad",
  "FanCode",
  "FanCode-BD",
  "WILLOW", 
  "BINGE_STREAM",
  "CRICHD",
]);
// Wraps a real stream URL through the site's own proxy (adds CORS headers and
// spoofs Referer/Origin — what Referer-protected CDNs like FanCode need).
// Used ONLY for URLs from PROXY_SOURCES (see playbackUrl below): routing every
// stream through it earlier broke far more channels than it fixed.
const STREAM_PROXY_BASE = "https://shamimiptv.pages.dev/api/proxy?url=";
function proxyWrapStream(url) {
  if (!url) return url;
  return STREAM_PROXY_BASE + encodeURIComponent(url);
}

// Per-SOURCE proxying (not blanket). Streams from these sources are played
// through the proxy because their CDN rejects direct browser requests
// (FanCode's signed fancode.com links have no CORS headers and check
// Referer) — this is exactly what the old playlist=fancode proxy route used
// to do for them before the proxy was removed. Override from admin-config.json
// with "proxySources": [...] ; use [] to turn it off completely.
let PROXY_SOURCES = new Set(["FanCode", "FanCode-BD"]);
const PROXIED_URLS = new Set(); // raw stream URLs that came from a PROXY_SOURCES playlist

function playbackUrl(url) {
  return PROXIED_URLS.has(url) ? proxyWrapStream(url) : url;
}
function realUrl(url) {
  if (url && url.startsWith(STREAM_PROXY_BASE)) {
    try { return decodeURIComponent(url.slice(STREAM_PROXY_BASE.length)); } catch {}
  }
  return url;
}

const CORS_PROXIES = [
  (u) => u, // try direct first
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

const LS_FAV = "obiram_favorites";

let CHANNELS = [];      // flat list {id,name,group,logo,sources[]}
let GROUPS = [];        // ordered unique group names
let currentChip = "all"; // 'all' | 'favs' | 'pinned' | category key
let currentSourceFilter = "all"; // 'all' | one of SOURCE_NAMES
let currentChannel = null;
let hls = null;
let mpegtsPlayer = null;
let currentSourceIndex = 0;
let retryTimer = null;

// ---- Player engine state (ported from Shamim IPTV Blogger theme) ----
let activeHlsEngineInstance = null;
let activeMpegtsInstance = null;
let currentStreamUrl = null;
let cvCurrentEngine = "auto"; // 'auto' | 'hls' | 'mpegts' | 'native'
let activeChannelIndex = -1;
let currentServerList = [];
let currentServerIndex = 0;
let cvIsSeeking = false;
let cvControlsTimer = null;
let cvStallTimer = null;
let cvVideoCheckTimer = null;

// The user's OWN volume/mute choice. Only the mute button, the volume slider
// and the keyboard shortcuts may change these — never the autoplay fallback —
// so a channel switch always restores what the user actually chose.
let cvUserVolume = 1;
let cvUserMuted = false;

// ---- Split-view (second channel) player state — a deliberately simpler,
// self-contained engine: no quality selector, no server-switch menu, no
// stall watchdog. Just load + play + mute + close. ----
let splitChannel = null;
let splitHlsInstance = null;
let splitMpegtsInstance = null;
let splitServerIndex = 0;
let splitStallTimer = null;

// ---------- Utility ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function toast(msg, ms = 2200) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

function slugify(str) {
  return (str || "chan")
    .toLowerCase()
    .replace(/[^a-z0-9\u0980-\u09FF]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function loadJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v || fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ---------- M3U Parsing ----------
// Handles two real-world patterns from live-updating playlists:
//  1) one #EXTINF followed by several stacked URL lines (fallback servers)
//  2) the same channel repeated as separate #EXTINF blocks, each with one URL
// Both are merged into a single channel with a combined, de-duplicated
// sources[] list so the player's server-fallback UI works either way.
// Also extracts custom tvg-new / tvg-off attributes (added by
// jsonPlaylistToM3U) so "NEW" / "বন্ধ" badges can be shown on the card.
function parseSingleSourceRaw(text) {
  // Some playlists are generated with a bug that writes the literal two
  // characters "\" + "n" instead of a real newline byte — every #EXTINF and
  // its stream URL then end up jammed onto one physical line, which the
  // line-based parser below reads as a single "#"-prefixed line with no
  // URL, silently dropping every entry in the file. Converting those back
  // to real newlines first means a playlist with this bug still loads
  // instead of contributing zero channels.
  const literalNCount = (text.match(/\\n/g) || []).length;
  const realNewlineCount = (text.match(/\n/g) || []).length;
  if (literalNCount > realNewlineCount) {
    text = text.replace(/\\n/g, "\n");
  }
  const lines = text.split(/\r?\n/);
  const raw = [];
  let pending = null;

  for (let ln of lines) {
    const line = ln.trim();
    if (!line || line.startsWith("#EXTM3U")) continue;

    if (line.startsWith("#EXTINF")) {
      if (pending && pending.sources.length) raw.push(pending);

      // The display name follows the LAST attribute's closing quote + comma
      // (e.g. ...group-title="Cricket",Actual Channel Name). Splitting on the
      // FIRST comma instead breaks when an attribute value — like a tvg-logo
      // URL containing "...,1080_.jpeg" — has a comma of its own earlier in
      // the line, which was producing garbled names for some playlists.
      const lastQuoteComma = line.lastIndexOf('",');
      const rawName = lastQuoteComma !== -1
        ? line.slice(lastQuoteComma + 2)
        : (line.match(/,(.*)$/)?.[1] || "Unknown");
      const name = rawName.trim().normalize("NFKC");
      const logoMatch = line.match(/tvg-logo="([^"]*)"/);
      const groupMatch = line.match(/group-title="([^"]*)"/);
      const newMatch = line.match(/tvg-new="1"/);
      const offMatch = line.match(/tvg-off="1"/);

      pending = {
        name: name || "Unknown",
        logo: logoMatch ? logoMatch[1] : "",
        group: (groupMatch && groupMatch[1] ? groupMatch[1] : "অন্যান্য").normalize("NFKC"),
        isNew: !!newMatch,
        isOff: !!offMatch,
        sources: [],
      };
    } else if (line.startsWith("#")) {
      continue;
    } else if (/^https?:\/\//i.test(line)) {
      if (!pending) pending = { name: "Unknown", logo: "", group: "অন্যান্য", isNew: false, isOff: false, sources: [] };
      pending.sources.push(line);
    }
  }
  if (pending && pending.sources.length) raw.push(pending);
  return raw;
}

// Parses + merges every playlist source into one channel list. Channels with
// the same name+group (even across different sources) are combined into a
// single card with a unified sources[] list, a set of contributing
// sourceTags (for the "সার্ভার" filter), a NEW badge if any source flags it,
// and an "off" badge only if every contributing source flags it off.
// Merges by channel NAME only (not name+group) — group labels are
// inconsistent across sources (e.g. "Banglavision" is tagged "Bangla" on
// SHIPTV but "Bangladeshi" on FAST-IPTV), so keying on both would wrongly
// split the same channel into duplicate cards. The most common group among
// contributing sources is kept as the canonical one for categorization.
// A "usable" logo is a real http(s) image URL — this filters out empty
// strings as well as common placeholder/no-image markers some playlists use
// instead of actually omitting the attribute, so a real thumbnail from a
// later-merged source can still win even if an earlier source technically
// supplied a (useless) logo value first.
function hasUsableLogo(url) {
  if (!url || typeof url !== "string") return false;
  const u = url.trim().toLowerCase();
  if (!u) return false;
  if (!/^https?:\/\//.test(u)) return false;
  if (/no[-_]?image|placeholder|default[-_]?logo|blank\.(png|gif|jpg)/.test(u)) return false;
  return true;
}

function mergeAllChannels(sourceResults) {
  PROXIED_URLS.clear();
  const merged = new Map();
  const order = [];

  sourceResults.forEach(({ source, text }) => {
    if (!text) return;
    const rawEntries = parseSingleSourceRaw(text);
    rawEntries.forEach((entry) => {
      // If this raw name is a known alias, merge it under its canonical name
      // instead of its own — this is what lets "Tsports" / "T Sports HD" /
      // etc. from different playlists all land on one single channel card.
      const canonicalName = ADMIN_CHANNEL_ALIASES.get(slugify(entry.name)) || entry.name;
      const key = slugify(canonicalName);
      if (!merged.has(key)) {
        merged.set(key, {
          id: key,
          name: canonicalName.trim(),
          logo: hasUsableLogo(entry.logo) ? entry.logo : "",
          group: entry.group,
          sources: [],
          sourceTags: new Set(),
          isNew: false,
          _offSources: new Set(),
          _allSources: new Set(),
          _groupVotes: new Map(),
        });
        order.push(key);
      }
      const chan = merged.get(key);
      // Prefer any USABLE thumbnail over a missing/placeholder one — checked
      // across every contributing source, not just the first one seen.
      if (!hasUsableLogo(chan.logo) && hasUsableLogo(entry.logo)) chan.logo = entry.logo;
      entry.sources.forEach((s) => {
        if (!chan.sources.includes(s)) chan.sources.push(s);
        if (PROXY_SOURCES.has(source)) PROXIED_URLS.add(s);
      });
      chan.sourceTags.add(source);
      chan._allSources.add(source);
      if (entry.isNew) chan.isNew = true;
      if (entry.isOff) chan._offSources.add(source);
      chan._groupVotes.set(entry.group, (chan._groupVotes.get(entry.group) || 0) + 1);
    });
  });

  return order.map((k) => {
    const chan = merged.get(k);
    chan.isOff = chan._offSources.size > 0 && chan._offSources.size === chan._allSources.size;
    // pick whichever group label was seen most often across contributing sources
    let bestGroup = chan.group, bestCount = -1;
    chan._groupVotes.forEach((count, group) => { if (count > bestCount) { bestCount = count; bestGroup = group; } });
    chan.group = bestGroup;
    delete chan._offSources;
    delete chan._allSources;
    delete chan._groupVotes;

    // A manually-assigned logo (admin-config.json "channelLogos") always wins
    // over whatever the playlists provided, since it's set for exactly the
    // channels where no source has a usable thumbnail.
    const manualLogo = ADMIN_CHANNEL_LOGO.get(chan.id);
    if (manualLogo) chan.logo = manualLogo;

    return chan;
  });
}

// ---------- Fetch playlist with proxy fallback ----------
// Each individual fetch attempt (per proxy, per source) is capped — without
// this, one slow/hanging CORS proxy could stall the entire splash screen for
// a long time since all sources load in parallel and the splash only hides
// once every source has settled.
const PLAYLIST_FETCH_TIMEOUT_MS = 4000;

async function fetchWithTimeout(url, opts = {}, ms = PLAYLIST_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---------- Playlist cache (stale-while-revalidate) ----------
// Raw playlist text is cached per source in localStorage. On the next visit
// within PLAYLIST_CACHE_TTL, init() paints the grid straight from this cache
// (no network wait at all) while a fresh copy loads quietly in the
// background — this is what makes repeat visits feel instant instead of
// waiting on the splash screen for every source to answer over the network.
const PLAYLIST_CACHE_KEY = "obiram_playlist_cache_v1";
const PLAYLIST_CACHE_TTL = 20 * 60 * 1000; // 20 minutes

function cachePlaylistResult(source, text) {
  const cache = loadJSON(PLAYLIST_CACHE_KEY, {});
  cache[source] = { text, ts: Date.now() };
  saveJSON(PLAYLIST_CACHE_KEY, cache);
}
function getFreshCachedPlaylists() {
  const cache = loadJSON(PLAYLIST_CACHE_KEY, {});
  const now = Date.now();
  const out = [];
  for (const src of SOURCE_NAMES) {
    const entry = cache[src];
    if (entry && now - entry.ts < PLAYLIST_CACHE_TTL) out.push({ source: src, text: entry.text });
  }
  return out;
}

// Races all CORS proxies for this source AT THE SAME TIME (instead of trying
// them one by one) and returns whichever responds first with valid content.
// This means a source is only ever as slow as its single fastest proxy,
// rather than the sum of every failed/timed-out attempt before it.
async function fetchOnePlaylist(sourceDef) {
  const { url, type, source } = sourceDef;

  const tryProxy = async (wrap) => {
    const res = await fetchWithTimeout(wrap(url), { cache: "no-store" });
    if (!res.ok) throw new Error("bad status " + res.status);
    if (type === "json") {
      const data = await res.json();
      const m3u = jsonPlaylistToM3U(data);
      if (!m3u) throw new Error("empty json playlist");
      return { source, text: m3u };
    } else {
      const text = await res.text();
      if (!text || !(text.includes("#EXTM3U") || text.includes("#EXTINF"))) throw new Error("not m3u");
      return { source, text };
    }
  };

  try {
    const result = await Promise.any(CORS_PROXIES.map(tryProxy));
    cachePlaylistResult(result.source, result.text);
    return result;
  } catch (e) {
    return null; // every proxy for this source failed
  }
}

// Converts the HridoyTV-style JSON playlist (customChannels + wantedChannels
// that already have a resolvable stream URL) into plain M3U text so it flows
// through the same parser/merger as the other sources. Channels that are
// disabled or freshly marked "new" carry that through as tvg-off / tvg-new
// attributes so the UI can show "বন্ধ" / "NEW" badges.
function jsonPlaylistToM3U(data) {
  const all = [...(data.customChannels || []), ...(data.wantedChannels || [])];
  const lines = ["#EXTM3U"];
  let count = 0;
  const now = Date.now();
  all.forEach((ch) => {
    if (!ch.name) return;
    const sources = [];
    (ch.streams || []).forEach((s) => { if (s && !sources.includes(s)) sources.push(s); });
    (ch.backupStreams || []).forEach((s) => { if (s && !sources.includes(s)) sources.push(s); });
    if (ch.url && !sources.includes(ch.url)) sources.push(ch.url);
    if (!sources.length) return; // skip entries that rely on their private matching backend
    const group = ch.category || "Other";
    const logo = ch.logo || "";
    const isNew = !!ch.isNew && (!ch.newUntil || ch.newUntil > now);
    const isOff = ch.enabled === false;
    sources.forEach((src) => {
      lines.push(`#EXTINF:-1 tvg-logo="${logo}" group-title="${group}" tvg-new="${isNew ? 1 : 0}" tvg-off="${isOff ? 1 : 0}",${ch.name}`);
      lines.push(src);
      count++;
    });
  });
  return count ? lines.join("\n") : null;
}

async function fetchPlaylist() {
  const results = await Promise.all(M3U_SOURCES.map(fetchOnePlaylist));
  const ok = results.filter(Boolean);
  if (!ok.length) throw new Error("প্লেলিস্ট লোড করা যায়নি");
  return ok;
}

// ---------- Splash ----------
function setSplashProgress(pct, msg) {
  $("#splashFill").style.width = pct + "%";
  // splash-sub text element was removed for a more minimal splash screen;
  // msg is still passed in by callers but simply ignored now.
}
function hideSplash() {
  const splash = $("#splash");
  splash.style.opacity = "0";
  splash.style.transition = "opacity .4s ease";
  setTimeout(() => {
    splash.classList.add("hidden");
    $("#app").classList.remove("hidden");
  }, 400);
}

// ---------- Category mapping + chip bar ----------
// Admin config: a small JSON file in the same GitHub repo (NOT in code) —
// edit it directly on GitHub's website to control which channels are
// pinned or hidden, site-wide, for every visitor. No code changes, no
// redeploy of index.html/app.js/style.css ever needed for this.
// File shape: { "pinned": ["T Sports", "Gazi TV"], "hidden": ["Some Channel"] }
// Matching is by channel name, case-insensitive, spaces/punctuation ignored.
const ADMIN_CONFIG_URL = "https://raw.githubusercontent.com/shiptv75/Obiram/main/admin-config.json";
let ADMIN_PINNED_SLUGS = [];
let ADMIN_HIDDEN_SLUGS = [];

const ADMIN_CONFIG_CACHE_KEY = "obiram_admin_config_cache_v1";
const ADMIN_CONFIG_CACHE_TTL = 20 * 60 * 1000; // 20 minutes

function applyAdminConfigData(data) {
  ADMIN_PINNED_SLUGS = (data.pinned || []).map(slugify);
  ADMIN_HIDDEN_SLUGS = (data.hidden || []).map(slugify);

  // Optional: fully custom category list, e.g.
  // "categories": [ { "key":"sports", "label":"🏏 Sports", "match":"sport|cricket" } ]
  // "match" is a regex source (case-insensitive) tested against the channel's
  // playlist group; omit "match" for a category that should only ever be
  // filled manually via "channelCategories" below.
  if (Array.isArray(data.categories) && data.categories.length) {
    CATEGORY_DEFS = data.categories.map((c) => ({
      key: c.key,
      label: c.label,
      match: c.match ? new RegExp(c.match, "i") : null,
    }));
  }

  // Optional: force specific channels into a specific category by name,
  // e.g. "channelCategories": { "Bengali Beats": "entertainment" }
  ADMIN_CHANNEL_CATEGORY = new Map(
    Object.entries(data.channelCategories || {}).map(([name, key]) => [slugify(name), key])
  );

  // Optional: force a specific logo URL for a channel by name — used when no
  // playlist source has a usable thumbnail for it, e.g.
  // "channelLogos": { "ATN Bangla": "https://.../atnbangla.png" }
  ADMIN_CHANNEL_LOGO = new Map(
    Object.entries(data.channelLogos || {}).map(([name, url]) => [slugify(name), url])
  );

  // Optional: collapse differently-spelled duplicates from different
  // playlists into a single channel, e.g.
  // "channelAliases": { "Tsports": "T Sports", "T Sports HD": "T Sports" }
  // Every key here is a raw name AS IT APPEARS in some playlist; the value
  // is the one canonical name/channel everything should merge into. This is
  // applied before merging, so all their sources/logos combine into one card.
  ADMIN_CHANNEL_ALIASES = new Map(
    Object.entries(data.channelAliases || {}).map(([variant, canonical]) => [slugify(variant), canonical])
  );

  // Optional: a manually curated "what's on now" ticker shown inline next
  // to the Live Events title, e.g.
  // "updates": [ { "event": "BPL T20 - 5th Match", "channel": "T Sports" } ]
  // Each entry links an event label to an existing channel by name — the
  // ticker shows that channel's logo and opens it on click.
  ADMIN_UPDATES = Array.isArray(data.updates) ? data.updates : [];

  // Optional: which playlist SOURCES must be played through the proxy, e.g.
  // "proxySources": ["FanCode", "FanCode-BD"]   (empty list = none)
  if (Array.isArray(data.proxySources)) PROXY_SOURCES = new Set(data.proxySources);
}

function getFreshCachedAdminConfig() {
  const cached = loadJSON(ADMIN_CONFIG_CACHE_KEY, null);
  if (cached && Date.now() - cached.ts < ADMIN_CONFIG_CACHE_TTL) return cached.data;
  return null;
}

async function fetchAdminConfig() {
  const tryProxy = async (wrap) => {
    const res = await fetchWithTimeout(wrap(ADMIN_CONFIG_URL), { cache: "no-store" });
    if (!res.ok) throw new Error("bad status " + res.status);
    return res.json();
  };

  try {
    const data = await Promise.any(CORS_PROXIES.map(tryProxy));
    applyAdminConfigData(data);
    saveJSON(ADMIN_CONFIG_CACHE_KEY, { data, ts: Date.now() });
  } catch {
    // file missing or unreachable — just proceed with no pinned/hidden channels
  }
}

// Default categories — used as a fallback until/unless admin-config.json
// supplies its own "categories" list (see fetchAdminConfig below), so the
// site keeps working even if that file is missing or briefly unreachable.
let CATEGORY_DEFS = [
  { key: "sports", label: "🏏 Sports", match: /sport|fifa|cricket|golf|racing|f1\b/i },
  { key: "bangla", label: "🇧🇩 Bangla", match: /^bangla$|bangladeshi/i },
  { key: "news", label: "📰 News", match: /news/i },
  { key: "music", label: "🎵 Music", match: /music/i },
  { key: "movies", label: "🍿 Movies", match: /movie/i },
  { key: "entertainment", label: "🎭 Entertainment", match: /entertainment/i },
  { key: "kids", label: "🧸 Kids", match: /kids/i },
  { key: "lifestyle", label: "📖 Lifestyle", match: /document|lifestyle/i },
  { key: "indian_bangla", label: "🇮🇳 Indian Bangla", match: /indian.?bangla|kolkata/i },
  { key: "religious", label: "🛐 Religious", match: /islamic|religious/i },
];

// Per-channel category overrides from admin-config.json ("channelCategories"),
// keyed by slugified channel name — lets a specific channel be pinned to a
// category regardless of what its playlist group / auto-match would pick.
let ADMIN_CHANNEL_CATEGORY = new Map();
let ADMIN_CHANNEL_LOGO = new Map();
let ADMIN_CHANNEL_ALIASES = new Map();
let ADMIN_UPDATES = [];

function categorize(chan) {
  const override = ADMIN_CHANNEL_CATEGORY.get(slugify(chan.name));
  if (override && CATEGORY_DEFS.some((d) => d.key === override)) return override;
  for (const def of CATEGORY_DEFS) {
    if (def.match && def.match.test(chan.group)) return def.key;
  }
  return "other";
}

function buildGroups() {
  CHANNELS.forEach((c) => {
    c.category = categorize(c);
    c.isPinned = ADMIN_PINNED_SLUGS.includes(slugify(c.name));
    initLiveStatus(c);
  });
}

// ---------- Live status: verified playability, not just "the server answered" ----------
// Why this was rebuilt: the old probe asked the wrong question. For HLS it
// stopped at MANIFEST_PARSED — i.e. "the playlist file parsed", which proves
// nothing at all about the video behind it — and for everything else it only
// asked "did the server return 200?", which countless dead endpoints do while
// serving an error page. That is exactly how a channel ends up wearing an ON
// badge and then failing the moment it is clicked.
//
// A channel is now called ON only after real, playable media has been proved:
//   1. read the playlist, following master -> variant -> media playlist,
//   2. reject codecs this browser cannot decode (e.g. HEVC in Chrome),
//   3. download the first media segment (a few KB) and check that the bytes are
//      actually media — MPEG-TS sync bytes, MP4/FLV/WebM magic — instead of an
//      HTML/JSON error page.
// The check also remembers WHICH source URL proved it, so the player opens the
// working mirror instead of always trying "Server 1" first, and a channel whose
// proof has gone stale is re-proved before it plays. Anything that fails while
// playing is demoted to OFF, so a badge cannot stay wrong for long.
const LIVE_CACHE_KEY = "obiram_stream_status";
const LIVE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
// Bumped when the meaning of a cached result changes. Results written by the
// old manifest-only checker are dropped on load, so no visitor inherits a
// false ON from a previous version of this code.
const LIVE_CACHE_VERSION = 2;
const RECHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
// How many channels are probed at once (each with up to two mirrors racing).
// The probes are small ranged requests now, so this stays gentle while being
// roughly twice as fast as the old 6-at-a-time manifest check.
const MAX_CONCURRENT_PROBES = 10;
// Sources tried per channel during the sweep. The first two mirrors almost
// always cover it, so a dead channel costs two probes instead of five.
const MAX_SOURCES_PER_PROBE = 2;
const RELIST_THROTTLE = 700;
const PROBE_MANIFEST_TIMEOUT = 3000;
const PROBE_SEGMENT_TIMEOUT = 3500;
const PROBE_MAX_PLAYLIST_BYTES = 250000;
const PROBE_SEGMENT_BYTES = 8192;
const PROBE_URL_CACHE_TTL = 2 * 60 * 1000;
// A click only re-verifies when the last proof is older than this; inside the
// window playback starts instantly.
const PLAY_FRESH_MS = 90 * 1000;
const PLAY_CHECK_BUDGET = 7000;
const PROBE_MP4_BOX_TYPES = new Set(["ftyp", "styp", "moof", "moov", "sidx", "emsg", "mdat", "free", "skip"]);

let liveStatusCache = loadJSON(LIVE_CACHE_KEY, {});

// Results are pinned to the checker version that produced them; anything older
// (status only, no proof, no verified source) is discarded here and re-checked.
(function dropStaleStatusCache() {
  let changed = false;
  Object.keys(liveStatusCache).forEach((id) => {
    const entry = liveStatusCache[id];
    if (!entry || entry.v !== LIVE_CACHE_VERSION) {
      delete liveStatusCache[id];
      changed = true;
    }
  });
  if (changed) saveJSON(LIVE_CACHE_KEY, liveStatusCache);
})();

let activeProbes = 0;
const probeQueue = [];
let statusObserver = null;
let statusSaveTimer = null;

// Writing the whole cache after every single channel would stringify a 100 KB
// object well over a thousand times per sweep, so persistence is coalesced.
function persistStatusCacheSoon() {
  if (statusSaveTimer) return;
  statusSaveTimer = setTimeout(() => {
    statusSaveTimer = null;
    pruneStatusCache();
    saveJSON(LIVE_CACHE_KEY, liveStatusCache);
  }, 1200);
}

// Channel names come and go in these playlists, so entries for channels that no
// longer exist would otherwise accumulate in localStorage forever.
function pruneStatusCache() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  Object.keys(liveStatusCache).forEach((id) => {
    const entry = liveStatusCache[id];
    if (!entry || entry.v !== LIVE_CACHE_VERSION || entry.ts < cutoff) delete liveStatusCache[id];
  });
}
window.addEventListener("pagehide", () => {
  if (!statusSaveTimer) return;
  clearTimeout(statusSaveTimer);
  statusSaveTimer = null;
  saveJSON(LIVE_CACHE_KEY, liveStatusCache);
});

// Cached results carry the verified source URL, so a repeat visit can start
// straight on the mirror that worked instead of re-discovering it.
function getCachedStatus(chan) {
  const entry = liveStatusCache[chan.id];
  if (entry && entry.v === LIVE_CACHE_VERSION && Date.now() - entry.ts < LIVE_CACHE_TTL) {
    return { status: entry.status, url: entry.url || null, ts: entry.ts };
  }
  return null;
}
function setCachedStatus(chan, status, url) {
  liveStatusCache[chan.id] = { status, url: url || null, ts: Date.now(), v: LIVE_CACHE_VERSION };
  persistStatusCacheSoon();
}

// Decides each channel's starting badge state before any probing happens.
function initLiveStatus(chan) {
  if (chan.isOff) { chan.liveStatus = "off"; return; } // source explicitly marked it down — authoritative
  const cached = getCachedStatus(chan);
  chan.liveStatus = cached ? cached.status : "checking";
  chan.verifiedUrl = cached ? cached.url : null;
  chan.verifiedAt = cached ? cached.ts : 0;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// ---- one abortable request ----
function probeTimer(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { controller, clear: () => clearTimeout(timer) };
}

async function probeFetch(url, opts = {}) {
  const t = probeTimer(opts.timeoutMs || PROBE_SEGMENT_TIMEOUT);
  const headers = {};
  if (opts.range) headers.Range = opts.range;
  try {
    return await fetch(url, {
      method: "GET",
      headers,
      mode: "cors",
      cache: "no-store",
      redirect: "follow",
      credentials: "omit",
      signal: t.controller.signal,
    });
  } finally {
    t.clear();
  }
}

// Reads at most maxBytes and cancels the rest — a live TS endpoint would
// happily stream forever if it were allowed to.
async function probeReadBytes(res, maxBytes) {
  try {
    if (!res.body || !res.body.getReader) {
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf.slice(0, maxBytes));
    }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < maxBytes) {
      const { value, done } = await reader.read();
      if (done || !value || !value.length) break;
      chunks.push(value);
      size += value.length;
    }
    try { reader.cancel(); } catch {}
    const out = new Uint8Array(Math.min(size, maxBytes));
    let off = 0;
    for (const chunk of chunks) {
      const take = Math.min(chunk.length, out.length - off);
      if (take <= 0) break;
      out.set(chunk.subarray(0, take), off);
      off += take;
    }
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

// ---- playlist parsing ----
function probeResolve(base, relative) {
  try { return new URL(relative, base).href; } catch { return relative; }
}

function probeAttrs(line) {
  const out = {};
  const re = /([A-Za-z0-9_-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(line))) {
    let v = m[2].trim();
    if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
    out[m[1].toUpperCase()] = v;
  }
  return out;
}

function probeHasExtM3u(bytes) {
  const needle = "#EXTM3U";
  const limit = Math.min(bytes.length, 4096) - needle.length;
  for (let i = 0; i <= limit; i++) {
    let match = true;
    for (let k = 0; k < needle.length; k++) {
      if (bytes[i + k] !== needle.charCodeAt(k)) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

// Rejects playlists whose video codec this browser cannot decode at all.
// Without this, a perfectly reachable HEVC channel counts as ON and then plays
// audio only (or nothing) on Chrome — another "ON but useless" case.
function probeCodecsPlayable(codecs) {
  if (!codecs) return true;
  const list = String(codecs).split(",").map((c) => c.trim()).filter(Boolean);
  if (!list.length) return true;
  const mime = `video/mp4; codecs="${list.join(",")}"`;
  let proven = false;
  let judged = false; // did this browser give a usable answer at all?

  try {
    if (window.MediaSource && typeof MediaSource.isTypeSupported === "function") {
      judged = true;
      if (MediaSource.isTypeSupported(mime)) proven = true;
    }
  } catch {}
  try {
    const video = document.createElement("video");
    if (video.canPlayType) {
      const verdict = video.canPlayType(mime);
      if (typeof verdict === "string") judged = true;
      if (verdict) proven = true; // "maybe" / "probably"
    }
  } catch {}

  if (proven) return true;
  // A browser that cannot answer must never have channels hidden because of it.
  if (!judged) return true;
  // Positively unsupported here: only distrust codecs that really are
  // undecodable in practice (HEVC / AV1 / Dolby Vision). H.264 is left alone
  // even in this branch, so one odd codec string can never hide half the site.
  return !/hvc1|hev1|dvh1|dvhe|av01|vp09/i.test(list.join(","));
}

// ---- byte-level verdicts ----
function probeLooksTextual(bytes) {
  const n = Math.min(bytes.length, 256);
  if (!n) return true;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13) { printable++; continue; }
    if (b >= 32 && b <= 126) printable++;
  }
  return printable / n > 0.85;
}

// Decides whether a body is real media. This is the step that turns "the
// server said 200" into actual proof of a playable stream.
function classifyMediaBytes(bytes, contentType, encrypted) {
  const len = bytes.length;
  if (!len) return { ok: false, reason: "empty" };
  const ct = contentType || "";
  if (/text\/html|application\/json|text\/xml/i.test(ct)) return { ok: false, reason: "error-page" };
  if (len < 188) return { ok: false, reason: "too-small" };
  if (probeLooksTextual(bytes)) return { ok: false, reason: "error-page" };

  // MPEG-TS: a 0x47 sync byte every 188 bytes.
  let tsSync = 0;
  for (let i = 0; i < len && i < 188 * 10; i += 188) if (bytes[i] === 0x47) tsSync++;
  if (tsSync >= 2) return { ok: true, kind: "ts" };

  // ISO-BMFF / fragmented MP4: 4-byte box size followed by the box type.
  if (len >= 12) {
    const box = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (PROBE_MP4_BOX_TYPES.has(box)) return { ok: true, kind: "mp4" };
  }
  if (bytes[0] === 0x46 && bytes[1] === 0x4c && bytes[2] === 0x56) return { ok: true, kind: "flv" };
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { ok: true, kind: "webm" };
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return { ok: true, kind: "mp3" };
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return { ok: true, kind: "aac" };

  // AES-encrypted HLS segments are ciphertext, so no magic bytes survive — but
  // a real CDN still answers with a large binary body and a media content
  // type, while an error page is textual and was rejected above.
  const binaryish = /^(video\/|audio\/|application\/(octet-stream|mp2t|mpegurl|x-mpegurl|vnd\.apple\.mpegurl))/i.test(ct);
  if (binaryish && len >= 1024) return { ok: true, kind: encrypted ? "encrypted" : "binary" };
  if (encrypted && len >= 1024) return { ok: true, kind: "encrypted" };
  return { ok: false, reason: "not-media" };
}

async function probePlaylistText(url) {
  let res;
  try {
    res = await probeFetch(url, { timeoutMs: PROBE_MANIFEST_TIMEOUT });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const bytes = await probeReadBytes(res, PROBE_MAX_PLAYLIST_BYTES);
  if (!bytes.length) return null;
  let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.indexOf("#EXTM3U") === -1) return null;
  return text;
}

async function probeSegmentBytes(url, opts = {}) {
  const encrypted = !!opts.encrypted;
  let res;
  try {
    res = await probeFetch(url, { timeoutMs: PROBE_SEGMENT_TIMEOUT, range: `bytes=0-${PROBE_SEGMENT_BYTES - 1}` });
  } catch {
    return { ok: false, reason: "network" };
  }
  // A few CDNs reject Range outright — ask again without it.
  if (res.status === 416) {
    try {
      res = await probeFetch(url, { timeoutMs: PROBE_SEGMENT_TIMEOUT });
    } catch {
      return { ok: false, reason: "network" };
    }
  }
  if (!res.ok) return { ok: false, reason: "http-" + res.status };
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const bytes = await probeReadBytes(res, PROBE_SEGMENT_BYTES);
  return classifyMediaBytes(bytes, contentType, encrypted);
}

function probePickVariant(text, base) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
    const attrs = probeAttrs(line);
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || lines[j].trim().startsWith("#"))) j++;
    const uri = lines[j] ? lines[j].trim() : "";
    if (!uri) continue;
    variants.push({
      url: probeResolve(base, uri),
      bandwidth: parseInt(attrs.BANDWIDTH || "0", 10) || 0,
      codecs: attrs.CODECS || "",
    });
  }
  // Cheapest variant first: it answers fastest and is still proof that the CDN
  // is serving this exact stream right now.
  variants.sort((a, b) => a.bandwidth - b.bandwidth);
  return variants;
}

async function probeMediaPlaylist(text, base, proxied) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let initUrl = null;
  let keyMethod = null;
  const segmentUrls = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith("#EXT-X-MAP:")) {
      const attrs = probeAttrs(line);
      if (attrs.URI) initUrl = probeResolve(base, attrs.URI);
    } else if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = probeAttrs(line);
      if (attrs.METHOD) keyMethod = attrs.METHOD.toUpperCase();
    } else if (line.startsWith("#EXTINF")) {
      let j = i + 1;
      while (j < lines.length && (!lines[j] || lines[j].startsWith("#"))) j++;
      if (lines[j]) segmentUrls.push(probeResolve(base, lines[j]));
    }
  }

  const encrypted = !!keyMethod && keyMethod !== "NONE";
  const request = (u) => (proxied ? proxyWrapStream(u) : u);

  // The LAST segment is the live edge and is the one certain to still exist: on
  // a live playlist the FIRST segment is the oldest and may already have aged
  // out of the CDN's window, which used to mark healthy channels as dead.
  const lastSegment = segmentUrls.length ? segmentUrls[segmentUrls.length - 1] : null;
  const firstSegment = segmentUrls.length ? segmentUrls[0] : null;

  if (lastSegment) {
    const verdict = await probeSegmentBytes(request(lastSegment), { encrypted });
    if (verdict.ok) return { ok: true, kind: verdict.kind, url: request(lastSegment) };
    // A URL-specific refusal is worth one look at the other end of the
    // playlist; a network failure means the whole host is unreachable, so it
    // is pointless (and slow) to ask again.
    if (firstSegment && firstSegment !== lastSegment && /^http-(403|404|410|416)$/.test(verdict.reason || "")) {
      const retry = await probeSegmentBytes(request(firstSegment), { encrypted });
      return retry.ok ? { ok: true, kind: retry.kind, url: request(firstSegment) } : retry;
    }
    if (!initUrl) return verdict;
  }

  // fMP4 single-file layouts can put everything behind EXT-X-MAP; when there is
  // no separate segment URI, the init segment is the only proof available.
  if (initUrl) {
    const initVerdict = await probeSegmentBytes(request(initUrl));
    if (initVerdict.ok) return { ok: true, kind: initVerdict.kind, url: request(initUrl) };
    if (!lastSegment) return initVerdict;
  }
  return { ok: false, reason: "no-segment" };
}

async function probeHlsChain(requestUrl, proxied) {
  let base = realUrl(requestUrl);
  let text = await probePlaylistText(requestUrl);
  if (!text) return { ok: false, reason: "no-playlist" };

  // master -> variant (repeated for master-of-masters, up to a sane depth)
  for (let depth = 0; depth < 3 && /#EXT-X-STREAM-INF/.test(text); depth++) {
    const variants = probePickVariant(text, base);
    if (!variants.length) return { ok: false, reason: "no-variant" };
    const variant = variants.find((v) => probeCodecsPlayable(v.codecs)) || null;
    if (!variant) return { ok: false, reason: "codec-unsupported" };
    base = variant.url;
    text = await probePlaylistText(proxied ? proxyWrapStream(base) : base);
    if (!text) return { ok: false, reason: "variant-unreachable" };
  }
  if (/#EXT-X-STREAM-INF/.test(text)) return { ok: false, reason: "playlist-too-deep" };
  return await probeMediaPlaylist(text, base, proxied);
}

// Entry point: decide whether one source URL is playable right now.
async function probeUrlDeep(rawUrl) {
  const requestUrl = playbackUrl(rawUrl);
  const proxied = requestUrl.startsWith(STREAM_PROXY_BASE);
  const target = realUrl(requestUrl);

  if (/\.m3u8/i.test(target)) return await probeHlsChain(requestUrl, proxied);

  // Not an obvious playlist: sniff a small head of the response. This is what
  // catches both "it is really a TS stream" and "it is an m3u8 served from an
  // extension-less URL".
  let res;
  try {
    res = await probeFetch(requestUrl, { timeoutMs: PROBE_SEGMENT_TIMEOUT, range: "bytes=0-65535" });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (res.status === 416) {
    try {
      res = await probeFetch(requestUrl, { timeoutMs: PROBE_SEGMENT_TIMEOUT });
    } catch {
      return { ok: false, reason: "network" };
    }
  }
  if (!res.ok) return { ok: false, reason: "http-" + res.status };

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const bytes = await probeReadBytes(res, 65536);
  if (!bytes.length) return { ok: false, reason: "empty" };
  if (!/text\/html/i.test(contentType) && probeHasExtM3u(bytes)) {
    return await probeHlsChain(requestUrl, proxied);
  }
  // A plain HTTP stream is never an AES-encrypted HLS segment, so opaque
  // bytes here must not be waved through as "probably media".
  const verdict = classifyMediaBytes(bytes, contentType, false);
  return verdict.ok
    ? { ok: true, kind: verdict.kind, url: requestUrl }
    : { ok: false, reason: verdict.reason, url: requestUrl };
}

// Safari (and older iOS) can play HLS natively even when XHR is blocked by
// CORS, which a fetch-based probe simply cannot see. Worth trying only where
// the failure looked like a network/CORS block, only for HLS, and only a
// limited number of times per sweep so it can never slow everyone else down.
const PROBE_NATIVE_HLS_SUPPORTED = (() => {
  try { return !!document.createElement("video").canPlayType("application/vnd.apple.mpegurl"); } catch { return false; }
})();
let probeNativeBudget = 40;

function probeNativePlayable(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { v.pause(); v.removeAttribute("src"); v.load(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 6000);
    v.muted = true;
    v.preload = "auto";
    v.playsInline = true;
    v.addEventListener("loadedmetadata", () => finish(true), { once: true });
    v.addEventListener("error", () => finish(false), { once: true });
    try { v.src = url; v.load(); } catch { finish(false); }
  });
}

// Results are memoised per source URL: the playlists repeat the same mirrors
// across dozens of channel cards, so one probe answers many channels.
const probeUrlCache = new Map();

function probeUrlCached(rawUrl) {
  const now = Date.now();
  const hit = probeUrlCache.get(rawUrl);
  if (hit && now - hit.ts < PROBE_URL_CACHE_TTL) return hit.promise;

  const promise = (async () => {
    const deep = await probeUrlDeep(rawUrl).catch(() => ({ ok: false, reason: "error" }));
    if (deep.ok) return deep;
    if (PROBE_NATIVE_HLS_SUPPORTED && /\.m3u8/i.test(realUrl(rawUrl)) && deep.reason === "network" && probeNativeBudget > 0) {
      probeNativeBudget--;
      const nativeOk = await probeNativePlayable(playbackUrl(rawUrl));
      if (nativeOk) return { ok: true, kind: "native", url: playbackUrl(rawUrl) };
    }
    return deep;
  })();

  probeUrlCache.set(rawUrl, { ts: now, promise });
  if (probeUrlCache.size > 4000) {
    for (const [key, entry] of probeUrlCache) {
      if (now - entry.ts > PROBE_URL_CACHE_TTL) probeUrlCache.delete(key);
    }
  }
  return promise;
}

// Races every mirror of a channel and resolves on the first one that is proven
// playable — one timeout per channel instead of one per source.
function probeRaceSources(rawUrls) {
  return new Promise((resolve) => {
    const list = (rawUrls || []).filter(Boolean);
    if (!list.length) { resolve({ ok: false, rawUrl: null }); return; }
    let pending = list.length;
    let settled = false;
    list.forEach((rawUrl) => {
      probeUrlCached(rawUrl)
        .then((result) => {
          if (settled) return;
          if (result && result.ok) { settled = true; resolve({ ok: true, rawUrl, kind: result.kind }); return; }
          pending -= 1;
          if (pending === 0) { settled = true; resolve({ ok: false, rawUrl: null }); }
        })
        .catch(() => {
          if (settled) return;
          pending -= 1;
          if (pending === 0) { settled = true; resolve({ ok: false, rawUrl: null }); }
        });
    });
  });
}

async function probeChannelStatus(chan) {
  if (chan.isOff) return; // never override an authoritative source-level off
  const urls = (chan.sources || []).slice(0, MAX_SOURCES_PER_PROBE);
  const result = await probeRaceSources(urls);
  chan.liveStatus = result.ok ? "on" : "off";
  chan.verifiedUrl = result.ok ? result.rawUrl : null;
  chan.verifiedAt = result.ok ? Date.now() : 0;
  setCachedStatus(chan, chan.liveStatus, chan.verifiedUrl);
  updateCardStatusBadge(chan);
  onStatusResolved();
}

// Reality disagreed with the badge: the player could not get this channel
// going. Demote it immediately so the next visitor is not sent down the same
// dead end, and let the grid hide it like any other dead channel.
function markChannelDead(chan) {
  if (!chan) return;
  chan.liveStatus = "off";
  chan.verifiedUrl = null;
  chan.verifiedAt = 0;
  setCachedStatus(chan, "off", null);
  updateCardStatusBadge(chan);
  updateChipCounts();
  onStatusResolved();
}

// The video element really produced playback — the strongest proof there is.
function markChannelLive(chan, rawUrl) {
  if (!chan) return;
  chan.liveStatus = "on";
  if (rawUrl) chan.verifiedUrl = rawUrl;
  chan.verifiedAt = Date.now();
  setCachedStatus(chan, "on", chan.verifiedUrl);
  updateCardStatusBadge(chan);
}

// Called just before playback. Returns a raw source URL that is playable right
// now, or null. This is what stops a stale ON badge from opening a dead player.
async function probeChannelNow(chan) {
  if (!chan) return null;
  const urls = (chan.sources || []).slice(0, 3);
  if (!urls.length) return null;
  const result = await withTimeout(probeRaceSources(urls), PLAY_CHECK_BUDGET);
  return result && result.ok ? result.rawUrl : null;
}

function updateCardStatusBadge(chan) {
  const card = document.querySelector(`.chan-card[data-id="${chan.id}"]`);
  if (!card) return;
  const badge = card.querySelector(".chan-status");
  if (!badge) return;
  badge.className = "chan-status " + statusClass(chan.liveStatus);
  badge.textContent = statusText(chan.liveStatus);
  card.classList.toggle("is-off", chan.liveStatus === "off");
}

function statusClass(status) {
  if (status === "on") return "status-on";
  if (status === "off") return "status-off";
  return "status-checking";
}
function statusText(status) {
  if (status === "on") return "ON";
  if (status === "off") return "OFF";
  return "•••";
}

function runProbeQueue() {
  while (activeProbes < MAX_CONCURRENT_PROBES && probeQueue.length) {
    const chan = probeQueue.shift();
    chan._queued = false;
    if (chan.liveStatus !== "checking") continue;
    activeProbes++;
    probeChannelStatus(chan).finally(() => { activeProbes--; runProbeQueue(); });
  }
}

// `priority` pushes a channel to the front — used for cards the visitor can
// actually see right now, so those resolve first even mid-sweep.
function enqueueProbe(chan, priority) {
  if (chan.liveStatus !== "checking") return;
  if (chan._queued) {
    if (priority) {
      const i = probeQueue.indexOf(chan);
      if (i > 0) { probeQueue.splice(i, 1); probeQueue.unshift(chan); }
    }
    return;
  }
  chan._queued = true;
  if (priority) probeQueue.unshift(chan);
  else probeQueue.push(chan);
  runProbeQueue();
}

// ---------- Background sweep: every channel, not just visible ones ----------
// Off channels are hidden from the grid, which breaks a purely lazy model: a
// hidden card never scrolls into view, so it could never be re-checked and
// could never come back once it went OFF. Sweeping the whole list in the
// background fixes that and is also what makes the channel counter honest — it
// can only count channels that have been proven playable.
function startStatusSweep() {
  probeNativeBudget = 40;
  const pending = CHANNELS.filter((c) => c.liveStatus === "checking" && !c._queued);
  if (!pending.length) { updateScanProgress(); return; }
  // Pinned first, then the visitor's favourites, then the rest in list order —
  // so the channels someone is most likely to want appear soonest.
  const favs = loadJSON(LS_FAV, []);
  const rank = (c) => (c.isPinned ? 0 : favs.includes(c.id) ? 1 : 2);
  pending.sort((a, b) => rank(a) - rank(b));
  pending.forEach((c) => { c._queued = true; probeQueue.push(c); });
  updateScanProgress();
  runProbeQueue();
}

// Derived from live channel state rather than a running tally, so it can never
// drift out of sync across repeated sweeps.
function scanStats() {
  let done = 0;
  CHANNELS.forEach((c) => { if (c.liveStatus !== "checking") done++; });
  return { done, total: CHANNELS.length };
}

function updateScanProgress() {
  const wrap = $("#scanProgress");
  if (!wrap) return;
  const { done, total } = scanStats();
  if (!total || done >= total) { wrap.classList.add("hidden"); return; }
  wrap.classList.remove("hidden");
  const fill = $("#scanProgressFill");
  if (fill) fill.style.width = Math.round((done / total) * 100) + "%";
  const text = $("#scanProgressText");
  if (text) text.textContent = `চ্যানেল যাচাই করা হচ্ছে… ${done}/${total}`;
}

function onStatusResolved() {
  updateScanProgress();
  scheduleRelist();
}

// Every few minutes, hand back to the sweep any channel whose proof has
// expired. A channel that comes back online flips to ON and un-hides itself on
// its own; one that went down disappears. Skipped while the tab is in the
// background so it never burns a visitor's data when nobody is looking.
function startPeriodicRecheck() {
  setInterval(() => {
    if (document.hidden) return;
    let revived = 0;
    CHANNELS.forEach((c) => {
      if (c.isOff) return;                  // source says it's down — authoritative
      if (c.liveStatus === "checking" || c._queued) return;
      if (getCachedStatus(c)) return;       // cached proof still fresh
      c.liveStatus = "checking";
      revived++;
    });
    if (revived) startStatusSweep();
  }, RECHECK_INTERVAL);
}

function getStatusObserver() {
  if (statusObserver) return statusObserver;
  statusObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const chan = CHANNELS.find((c) => c.id === entry.target.dataset.id);
        if (chan) enqueueProbe(chan, true); // on screen — jump the sweep queue
        statusObserver.unobserve(entry.target);
      });
    },
    { rootMargin: "150px" }
  );
  return statusObserver;
}

// ---------- Off-channel auto-hide (single source of truth) ----------
// Most channels in the merged playlists are dead at any given moment, so the
// site lists only the ones whose stream was actually reachable. Everything that
// shows a channel count or walks the channel list goes through the two helpers
// below, so the grid, the category chips, the source filter, the player's
// channel list and prev/next can never disagree with each other.
const LS_SHOW_OFF = "obiram_show_off_channels";
let SHOW_OFF_CHANNELS = loadJSON(LS_SHOW_OFF, false) === true;

function isChannelVisible(chan) {
  return SHOW_OFF_CHANNELS || chan.liveStatus === "on";
}
function visibleChannels() {
  return CHANNELS.filter(isChannelVisible);
}

function chipCounts() {
  const visible = visibleChannels();
  const visibleIds = new Set(visible.map((c) => c.id));
  const counts = {
    all: visible.length,
    favs: loadJSON(LS_FAV, []).filter((id) => visibleIds.has(id)).length,
    pinned: visible.filter((c) => c.isPinned).length,
    other: 0,
  };
  CATEGORY_DEFS.forEach((d) => (counts[d.key] = 0));
  visible.forEach((c) => { counts[c.category] = (counts[c.category] || 0) + 1; });
  return counts;
}

function renderChipBar() {
  const bar = $("#chipBar");
  const counts = chipCounts();
  const chips = [
    { key: "all", label: "🌐 All" },
    { key: "favs", label: "❤️ Favs" },
    { key: "pinned", label: "📌 Pinned" },
    ...CATEGORY_DEFS,
    { key: "other", label: "📂 Other" },
  ];
  bar.innerHTML = chips
    .map(
      (c) =>
        `<button class="chip${c.key === currentChip ? " active" : ""}" data-key="${c.key}">${c.label} <span class="chip-cnt">${counts[c.key] || 0}</span></button>`
    )
    .join("");
  bar.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => setChip(btn.dataset.key));
  });
  updateChipArrows();
}

// Refreshes just the numbers in the chip bar. Rebuilding the whole bar on every
// resolved probe would reset its horizontal scroll under the visitor's finger.
function updateChipCounts() {
  const counts = chipCounts();
  $$("#chipBar .chip").forEach((btn) => {
    const cnt = btn.querySelector(".chip-cnt");
    if (cnt) cnt.textContent = counts[btn.dataset.key] || 0;
  });
}

// ── left/right arrow navigation for the category chip bar ──
function updateChipArrows() {
  const bar = $("#chipBar");
  const left = $("#chipArrowLeft");
  const right = $("#chipArrowRight");
  if (!bar || !left || !right) return;
  const scrollable = bar.scrollWidth - bar.clientWidth;
  left.classList.toggle("hidden", bar.scrollLeft <= 4);
  right.classList.toggle("hidden", scrollable <= 4 || bar.scrollLeft >= scrollable - 4);
}

function setupChipScrollIndicator() {
  const bar = $("#chipBar");
  const left = $("#chipArrowLeft");
  const right = $("#chipArrowRight");
  if (!bar) return;
  bar.addEventListener("scroll", updateChipArrows, { passive: true });
  window.addEventListener("resize", updateChipArrows);
  window.addEventListener("load", updateChipArrows);
  left?.addEventListener("click", () => bar.scrollBy({ left: -220, behavior: "smooth" }));
  right?.addEventListener("click", () => bar.scrollBy({ left: 220, behavior: "smooth" }));

  // the chip bar's true scrollWidth isn't reliable until fonts/layout fully
  // settle right after first paint — a ResizeObserver plus a couple of
  // deferred checks make sure the arrow shows up correctly on first load,
  // not only after a manual zoom-out/zoom-in forces a reflow.
  if (window.ResizeObserver) {
    new ResizeObserver(() => updateChipArrows()).observe(bar);
  }
  requestAnimationFrame(() => requestAnimationFrame(updateChipArrows));
  setTimeout(updateChipArrows, 300);
  setTimeout(updateChipArrows, 1000);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(updateChipArrows);
  }
}

// ── keep the channel-list sidebar the same height as the player, with its
// own internal scrollbar, instead of stretching the whole page (desktop only) ──
function syncPaneHeights() {
  const playerPane = $("#playerPane");
  const channelPane = document.querySelector(".channel-pane");
  if (!playerPane || !channelPane) return;
  if (playerPane.classList.contains("player-float")) return; // floating size is not the pane size

  if (window.innerWidth <= 860) {
    channelPane.style.maxHeight = "";
    channelPane.style.overflowY = "";
    return;
  }
  channelPane.style.maxHeight = playerPane.offsetHeight + "px";
  channelPane.style.overflowY = "auto";
}

function setupPaneHeightSync() {
  const playerPane = $("#playerPane");
  if (!playerPane) return;
  syncPaneHeights();
  if (window.ResizeObserver) {
    new ResizeObserver(() => syncPaneHeights()).observe(playerPane);
  }
  window.addEventListener("resize", syncPaneHeights);
}

function setChip(key) {
  currentChip = key;
  $$(".chip").forEach((c) => c.classList.toggle("active", c.dataset.key === key));
  $("#searchInput").value = "";
  $("#searchClear").classList.add("hidden");
  applyFilters();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Channel card ----------
function channelCard(chan) {
  const card = document.createElement("div");
  card.className = "chan-card" + (chan.liveStatus === "off" ? " is-off" : "");
  card.dataset.id = chan.id;

  const favs = loadJSON(LS_FAV, []);
  const isFav = favs.includes(chan.id);

  const badgeHtml = chan.liveStatus === "off"
    ? `<span class="chan-badge chan-badge-off">বন্ধ</span>`
    : chan.isNew
    ? `<span class="chan-badge chan-badge-new">NEW</span>`
    : "";

  card.innerHTML = `
    ${chan.isPinned ? `<span class="chan-pin-mark" title="Admin Pinned">📌</span>` : ""}
    <button class="chan-fav ${isFav ? "on" : ""}" aria-label="প্রিয়" data-id="${chan.id}">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-10.2-9.2C.3 8.7 1.8 5 5.4 4.3c2-.4 3.9.5 5 2.2l1.6 2.4 1.6-2.4c1.1-1.7 3-2.6 5-2.2 3.6.7 5.1 4.4 3.6 7.5C19.5 16.4 12 21 12 21z"/></svg>
    </button>
    <button class="chan-split-add" aria-label="দ্বিতীয় স্লটে খুলুন" data-id="${chan.id}" title="দ্বিতীয় চ্যানেল হিসেবে চালু করুন">
      <i class="fa-solid fa-plus"></i>
    </button>
    <span class="chan-status ${statusClass(chan.liveStatus)}" title="স্ট্রিম স্ট্যাটাস">${statusText(chan.liveStatus)}</span>
    <div class="chan-icon-box">
      ${badgeHtml}
      ${
        chan.logo
          ? `<img src="${chan.logo}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;chan-logo-fallback&quot;>${chan.name.slice(0, 2).toUpperCase()}</div>'">`
          : `<div class="chan-logo-fallback">${chan.name.slice(0, 2).toUpperCase()}</div>`
      }
    </div>
    <div class="chan-name">${chan.name}</div>
  `;

  card.addEventListener("click", (e) => {
    if (e.target.closest(".chan-fav") || e.target.closest(".chan-split-add")) return;
    if (chan.liveStatus === "off") { toast("এই চ্যানেলটি এখন চালু করা যাচ্ছে না"); return; }
    openPlayer(chan);
  });

  card.querySelector(".chan-fav").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFav(chan.id);
    e.currentTarget.classList.toggle("on");
    updateChipCounts();
    if (currentChip === "favs") applyFilters();
  });

  card.querySelector(".chan-split-add").addEventListener("click", (e) => {
    e.stopPropagation();
    if (chan.liveStatus === "off") { toast("এই চ্যানেলটি এখন চালু করা যাচ্ছে না"); return; }
    openSplitChannel(chan);
  });

  if (chan.liveStatus === "checking") getStatusObserver().observe(card);

  return card;
}

// ---------- Server / source filter menu ----------
function sourceCounts() {
  const visible = visibleChannels();
  const counts = { all: visible.length };
  SOURCE_NAMES.forEach((s) => (counts[s] = 0));
  visible.forEach((c) => c.sourceTags.forEach((s) => (counts[s] = (counts[s] || 0) + 1)));
  return counts;
}

function renderServerFilterMenu() {
  const wrap = $("#serverFilterMenu");
  if (!wrap) return;
  const counts = sourceCounts();

  const items = [{ key: "all", label: "🌐 সব সোর্স" }, ...allSourceNames().map((s) => ({ key: s, label: `🖥️ ${s}` }))];
  wrap.innerHTML = items
    .map(
      (it) =>
        `<button class="server-filter-item${it.key === currentSourceFilter ? " active" : ""}" data-key="${it.key}">${it.label} <span class="chip-cnt">${counts[it.key] || 0}</span></button>`
    )
    .join("");
  wrap.querySelectorAll(".server-filter-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentSourceFilter = btn.dataset.key;
      renderServerFilterMenu();
      closeServerFilterMenu();
      applyFilters();
    });
  });
}

function updateServerFilterCounts() {
  const counts = sourceCounts();
  $$("#serverFilterMenu .server-filter-item").forEach((btn) => {
    const cnt = btn.querySelector(".chip-cnt");
    if (cnt) cnt.textContent = counts[btn.dataset.key] || 0;
  });
}

function toggleServerFilterMenu() { $("#serverFilterMenu")?.classList.toggle("open"); }
function closeServerFilterMenu() { $("#serverFilterMenu")?.classList.remove("open"); }

function setupServerFilterMenu() {
  const btn = $("#serverFilterBtn");
  if (!btn) return;
  btn.addEventListener("click", (e) => { e.stopPropagation(); toggleServerFilterMenu(); });
  document.addEventListener("click", (e) => {
    const menu = $("#serverFilterMenu");
    if (menu && menu.classList.contains("open") && !menu.contains(e.target) && e.target !== btn) {
      closeServerFilterMenu();
    }
  });
}

// ---------- Grid ----------
function renderGrid(list, grouped) {
  const grid = $("#mainGrid");
  grid.innerHTML = "";
  $("#emptyState").classList.toggle("hidden", list.length > 0);

  if (!grouped) {
    list.forEach((c) => grid.appendChild(channelCard(c)));
    return;
  }

  // Grouped view: one sub-section per category (in CATEGORY_DEFS order,
  // "other" last), each with its own heading + count, so "All" reads as an
  // organized channel guide instead of one long mixed list.
  const byCategory = new Map();
  list.forEach((c) => {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(c);
  });

  const orderedKeys = [...CATEGORY_DEFS.map((d) => d.key), "other"];
  orderedKeys.forEach((key) => {
    const items = byCategory.get(key);
    if (!items || !items.length) return;
    const def = CATEGORY_DEFS.find((d) => d.key === key);
    const label = def ? def.label : "অন্যান্য";

    const section = document.createElement("div");
    section.className = "cat-section";
    section.innerHTML = `
      <div class="cat-section-title">${label} <span class="cs-count">${items.length}</span></div>
      <div class="grid icon-grid"></div>
    `;
    const subGrid = section.querySelector(".icon-grid");
    items.forEach((c) => subGrid.appendChild(channelCard(c)));
    grid.appendChild(section);
  });
}

function applyFilters() {
  const q = $("#searchInput").value.trim().toLowerCase();
  // Everything downstream starts from the visible set, so off channels are gone
  // from the grid, from the category totals and from search results alike.
  const pool = visibleChannels();
  let list;
  if (currentChip === "all") list = pool;
  else if (currentChip === "favs") {
    const favs = loadJSON(LS_FAV, []);
    list = favs.map((id) => pool.find((c) => c.id === id)).filter(Boolean);
  } else if (currentChip === "pinned") {
    list = pool.filter((c) => c.isPinned);
  } else {
    list = pool.filter((c) => c.category === currentChip);
  }

  if (currentSourceFilter !== "all") list = list.filter((c) => c.sourceTags.has(currentSourceFilter));

  if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));

  const { done, total } = scanStats();
  const stillScanning = total > 0 && done < total;
  const emptyText = $("#emptyStateText");
  const emptyHint = $("#emptyStateHint");
  const revealBtn = $("#emptyRevealOff");
  // An empty grid means very different things depending on why it's empty —
  // say which, and when it's because everything is off, offer a way out
  // instead of leaving the visitor staring at a dead page.
  let showReveal = false;
  if (currentChip === "favs") {
    emptyText.textContent = "এখনো কোনো প্রিয় চ্যানেল নেই — হার্ট আইকনে ক্লিক করে যোগ করো";
    if (emptyHint) emptyHint.textContent = "চালু চ্যানেলের হার্টে ক্লিক করুন";
  } else if (currentChip === "pinned") {
    emptyText.textContent = "এখনো কোনো পিন করা চ্যানেল নেই";
    if (emptyHint) emptyHint.textContent = "";
  } else if (stillScanning && !SHOW_OFF_CHANNELS) {
    emptyText.textContent = "চ্যানেল স্ট্যাটাস চেক করা হচ্ছে…";
    if (emptyHint) emptyHint.textContent = "চালু চ্যানেলগুলো একটু পরেই দেখা যাবে";
  } else if (!q && !SHOW_OFF_CHANNELS && CHANNELS.length) {
    emptyText.textContent = "এই মুহূর্তে কোনো চ্যানেল চালু নেই";
    if (emptyHint) emptyHint.textContent = "সব চ্যানেলই এখন বন্ধ দেখাচ্ছে";
    showReveal = true;
  } else {
    emptyText.textContent = "কোনো চ্যানেল পাওয়া যায়নি";
    if (emptyHint) emptyHint.textContent = "অন্য নামে খুঁজে দেখুন";
  }
  if (revealBtn) revealBtn.classList.toggle("hidden", !showReveal);

  renderGrid(list, currentChip === "all");
}

function toggleFav(id) {
  let favs = loadJSON(LS_FAV, []);
  if (favs.includes(id)) favs = favs.filter((f) => f !== id);
  else favs.push(id);
  saveJSON(LS_FAV, favs);
}

// ---------- Re-listing as statuses arrive ----------
// Probes resolve in a steady trickle, so re-listing is throttled instead of
// run per result, and the pane's scroll offset is restored afterwards — the
// grid must never jump under someone who is halfway down it.
let relistTimer = null;
let relistPending = false;

function scheduleRelist() {
  if (relistTimer) { relistPending = true; return; }
  relistTimer = setTimeout(() => {
    relistTimer = null;
    const again = relistPending;
    relistPending = false;
    relistNow();
    if (again) scheduleRelist();
  }, RELIST_THROTTLE);
}

function relistNow() {
  const pane = document.querySelector(".channel-pane");
  const paneScroll = pane ? pane.scrollTop : 0;
  const pageScroll = window.scrollY;

  updateChipCounts();
  updateServerFilterCounts();
  applyFilters();
  renderLiveEventsRow();
  renderUpdatesTicker();

  if (pane) pane.scrollTop = paneScroll;
  if (window.scrollY !== pageScroll) window.scrollTo(0, pageScroll);
}

// ---------- "Show off channels" toggle ----------
function setupOffChannelToggle() {
  const btn = $("#offToggleBtn");
  const revealBtn = $("#emptyRevealOff");

  const sync = () => {
    if (!btn) return;
    btn.classList.toggle("on", SHOW_OFF_CHANNELS);
    btn.setAttribute("aria-pressed", SHOW_OFF_CHANNELS ? "true" : "false");
    btn.title = SHOW_OFF_CHANNELS ? "অফ চ্যানেল লুকাও" : "অফ চ্যানেলও দেখাও";
    const label = btn.querySelector(".off-toggle-label");
    if (label) label.textContent = SHOW_OFF_CHANNELS ? "সব চ্যানেল" : "শুধু চালু";
  };

  const setShowOff = (val) => {
    SHOW_OFF_CHANNELS = val;
    saveJSON(LS_SHOW_OFF, SHOW_OFF_CHANNELS);
    sync();
    relistNow();
    toast(SHOW_OFF_CHANNELS ? "অফ চ্যানেলগুলোও দেখানো হচ্ছে" : "শুধু চালু চ্যানেল দেখানো হচ্ছে");
  };

  btn?.addEventListener("click", () => setShowOff(!SHOW_OFF_CHANNELS));
  revealBtn?.addEventListener("click", () => setShowOff(true));
  sync();
}

// ---------- Updates ticker (inline in the Live Events header) ----------
let _tickerResizeBound = false;

function renderUpdatesTicker() {
  const ticker = $("#updatesTicker");
  const track = $("#updatesTickerTrack");
  if (!ticker || !track) return;

  const items = [];
  ADMIN_UPDATES.forEach((u) => {
    if (!u || !u.event || !u.channel) return;
    const chan = CHANNELS.find((c) => c.id === slugify(u.channel));
    if (!chan) return; // referenced channel not currently loaded — skip silently
    items.push({ event: u.event, chan });
  });

  if (!items.length) {
    ticker.classList.add("hidden");
    track.innerHTML = "";
    return;
  }

  ticker.classList.remove("hidden");

  const itemHtml = (it) => {
    const initials = it.chan.name.slice(0, 2).toUpperCase();
    const logoHtml = it.chan.logo
      ? `<img src="${it.chan.logo}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;ut-fallback&quot;>${initials}</div>'">`
      : `<div class="ut-fallback">${initials}</div>`;
    // order: EVENT name · [channel logo] channel name — the logo belongs to the
    // channel, so it sits right next to the channel name, not before the event
    return `<div class="updates-ticker-item" data-chan="${it.chan.id}"><span class="ut-event">${it.event}</span><span class="ut-dot">·</span><span class="ut-chan">${logoHtml}<span class="ut-chan-name">${it.chan.name}</span></span></div>`;
  };

  // Measure one set, then repeat it until a single half is at least as wide
  // as the strip (otherwise a short list would leave an empty gap while it
  // scrolls). The track holds two identical halves and CSS animates it by
  // exactly -50%, so the loop is seamless.
  const setHtml = items.map(itemHtml).join("");
  track.style.animation = "none";
  track.innerHTML = setHtml;
  const setWidth = track.offsetWidth || 400; // 0 if not laid out yet — fall back to a sane guess
  const repeats = Math.min(40, Math.max(1, Math.ceil((ticker.clientWidth || 600) / setWidth)));
  const half = setHtml.repeat(repeats);
  track.innerHTML = half + half;
  track.style.animation = "";
  track.style.animationDuration = `${Math.max(12, (setWidth * repeats) / 45)}s`; // ~45px/s

  track.querySelectorAll(".updates-ticker-item").forEach((el, i) => {
    const chan = items[i % items.length].chan;
    el.addEventListener("click", () => openPlayer(chan));
  });

  if (!_tickerResizeBound) {
    _tickerResizeBound = true;
    let t = null;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(renderUpdatesTicker, 250); });
  }
}

// ---------- Live Events row (SonyLiv / FanCode-BD / Tapmad-Events) ----------
let _liveEventsAutoScrollTimer = null;

function renderLiveEventsRow() {
  const section = $("#liveEventsSection");
  const row = $("#liveEventsRow");
  if (!section || !row) return;

  // The section itself never hides — it always stays in the same place on
  // the page, even if none of its sources loaded or every channel in it is
  // currently off. Only the row's contents depend on live status.
  section.classList.remove("hidden");

  const list = CHANNELS.filter(
    (c) => c.sourceTags && [...c.sourceTags].some((t) => LIVE_EVENTS_SOURCE_TAGS.has(t)) && c.liveStatus === "on"
  );

  row.innerHTML = "";

  if (!list.length) {
    stopLiveEventsAutoScroll();
    return; // row stays empty — section/title/border are still shown
  }

  list.forEach((chan) => {
    const card = document.createElement("div");
    card.className = "mini-chan-card live-event-card";
    const logoHtml = chan.logo
      ? `<img src="${chan.logo}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;chan-logo-fallback&quot;>${chan.name.slice(0, 2).toUpperCase()}</div>'">`
      : `<div class="chan-logo-fallback">${chan.name.slice(0, 2).toUpperCase()}</div>`;
    card.innerHTML = `
      <div class="rc-icon-box">${logoHtml}</div>
      <div class="rc-name">${chan.name}</div>
      <div class="rc-grp">${chan.group}</div>
    `;
    card.addEventListener("click", () => openPlayer(chan));
    row.appendChild(card);
  });

  if (list.length > 1) {
    startLiveEventsAutoScroll(row);
  } else {
    stopLiveEventsAutoScroll();
  }
}

function startLiveEventsAutoScroll(row) {
  stopLiveEventsAutoScroll();

  let paused = false;
  row.addEventListener("mouseenter", () => (paused = true));
  row.addEventListener("mouseleave", () => (paused = false));
  row.addEventListener("touchstart", () => (paused = true), { passive: true });
  row.addEventListener("touchend", () => setTimeout(() => (paused = false), 2000), { passive: true });

  _liveEventsAutoScrollTimer = setInterval(() => {
    if (paused) return;
    const maxScroll = row.scrollWidth - row.clientWidth;
    if (maxScroll <= 0) return;

    if (row.scrollLeft >= maxScroll - 2) {
      row.scrollTo({ left: 0, behavior: "smooth" });
    } else {
      row.scrollBy({ left: 160, behavior: "smooth" });
    }
  }, 3000);
}

function stopLiveEventsAutoScroll() {
  if (_liveEventsAutoScrollTimer) {
    clearInterval(_liveEventsAutoScrollTimer);
    _liveEventsAutoScrollTimer = null;
  }
}

// ---------- Search ----------
function setupHomeButton() {
  const btn = $("#homeBtn");
  if (!btn) return;
  btn.addEventListener("click", () => { closeToolsPage(); setChip("all"); });
}

function setupSearch() {
  const input = $("#searchInput");
  const clearBtn = $("#searchClear");
  input.addEventListener("input", () => {
    clearBtn.classList.toggle("hidden", !input.value.trim());
    applyFilters();
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.classList.add("hidden");
    applyFilters();
    input.focus();
  });
}

// ---------- Help drawer ("চ্যানেল প্লে হচ্ছে না?") ----------
function setupHelpDrawer() {
  const fab = $("#helpFab");
  const overlay = $("#helpOverlay");
  const closeBtn = $("#helpClose");
  fab.addEventListener("click", () => overlay.classList.remove("hidden"));
  closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.add("hidden"); });
}

// ---------- Clock ----------
// ================= PLAYER (ported 1:1 from Shamim IPTV Blogger theme) =================

// ---- entry point: open a channel ----
function openPlayer(chan) {
  currentChannel = chan;
  activeChannelIndex = CHANNELS.findIndex((c) => c.id === chan.id);

  cvInitVideoEvents();
  playChannel(chan);

  // on mobile the player pane sits above the grid — scroll it into view
  if (window.innerWidth <= 860) {
    $("#playerPane")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function closePlayer() {
  clearTimeout(cvStallTimer);
  clearTimeout(cvVideoCheckTimer);
  playRequestToken++; // cancel a channel check that is still in flight
  destroyExistingPlayers();
  cvShowPoster();
  $("#videoError")?.remove();
  $("#player-channel-title").textContent = "Select a Channel to Stream";
  $("#player-channel-status").textContent = "System Engine: Ready";
  currentChannel = null;
}

// ---------- Split view (second channel slot) ----------
function destroySplitPlayers() {
  if (splitHlsInstance) { try { splitHlsInstance.destroy(); } catch {} splitHlsInstance = null; }
  if (splitMpegtsInstance) { try { splitMpegtsInstance.destroy(); } catch {} splitMpegtsInstance = null; }
  const v = $("#splitVideoNode");
  if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch {} }
}

// ---------- Split view (second channel slot) ----------
// Slot B now carries the same chrome as slot A: poster-free video frame, gear
// settings menu, full control bar (progress, play/pause, volume, fullscreen)
// and a metadata strip with the channel logo. It keeps its own small engine
// and state so the two slots never interfere with each other.
let spUserVolume = 1;
let spUserMuted = true;
let spControlsTimer = null;
let spIsSeeking = false;
let spSeekFrac = 0;

function destroySplitPlayers() {
  if (splitHlsInstance) { try { splitHlsInstance.destroy(); } catch {} splitHlsInstance = null; }
  if (splitMpegtsInstance) { try { splitMpegtsInstance.destroy(); } catch {} splitMpegtsInstance = null; }
  const v = $("#splitVideoNode");
  if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch {} }
}

function spVideoEl() { return $("#splitVideoNode"); }

function spShowToast(msg) {
  const t = $("#sp-toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(spShowToast._t);
  spShowToast._t = setTimeout(() => t.classList.remove("show"), 1200);
}

function spSyncPlayIcon() {
  const v = spVideoEl();
  const icon = $("#sp-play-icon");
  if (v && icon) icon.className = "fa-solid " + (v.paused ? "fa-play" : "fa-pause");
}

function spSyncMute() {
  const v = spVideoEl();
  if (!v) return;
  const icon = $("#sp-vol-icon");
  const slider = $("#sp-vol-slider");
  if (slider) slider.value = v.muted ? 0 : v.volume;
  if (!icon) return;
  if (v.muted || v.volume === 0) icon.className = "fa-solid fa-volume-xmark";
  else if (v.volume < 0.4) icon.className = "fa-solid fa-volume-off";
  else if (v.volume < 0.7) icon.className = "fa-solid fa-volume-low";
  else icon.className = "fa-solid fa-volume-high";
}

function spRevealControls() {
  const frame = $("#splitFrame");
  if (!frame) return;
  frame.classList.add("controls-visible");
  clearTimeout(spControlsTimer);
  spControlsTimer = setTimeout(() => frame.classList.remove("controls-visible"), 2500);
}

function openSplitChannel(chan) {
  if (!chan || !chan.sources || !chan.sources.length) { toast("এই চ্যানেলের কোনো সোর্স নেই"); return; }

  splitChannel = chan;
  splitServerIndex = 0;
  spUserMuted = true; // every new second channel starts muted, as before
  $("#playerSplitWrap")?.classList.add("split-active");
  $("#splitShell")?.classList.remove("hidden");

  const title = $("#splitChannelTitle");
  if (title) title.textContent = chan.name;

  const statusEl = $("#sp-channel-status");
  if (statusEl) {
    const sourceList = chan.sourceTags && chan.sourceTags.size ? [...chan.sourceTags].join(", ") : "—";
    statusEl.innerHTML = "▶ Category: <strong>" + (chan.group || "—") + "</strong> &nbsp;·&nbsp; Source: <strong>" + sourceList + "</strong>";
  }

  const logo = $("#sp-logo-frame");
  if (logo) {
    logo.innerHTML = chan.logo
      ? `<img src="${chan.logo}" style="max-width:100%;max-height:100%;object-fit:contain;" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
      : `<i class="fa-solid fa-play" style="font-size:20px;color:var(--cv-primary);"></i>`;
  }

  const video = spVideoEl();
  if (video) {
    video.volume = spUserVolume;
    video.muted = spUserMuted;
    // one set of handlers for the element's whole lifetime — the source
    // switcher below only swaps engines, never re-binds these
    video.onplay = () => spSyncPlayIcon();
    video.onpause = () => spSyncPlayIcon();
    video.onplaying = () => { $("#splitLoader")?.classList.remove("active"); spSyncPlayIcon(); };
    video.onwaiting = () => $("#splitLoader")?.classList.add("active");
    video.oncanplay = () => { $("#splitLoader")?.classList.remove("active"); spUpdateProgress(); };
    video.ontimeupdate = spUpdateProgress;
    video.ondurationchange = spUpdateProgress;
    video.onerror = () => $("#splitLoader")?.classList.remove("active");
  }

  spSyncPlayIcon();
  spSyncMute();
  spUpdateProgress();
  spRevealControls();
  splitLoadServer(0);
}

// Tries chan.sources[index]; if it hasn't actually started playing within 9s,
// automatically moves on to the next source — mirroring the main player's
// stall watchdog.
function splitLoadServer(index) {
  const chan = splitChannel;
  if (!chan || !chan.sources[index]) {
    $("#splitLoader")?.classList.remove("active");
    const statusEl = $("#sp-channel-status");
    if (statusEl) statusEl.textContent = "কোনো সার্ভার পাওয়া যাচ্ছে না";
    toast(`${chan ? chan.name : "চ্যানেল"} — কোনো সার্ভার থেকেই চালু করা যাচ্ছে না`);
    return;
  }

  splitServerIndex = index;
  const url = playbackUrl(chan.sources[index]);
  const video = spVideoEl();
  if (!video) return;

  destroySplitPlayers();
  $("#splitLoader")?.classList.add("active");
  const qsel = $("#sp-quality-select");
  if (qsel) { qsel.innerHTML = '<option value="-1">Auto</option>'; qsel.disabled = true; }
  spRenderSplitServers();

  const tryNative = () => {
    video.src = url;
    video.volume = spUserVolume;
    video.muted = spUserMuted;
    video.play().catch(() => {});
  };

  const tryMpegts = () => {
    if (typeof mpegts === "undefined" || !mpegts.isSupported()) { tryNative(); return; }
    splitMpegtsInstance = mpegts.createPlayer({
      type: "mpegts", url, isLive: true, enableWorker: true, cors: true, withCredentials: false, liveBufferLatencyChasing: true,
    });
    splitMpegtsInstance.attachMediaElement(video);
    splitMpegtsInstance.on(mpegts.Events.ERROR, () => { try { splitMpegtsInstance.destroy(); } catch {} splitMpegtsInstance = null; tryNative(); });
    splitMpegtsInstance.load();
    splitMpegtsInstance.play().catch(() => {});
  };

  const tryHls = () => {
    if (!(window.Hls && Hls.isSupported())) { tryNative(); return; }
    splitHlsInstance = new Hls({
      maxBufferLength: 10, maxMaxBufferLength: 30, maxBufferSize: 30 * 1000 * 1000,
      enableWorker: true, lowLatencyMode: true, startLevel: -1,
      manifestLoadingTimeOut: 10000, manifestLoadingMaxRetry: 2,
      levelLoadingTimeOut: 8000, fragLoadingTimeOut: 10000,
      xhrSetup: (xhr) => { xhr.withCredentials = false; },
    });
    splitHlsInstance.loadSource(url);
    splitHlsInstance.attachMedia(video);
    // slot A has a quality picker, so slot B gets one too — same source of truth
    splitHlsInstance.on(Hls.Events.MANIFEST_PARSED, (evt, data) => {
      const sel = $("#sp-quality-select");
      if (!sel) return;
      const levels = (data && data.levels) || [];
      sel.innerHTML = '<option value="-1">Auto</option>';
      levels.forEach((lvl, i) => {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = lvl.height ? lvl.height + "p" : "Level " + (i + 1);
        sel.appendChild(opt);
      });
      sel.disabled = levels.length <= 1;
    });
    splitHlsInstance.on(Hls.Events.LEVEL_SWITCHED, (evt, data) => {
      const sel = $("#sp-quality-select");
      if (!sel || sel.value !== "-1" || !splitHlsInstance) return;
      const lvl = splitHlsInstance.levels[data.level];
      const autoOpt = sel.querySelector('option[value="-1"]');
      if (autoOpt && lvl) autoOpt.textContent = "Auto (" + (lvl.height ? lvl.height + "p" : "…") + ")";
    });
    splitHlsInstance.on(Hls.Events.ERROR, (evt, data) => { if (data.fatal) { try { splitHlsInstance.destroy(); } catch {} splitHlsInstance = null; tryNative(); } });
    video.play().catch(() => {});
  };

  if (isTsStream(url)) tryMpegts();
  else tryHls();

  clearTimeout(splitStallTimer);
  splitStallTimer = setTimeout(() => {
    if (splitChannel !== chan || splitServerIndex !== index) return; // superseded already
    if (video.readyState >= 2 && !video.paused) return; // actually playing, false alarm
    splitLoadServer(index + 1);
  }, 9000);
}

function spRenderSplitServers() {
  const list = $("#sp-server-list");
  if (!list) return;
  if (!splitChannel || !splitChannel.sources.length) { list.innerHTML = ""; return; }
  list.innerHTML = splitChannel.sources
    .map((_, i) => `<button class="cv-server-item${i === splitServerIndex ? " active" : ""}" type="button" data-i="${i}"><span class="cv-server-dot"></span>Server ${i + 1}</button>`)
    .join("");
  list.querySelectorAll(".cv-server-item").forEach((btn) => {
    btn.addEventListener("click", () => splitLoadServer(Number(btn.dataset.i)));
  });
}

function spBuildSettings() {
  spRenderSplitServers();
}

function spToggleSettings(e) {
  if (e) e.stopPropagation();
  const menu = $("#sp-settings-menu");
  if (!menu) return;
  const open = !menu.classList.contains("open");
  if (open) spBuildSettings();
  menu.classList.toggle("open", open);
  $("#sp-settings-btn")?.setAttribute("aria-expanded", String(open));
}
function spCloseSettings() {
  $("#sp-settings-menu")?.classList.remove("open");
  $("#sp-settings-btn")?.setAttribute("aria-expanded", "false");
}

// Slot B's channel list — the same slide-in panel slot A has, rendered inside
// slot B's own frame and opening channels in slot B.
function spOpenChannelList() {
  spCloseSettings();
  const panel = $("#sp-float-chlist");
  if (!panel) return;
  spRenderFloatChList("");
  panel.classList.add("open");
  const inp = $("#sp-float-search");
  if (inp) { inp.value = ""; inp.focus(); }
}
function spCloseFloatChList() { $("#sp-float-chlist")?.classList.remove("open"); }
function spFloatChSearch(val) { spRenderFloatChList(val); }
function spRenderFloatChList(query) {
  const body = $("#sp-float-chlist-body");
  if (!body) return;
  const q = (query || "").toLowerCase().trim();
  const pool = visibleChannels();
  const filtered = q ? pool.filter((c) => c.name.toLowerCase().includes(q)) : pool;
  body.innerHTML = "";
  if (!filtered.length) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:#555;font-size:12px;">No channels found</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  filtered.forEach((ch, idx) => {
    const item = document.createElement("div");
    item.className = "cv-float-ch-item" + (splitChannel && ch.id === splitChannel.id ? " active" : "");
    const logoHtml = ch.logo
      ? `<img class="cv-float-ch-logo" src="${ch.logo}" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextSibling.style.display='block'"><div class="cv-float-ch-logo-ph" style="display:none"></div>`
      : `<div class="cv-float-ch-logo-ph"></div>`;
    item.innerHTML = `
      <span class="cv-float-ch-num">${idx + 1}</span>
      ${logoHtml}
      <div class="cv-float-ch-info">
        <div class="cv-float-ch-name">${ch.name}</div>
        <div class="cv-float-ch-group">${ch.group}</div>
      </div>
      <span class="cv-float-status-dot"></span>`;
    item.onclick = () => { spCloseFloatChList(); openSplitChannel(ch); };
    frag.appendChild(item);
  });
  body.appendChild(frag);
}

function spTogglePlay() {
  const v = spVideoEl();
  if (!v) return;
  if (v.paused) { v.play().catch(() => {}); spShowToast("▶ Play"); }
  else { v.pause(); spShowToast("⏸ Pause"); }
  spSyncPlayIcon();
}

// Same prev/next cycling as slot A, but over slot B's own channel.
function spStepChannel(dir) {
  const list = visibleChannels();
  if (!list.length) return null;
  let idx = splitChannel ? list.findIndex((c) => c.id === splitChannel.id) : -1;
  if (idx === -1) idx = dir > 0 ? -1 : 0;
  return list[(idx + dir + list.length) % list.length] || null;
}
function spPlayNext() {
  const ch = spStepChannel(1);
  if (!ch) return;
  spShowToast("⏭ " + ch.name);
  openSplitChannel(ch);
}
function spPlayPrev() {
  const ch = spStepChannel(-1);
  if (!ch) return;
  spShowToast("⏮ " + ch.name);
  openSplitChannel(ch);
}

function spToggleMute() {
  const v = spVideoEl();
  if (!v) return;
  v.muted = !v.muted;
  spUserMuted = v.muted;
  spSyncMute();
  spShowToast(v.muted ? "🔇 Muted" : "🔊 Unmuted");
}

function spSetVolume(val) {
  const v = spVideoEl();
  if (!v) return;
  const x = parseFloat(val);
  v.volume = x;
  v.muted = x === 0;
  spUserMuted = v.muted;
  if (x > 0) spUserVolume = x;
  spSyncMute();
}

function spToggleFullscreen() {
  const frame = $("#splitFrame");
  const icon = $("#sp-fs-icon");
  if (!frame) return;
  if (!document.fullscreenElement) {
    frame.requestFullscreen?.().catch(() => {});
    if (icon) icon.className = "fa-solid fa-compress";
    spShowToast("⛶ Fullscreen");
  } else {
    document.exitFullscreen?.();
    if (icon) icon.className = "fa-solid fa-expand";
    spShowToast("↙ Exit Fullscreen");
  }
}

function spSetQuality(val) {
  if (!splitHlsInstance) { spShowToast("এই স্ট্রিমে কোয়ালিটি নেই"); return; }
  splitHlsInstance.currentLevel = parseInt(val, 10);
  const sel = $("#sp-quality-select");
  const label = sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : "Auto";
  spShowToast("Quality: " + label);
}

function spGoLive() {
  const v = spVideoEl();
  if (!v) return;
  try {
    if (v.seekable && v.seekable.length > 0) {
      v.currentTime = v.seekable.end(v.seekable.length - 1) - 1;
      const btn = $("#sp-golive-btn");
      if (btn) btn.style.display = "none";
      spShowToast("● LIVE");
    }
  } catch {}
}

function spTogglePip() {
  const v = spVideoEl();
  if (!v) return;
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  else if (document.pictureInPictureEnabled) v.requestPictureInPicture().catch(() => {});
  else spShowToast("এই ব্রাউজারে PiP সাপোর্ট নেই");
}

function spTakeScreenshot() {
  const v = spVideoEl();
  if (!v) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 1280;
    canvas.height = v.videoHeight || 720;
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
    const link = document.createElement("a");
    link.download = "screenshot-slot-b-" + Date.now() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    spShowToast("📸 Screenshot saved!");
  } catch { spShowToast("⚠ Screenshot failed (CORS)"); }
}

function spSeekFraction(e) {
  const bar = $("#sp-progress-wrap");
  if (!bar) return 0;
  const point = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
  const rect = bar.getBoundingClientRect();
  return Math.max(0, Math.min(1, (point.clientX - rect.left) / rect.width));
}
function spApplySeek(frac) {
  const fill = $("#sp-progress-fill");
  const thumb = $("#sp-progress-thumb");
  if (fill) fill.style.width = frac * 100 + "%";
  if (thumb) thumb.style.left = frac * 100 + "%";
}
function spSeekStart(e) {
  const v = spVideoEl();
  if (!v || !v.duration || !isFinite(v.duration)) return;
  spIsSeeking = true;
  spSeekFrac = spSeekFraction(e);
  spApplySeek(spSeekFrac);
}
function spSeekPreview(e) {
  if (!spIsSeeking) return;
  spSeekFrac = spSeekFraction(e);
  spApplySeek(spSeekFrac);
}
function spSeekEnd() {
  const v = spVideoEl();
  if (!spIsSeeking) return;
  spIsSeeking = false;
  if (v && v.duration && isFinite(v.duration)) v.currentTime = spSeekFrac * v.duration;
  spUpdateProgress();
}

function spUpdateProgress() {
  const v = spVideoEl();
  if (!v || spIsSeeking) return;
  const fill = $("#sp-progress-fill"), thumb = $("#sp-progress-thumb"), buf = $("#sp-progress-buffer");
  const elapsed = $("#sp-elapsed"), durText = $("#sp-duration"), liveBar = $("#sp-progress-live"), liveBtn = $("#sp-golive-btn");
  const dur = v.duration;
  const isLive = !isFinite(dur) || dur === Infinity;
  if (elapsed) elapsed.textContent = cvFmtTime(v.currentTime);
  if (isLive) {
    if (liveBar) liveBar.style.display = "block";
    if (fill) fill.style.width = "0%";
    if (thumb) thumb.style.left = "0%";
    if (buf) buf.style.width = "0%";
    if (durText) durText.textContent = "LIVE";
    try {
      if (v.seekable && v.seekable.length > 0) {
        const edge = v.seekable.end(v.seekable.length - 1);
        if (liveBtn) liveBtn.style.display = (edge - v.currentTime) > 8 ? "flex" : "none";
      }
    } catch {}
  } else {
    if (liveBar) liveBar.style.display = "none";
    if (liveBtn) liveBtn.style.display = "none";
    const frac = dur > 0 ? v.currentTime / dur : 0;
    if (fill) fill.style.width = frac * 100 + "%";
    if (thumb) thumb.style.left = frac * 100 + "%";
    if (durText) durText.textContent = cvFmtTime(dur);
    try {
      if (v.buffered && v.buffered.length > 0 && buf) buf.style.width = (v.buffered.end(v.buffered.length - 1) / dur) * 100 + "%";
    } catch {}
  }
}

function closeSplitChannel() {
  clearTimeout(splitStallTimer);
  clearTimeout(spControlsTimer);
  destroySplitPlayers();
  splitChannel = null;
  spIsSeeking = false;
  const qsel = $("#sp-quality-select");
  if (qsel) { qsel.innerHTML = '<option value="-1">Auto</option>'; qsel.disabled = true; }
  spCloseSettings();
  $("#splitShell")?.classList.add("hidden");
  $("#playerSplitWrap")?.classList.remove("split-active");
  $("#splitFrame")?.classList.remove("controls-visible");
}

// ── same channel selected from grid/float-list/prev-next ──
function playChannel(ch) {
  currentChannel = ch;
  activeChannelIndex = CHANNELS.findIndex((c) => c.id === ch.id);

  const titleEl = $("#player-channel-title");
  if (titleEl) titleEl.textContent = ch.name;
  const statusEl = $("#player-channel-status");
  if (statusEl) {
    const sourceList = ch.sourceTags && ch.sourceTags.size ? [...ch.sourceTags].join(", ") : "—";
    statusEl.innerHTML = `▶ Category: <strong>${ch.group || "—"}</strong> &nbsp;·&nbsp; Source: <strong>${sourceList}</strong>`;
  }
  const logoFrame = $("#player-logo-frame");
  if (logoFrame) {
    logoFrame.innerHTML = ch.logo
      ? `<img src="${ch.logo}" style="max-width:100%;max-height:100%;object-fit:contain;" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
      : `<i class="fa-solid fa-play" style="font-size:20px;color:var(--cv-primary);"></i>`;
  }

  cvBuildServerListFromChannel(ch);
  startChannelPlayback(ch);
}

// ── start playback: instant when the last proof is fresh, otherwise prove a
// mirror works first so a dead stream can never open a broken player ──
let playRequestToken = 0;

async function startChannelPlayback(ch) {
  if (!currentServerList.length) {
    cvShowLoader(false);
    cvShowVideoError();
    return;
  }
  const token = ++playRequestToken;
  const fresh = ch.verifiedUrl && ch.verifiedAt && Date.now() - ch.verifiedAt < PLAY_FRESH_MS;

  if (fresh) {
    cvPrioritizeSource(ch.verifiedUrl);
    cvLoadStreamSource(currentServerList[0].url);
    return;
  }

  // Never verified, or the proof is old: check the mirrors now, in parallel,
  // with a hard time limit so nobody stares at a spinner. The previous
  // channel is silenced first so a failed check cannot leave its audio
  // playing behind the error message.
  clearTimeout(cvStallTimer);
  clearTimeout(cvVideoCheckTimer);
  destroyExistingPlayers();
  currentStreamUrl = null;
  cvShowLoader(true);

  const rawUrl = await probeChannelNow(ch);
  if (token !== playRequestToken) return; // the visitor picked another channel

  if (!rawUrl) {
    cvShowLoader(false);
    cvShowPoster();
    markChannelDead(ch);
    cvShowVideoError();
    cvShowToast("⚠ এই চ্যানেলটি এই মুহূর্তে চলছে না");
    return;
  }

  ch.liveStatus = "on";
  ch.verifiedUrl = rawUrl;
  ch.verifiedAt = Date.now();
  setCachedStatus(ch, "on", rawUrl);
  updateCardStatusBadge(ch);
  cvPrioritizeSource(rawUrl);
  cvLoadStreamSource(currentServerList[0].url);
}

// Move the proven mirror to the front of the server list.
function cvPrioritizeSource(rawUrl) {
  if (!rawUrl) return;
  const idx = currentServerList.findIndex((s) => realUrl(s.url) === rawUrl);
  if (idx > 0) {
    const [item] = currentServerList.splice(idx, 1);
    currentServerList.unshift(item);
    currentServerIndex = 0;
    renderServerMenu();
  }
}

// ── server list is the channel's own merged sources[], each routed through
// our own proxy so protected CDNs (Referer/Origin-checked) still work ──
function cvBuildServerListFromChannel(ch) {
  // Start on the mirror that actually proved playable, not blindly on #1:
  // before this, a channel could be verified through its third mirror while
  // the player always opened the first (dead) one — the classic
  // "shows ON but never loads" case.
  const sources = ch.sources.slice();
  if (ch.verifiedUrl) {
    const verifiedIndex = sources.indexOf(ch.verifiedUrl);
    if (verifiedIndex > 0) { sources.splice(verifiedIndex, 1); sources.unshift(ch.verifiedUrl); }
  }
  currentServerList = sources.map((url, i) => ({ name: `Server ${i + 1}`, url: playbackUrl(url) }));
  currentServerIndex = 0;
  renderServerMenu();
}

function renderServerMenu() {
  const list = $("#cv-server-list");
  if (!list) return;
  list.innerHTML = "";
  if (currentServerList.length <= 1) {
    list.innerHTML = `<div style="padding:10px;font-size:11.5px;color:rgba(255,255,255,0.55);text-align:center;">Only 1 source available</div>`;
    return;
  }
  currentServerList.forEach((s, idx) => {
    const item = document.createElement("div");
    item.className = "cv-server-item" + (idx === currentServerIndex ? " active" : "");
    item.innerHTML = `<span class="cv-server-dot"></span>Server ${idx + 1}`;
    item.onclick = (e) => { e.stopPropagation(); cvSwitchServer(idx); };
    list.appendChild(item);
  });
}

function cvSwitchServer(idx) {
  if (!currentServerList[idx]) return;
  currentServerIndex = idx;
  renderServerMenu();
  cvShowToast(`🔁 Server ${idx + 1}`);
  cvLoadStreamSource(currentServerList[idx].url);
  closeServerMenu();
}

// ── settings menu (everything that used to be a separate right-side icon) ──
function cvToggleSettings(e) {
  if (e) e.stopPropagation();
  const menu = $("#cv-settings-menu");
  if (!menu) return;
  const open = !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  $("#cv-settings-btn")?.setAttribute("aria-expanded", String(open));
}
function cvOpenSettings() {
  $("#cv-settings-menu")?.classList.add("open");
  $("#cv-settings-btn")?.setAttribute("aria-expanded", "true");
}
function cvCloseSettings() {
  $("#cv-settings-menu")?.classList.remove("open");
  $("#cv-settings-btn")?.setAttribute("aria-expanded", "false");
}
// Opens the floating channel list from the settings menu (menu closes first so
// the two overlays never sit on top of each other).
function cvOpenChannelListFromSettings() {
  cvCloseSettings();
  cvOpenFloatChList();
}

// Legacy entry points — the old server dropdown is part of the settings menu now.
function toggleServerMenu() { cvToggleSettings(); }
function closeServerMenu() { cvCloseSettings(); }

document.addEventListener("click", (e) => {
  const menu = $("#cv-settings-menu");
  const btn = $("#cv-settings-btn");
  if (menu && menu.classList.contains("open") && !menu.contains(e.target) && !(btn && btn.contains(e.target))) {
    cvCloseSettings();
  }
  const spMenu = $("#sp-settings-menu");
  const spBtn = $("#sp-settings-btn");
  if (spMenu && spMenu.classList.contains("open") && !spMenu.contains(e.target) && !(spBtn && spBtn.contains(e.target))) {
    spCloseSettings();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  cvCloseSettings();
  spCloseSettings();
});

// ── TS vs HLS detection heuristic ──
function isTsStream(url) {
  if (!url) return false;
  // If this is one of our own proxied URLs, test the REAL target URL inside
  // it instead — encodeURIComponent keeps a trailing ".ts" intact, but a
  // querystring on the original (very common for token-protected streams)
  // pushes it away from the string's end, which would break every test
  // below if we matched against the wrapped URL as-is.
  if (url.startsWith(STREAM_PROXY_BASE)) {
    try {
      const inner = decodeURIComponent(url.slice(STREAM_PROXY_BASE.length));
      if (inner && inner !== url) return isTsStream(inner);
    } catch {}
  }
  if (/\.m3u8(\?.*)?$/i.test(url)) return false;
  if (/\/mono\.m3u8/i.test(url)) return false;
  if (/\.ts(\?.*)?$/i.test(url)) return true;
  if (/\/mono\.ts(\?.*)?$/i.test(url)) return true;
  if (/tracks-v\d+a\d+/.test(url) && url.indexOf(".m3u8") === -1) return true;
  if (/\.stream\/tracks/.test(url) && url.indexOf(".m3u8") === -1) return true;
  if (/jagobd\.com/.test(url) && url.indexOf(".m3u8") === -1) return true;
  if (/bozztv\.com.+tracks/i.test(url) && url.indexOf(".m3u8") === -1) return true;
  if (/giatv-\d+/i.test(url) && url.indexOf(".m3u8") === -1) return true;
  if (/ncare\.live.+\.stream/i.test(url) && url.indexOf(".m3u8") === -1) return true;
  return false;
}

function destroyExistingPlayers() {
  const video = $("#main-hybrid-video-node");
  if (activeHlsEngineInstance) { try { activeHlsEngineInstance.destroy(); } catch {} activeHlsEngineInstance = null; }
  if (activeMpegtsInstance) { try { activeMpegtsInstance.destroy(); } catch {} activeMpegtsInstance = null; }
  if (video) { video.removeAttribute("src"); video.load(); }
}

// Starts playback without letting a FAILED play() change the user's mute setting.
// Why this exists: when channels are switched quickly, the previous load's
// pending play() promise is rejected with AbortError. The old code answered ANY
// rejection with `video.muted = true` (meant only for the browser's autoplay
// block), so a couple of quick switches silently muted the player — and the
// next load then read that muted state back as if the user had chosen it.
function cvSafePlay(video) {
  const urlAtCall = currentStreamUrl;
  const p = video.play();
  if (!p || typeof p.catch !== "function") return;
  p.catch((err) => {
    if (currentStreamUrl !== urlAtCall) return; // a newer channel already took over
    if (err && err.name === "AbortError") {
      // interrupted by our own reload — just try once more, volume untouched
      setTimeout(() => { if (currentStreamUrl === urlAtCall && video.paused) video.play().catch(() => {}); }, 300);
      return;
    }
    if (err && err.name === "NotAllowedError") {
      // real autoplay block: show the picture muted, but only TEMPORARILY —
      // cvUserMuted stays as the user set it, so the next channel restores it
      video.muted = true;
      cvUpdateVolIcon(video.volume, true);
      const slider = $("#cv-vol-slider"); if (slider) slider.value = 0;
      video.play().catch(() => {});
    }
  });
}

// ── reusable stream loader (channel switch & server switch both use this) ──
function cvLoadStreamSource(rawUrl) {
  const video = $("#main-hybrid-video-node");
  if (!rawUrl || !video) return;

  currentStreamUrl = rawUrl;
  destroyExistingPlayers();
  cvShowLoader(true);
  cvHidePoster();
  $("#videoError")?.remove();
  cvInitVideoEvents();

  const url = rawUrl.trim();
  const qsel = $("#cv-quality-select");
  if (qsel) { qsel.innerHTML = `<option value="-1">Auto</option>`; qsel.disabled = true; }

  // ── stall watchdog: if playback hasn't actually started within ~9s,
  // auto-try the next server (or show a visible error as a last resort)
  // instead of silently hanging with a spinner forever. ──
  clearTimeout(cvStallTimer);
  cvStallTimer = setTimeout(() => cvHandleStall(url), 9000);

  // ── audio-only watchdog: some sources decode audio fine but the video
  // track never renders (videoWidth stays 0) — almost always because the
  // stream is encoded in H.265/HEVC, which most desktop browsers cannot
  // decode at all even though the container demuxes correctly. The stall
  // watchdog above can't catch this since audio genuinely is playing, so
  // this checks specifically for "playing but no picture" a bit later. ──
  clearTimeout(cvVideoCheckTimer);
  cvVideoCheckTimer = setTimeout(() => cvHandleNoVideo(url), 12000);

  function restoreVolume() {
    video.volume = cvUserVolume;
    video.muted = cvUserMuted;
    const slider = $("#cv-vol-slider");
    if (slider) slider.value = cvUserMuted ? 0 : cvUserVolume;
    cvUpdateVolIcon(cvUserVolume, cvUserMuted);
  }

  function tryNative() {
    destroyExistingPlayers();
    video.src = url;
    restoreVolume();
    cvSafePlay(video);
  }

  function tryMpegts(onFail) {
    if (typeof mpegts === "undefined" || !mpegts.isSupported()) { if (onFail) onFail(); return; }
    destroyExistingPlayers();
    activeMpegtsInstance = mpegts.createPlayer({
      type: "mpegts", url, isLive: true, enableWorker: true, cors: true, withCredentials: false, liveBufferLatencyChasing: true,
    });
    activeMpegtsInstance.attachMediaElement(video);
    activeMpegtsInstance.load();
    activeMpegtsInstance.on(mpegts.Events.ERROR, () => { cvShowLoader(false); if (onFail) onFail(); else tryNative(); });
    restoreVolume();
    cvSafePlay(video);
  }

  if (cvCurrentEngine === "mpegts") { tryMpegts(tryNative); return; }
  if (cvCurrentEngine === "native") { tryNative(); return; }
  if (cvCurrentEngine === "auto" && isTsStream(url)) { tryMpegts(tryNative); return; }

  if (window.Hls && Hls.isSupported()) {
    activeHlsEngineInstance = new Hls({
      maxBufferLength: 10, maxMaxBufferLength: 30, maxBufferSize: 30 * 1000 * 1000,
      enableWorker: true, lowLatencyMode: true, startLevel: -1,
      manifestLoadingTimeOut: 10000, manifestLoadingMaxRetry: 2,
      levelLoadingTimeOut: 8000, fragLoadingTimeOut: 10000,
      xhrSetup: (xhr) => { xhr.withCredentials = false; },
    });
    activeHlsEngineInstance.loadSource(url);
    activeHlsEngineInstance.attachMedia(video);

    activeHlsEngineInstance.on(Hls.Events.MANIFEST_PARSED, (evt, data) => {
      restoreVolume();
      cvSafePlay(video);
      const levels = data.levels;
      if (levels && levels.length > 1 && qsel) {
        qsel.innerHTML = `<option value="-1">Auto</option>`;
        levels.forEach((l, i) => {
          const opt = document.createElement("option");
          opt.value = i;
          opt.textContent = l.height ? l.height + "p" : "Level " + (i + 1);
          qsel.appendChild(opt);
        });
        qsel.disabled = false;
      }
    });
    activeHlsEngineInstance.on(Hls.Events.LEVEL_SWITCHED, (evt, data) => {
      const lvl = activeHlsEngineInstance.levels[data.level];
      // when in Auto mode, show the resolution HLS actually picked right on
      // the "Auto" option itself instead of a separate badge next to it
      if (qsel && qsel.value === "-1" && lvl) {
        const autoOpt = qsel.querySelector('option[value="-1"]');
        if (autoOpt) autoOpt.textContent = "Auto (" + (lvl.height ? lvl.height + "p" : "…") + ")";
      }
    });
    activeHlsEngineInstance.on(Hls.Events.ERROR, (evt, data) => {
      if (!data.fatal) return;
      cvShowLoader(false);
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (currentServerList.length > 1 && currentServerIndex < currentServerList.length - 1) {
          currentServerIndex++;
          cvShowToast(`⚡ Auto: Server ${currentServerIndex + 1}`);
          renderServerMenu();
          cvLoadStreamSource(currentServerList[currentServerIndex].url);
        } else {
          tryMpegts(tryNative);
        }
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        activeHlsEngineInstance.recoverMediaError();
      } else {
        tryNative();
      }
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    restoreVolume();
    video.addEventListener("loadedmetadata", () => cvSafePlay(video), { once: true });
  } else {
    tryNative();
  }
}

// ── called when a stream hasn't started playing within the watchdog window ──
function cvHandleStall(failedUrl) {
  if (currentStreamUrl !== failedUrl) return; // a newer load already superseded this one
  const video = $("#main-hybrid-video-node");
  if (video && video.readyState >= 2 && !video.paused) return; // actually playing, false alarm

  if (currentServerList.length > 1 && currentServerIndex < currentServerList.length - 1) {
    currentServerIndex++;
    cvShowToast(`⏱ সাড়া মিলছে না, Server ${currentServerIndex + 1} চেষ্টা করা হচ্ছে…`);
    renderServerMenu();
    cvLoadStreamSource(currentServerList[currentServerIndex].url);
  } else {
    cvShowLoader(false);
    cvShowPoster();
    cvShowToast("⚠ প্লে করা যাচ্ছে না");
    // Every mirror failed to actually play: the badge was wrong, so fix it
    // and stop offering this channel as if it worked.
    markChannelDead(currentChannel);
    cvShowVideoError();
  }
}

function cvShowVideoError() {
  const frame = $("#cv-player-frame");
  if (!frame || $("#videoError")) return;
  const box = document.createElement("div");
  box.id = "videoError";
  box.className = "cv-video-error";
  box.innerHTML = `
    <p>এই সার্ভার থেকে চ্যানেলটি চালু করা যাচ্ছে না।</p>
    <div class="cv-video-error-actions">
      <button class="btn-solid" id="videoErrorRetry">আবার চেষ্টা করো</button>
      <button class="btn-outline" id="videoErrorServers">অন্য সার্ভার</button>
    </div>
  `;
  frame.appendChild(box);
  $("#videoErrorRetry").addEventListener("click", () => {
    box.remove();
    const ch = currentChannel;
    if (ch) { ch.verifiedAt = 0; playChannel(ch); } // force a fresh check
    else if (currentStreamUrl) cvLoadStreamSource(currentStreamUrl);
  });
  $("#videoErrorServers").addEventListener("click", () => { box.remove(); cvOpenSettings(); });
}

// ── called when audio has been playing for a while but no picture ever
// showed up — almost always an HEVC/H.265 stream, which most desktop
// browsers simply cannot decode (this is a codec limitation, not a bug that
// front-end code can patch around). Tries another server first since a
// different source for the same channel is often encoded in H.264 instead,
// and only falls back to an explanatory message if no alternative exists. ──
function cvHandleNoVideo(failedUrl) {
  if (currentStreamUrl !== failedUrl) return; // a newer load already superseded this one
  const video = $("#main-hybrid-video-node");
  if (!video || video.paused || video.readyState < 2) return; // not actually the audio-only case
  if (video.videoWidth > 0) return; // picture is fine, false alarm

  if (currentServerList.length > 1 && currentServerIndex < currentServerList.length - 1) {
    currentServerIndex++;
    cvShowToast(`🎞 ভিডিও আসছে না, Server ${currentServerIndex + 1} চেষ্টা করা হচ্ছে…`);
    renderServerMenu();
    cvLoadStreamSource(currentServerList[currentServerIndex].url);
  } else {
    cvShowToast("⚠ এই স্ট্রিমের ভিডিও ফরম্যাট (HEVC) এই ব্রাউজারে সাপোর্টেড না — শুধু অডিও চলবে");
  }
}

// ── toast, play/pause, mute, volume, fullscreen, pip ──
function cvShowToast(msg) {
  const t = $("#cv-toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(cvShowToast._t);
  cvShowToast._t = setTimeout(() => t.classList.remove("show"), 1200);
}

function cvTogglePlay() {
  const v = $("#main-hybrid-video-node");
  if (!v) return;
  if (v.paused) { v.play(); cvShowToast("▶ Play"); } else { v.pause(); cvShowToast("⏸ Pause"); }
}

function cvToggleMute() {
  const v = $("#main-hybrid-video-node");
  const slider = $("#cv-vol-slider");
  if (!v) return;
  v.muted = !v.muted;
  cvUserMuted = v.muted; // the user's own choice
  cvUpdateVolIcon(v.volume, v.muted);
  if (slider) slider.value = v.muted ? 0 : v.volume;
  cvShowToast(v.muted ? "🔇 Muted" : "🔊 Unmuted");
}

function cvSetVolume(val) {
  const v = $("#main-hybrid-video-node");
  if (!v) return;
  v.volume = parseFloat(val);
  v.muted = parseFloat(val) === 0;
  cvUserMuted = v.muted;
  if (parseFloat(val) > 0) cvUserVolume = parseFloat(val);
  cvUpdateVolIcon(parseFloat(val), v.muted);
}

function cvToggleFullscreen() {
  const frame = $("#cv-player-frame");
  const icon = $("#cv-fs-icon");
  if (!frame) return;
  if (!document.fullscreenElement) {
    frame.requestFullscreen?.().catch(() => {});
    if (icon) icon.className = "fa-solid fa-compress";
    cvShowToast("⛶ Fullscreen");
  } else {
    document.exitFullscreen?.();
    if (icon) icon.className = "fa-solid fa-expand";
    cvShowToast("↙ Exit Fullscreen");
  }
}

function cvTogglePip() {
  const v = $("#main-hybrid-video-node");
  if (!v) return;
  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  } else if (document.pictureInPictureEnabled) {
    v.requestPictureInPicture().catch(() => {});
    cvShowToast("⧉ Picture in Picture");
  } else {
    cvShowToast("এই ব্রাউজারে PiP সাপোর্ট নেই");
  }
}

function cvSetQuality(val) {
  if (!activeHlsEngineInstance) return;
  activeHlsEngineInstance.currentLevel = parseInt(val, 10);
  const sel = $("#cv-quality-select");
  cvShowToast("Quality: " + (val === "-1" ? "Auto" : sel.options[sel.selectedIndex].text));
}

function cvToggleEnginePanel() {
  const panel = $("#cv-engine-panel");
  if (!panel) return;
  panel.style.display = panel.style.display === "none" ? "block" : "none";
}

function cvSetEngine(engine) {
  cvCurrentEngine = engine;
  const panel = $("#cv-engine-panel");
  if (panel) panel.style.display = "none";
  $$(".cv-engine-btn").forEach((b) => b.classList.toggle("active", b.dataset.engine === engine));
  const label = $("#cv-engine-label");
  if (label) label.textContent = engine === "auto" ? "Auto" : engine === "hls" ? "HLS.js" : engine === "mpegts" ? "mpegts" : "Native";
  if (currentStreamUrl) cvLoadStreamSource(currentStreamUrl);
  cvShowToast("Engine: " + (label ? label.textContent : engine));
}

// ── next/previous channel (cycles through the listed channels only) ──
// Walks the visible list rather than the raw CHANNELS array, so pressing next
// can't drop the visitor onto a hidden, dead channel.
function cvStepChannel(dir) {
  const list = visibleChannels();
  if (!list.length) return null;
  let idx = currentChannel ? list.findIndex((c) => c.id === currentChannel.id) : -1;
  if (idx === -1) idx = dir > 0 ? -1 : 0; // current channel got hidden — start from the edge
  const next = list[(idx + dir + list.length) % list.length];
  return next || null;
}
function cvPlayNext() {
  const ch = cvStepChannel(1);
  if (!ch) return;
  playChannel(ch);
  cvShowToast("⏭ " + ch.name);
}
function cvPlayPrev() {
  const ch = cvStepChannel(-1);
  if (!ch) return;
  playChannel(ch);
  cvShowToast("⏮ " + ch.name);
}

// ── seek / progress bar ──
function cvSeekFraction(e) {
  const bar = $("#cv-progress-wrap");
  if (!bar) return 0;
  const rect = bar.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}
function cvSeekStart(e) {
  const v = $("#main-hybrid-video-node");
  if (!v || !v.duration || !isFinite(v.duration)) return;
  cvIsSeeking = true;
  cvApplySeekFraction(cvSeekFraction(e));
}
function cvSeekPreview(e) { if (cvIsSeeking) cvApplySeekFraction(cvSeekFraction(e)); }
function cvSeekEnd(e) {
  if (!cvIsSeeking) return;
  cvIsSeeking = false;
  const v = $("#main-hybrid-video-node");
  if (!v || !v.duration || !isFinite(v.duration)) return;
  v.currentTime = cvSeekFraction(e) * v.duration;
}
function cvApplySeekFraction(frac) {
  const fill = $("#cv-progress-fill");
  const thumb = $("#cv-progress-thumb");
  if (fill) fill.style.width = frac * 100 + "%";
  if (thumb) thumb.style.left = frac * 100 + "%";
}
function cvFmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return "--:--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return (h > 0 ? h + ":" : "") + (h > 0 ? String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}
function cvUpdateProgress() {
  const v = $("#main-hybrid-video-node");
  if (!v || cvIsSeeking) return;
  const fill = $("#cv-progress-fill"), thumb = $("#cv-progress-thumb"), bufBar = $("#cv-progress-buffer");
  const elapsed = $("#cv-elapsed"), durText = $("#cv-duration-text");
  const liveProg = $("#cv-progress-live"), liveBtn = $("#cv-golive-btn");
  const dur = v.duration;
  const isLive = !isFinite(dur) || dur === Infinity;
  if (isLive) {
    if (liveProg) liveProg.style.display = "block";
    if (fill) fill.style.width = "0%";
    if (thumb) thumb.style.left = "0%";
    if (bufBar) bufBar.style.width = "0%";
    if (elapsed) elapsed.textContent = cvFmtTime(v.currentTime);
    if (durText) durText.textContent = "LIVE";
    try {
      if (v.seekable && v.seekable.length > 0) {
        const edge = v.seekable.end(v.seekable.length - 1);
        const lag = edge - v.currentTime;
        if (liveBtn) liveBtn.style.display = lag > 8 ? "flex" : "none";
      }
    } catch {}
  } else {
    if (liveProg) liveProg.style.display = "none";
    const frac = dur > 0 ? v.currentTime / dur : 0;
    if (fill) fill.style.width = frac * 100 + "%";
    if (thumb) thumb.style.left = frac * 100 + "%";
    if (elapsed) elapsed.textContent = cvFmtTime(v.currentTime);
    if (durText) durText.textContent = cvFmtTime(dur);
    try {
      if (v.buffered && v.buffered.length > 0 && bufBar) {
        bufBar.style.width = (v.buffered.end(v.buffered.length - 1) / dur) * 100 + "%";
      }
    } catch {}
    if (liveBtn) liveBtn.style.display = "none";
  }
}

// ── rewind / fast-forward / go-live / screenshot ──
function cvRewind() {
  const v = $("#main-hybrid-video-node");
  if (!v) return;
  v.currentTime = Math.max(0, v.currentTime - 10);
  cvShowToast("⏪ -10s");
}
function cvFastForward() {
  const v = $("#main-hybrid-video-node");
  if (!v) return;
  try {
    if (!isFinite(v.duration) && v.seekable && v.seekable.length > 0) {
      const edge = v.seekable.end(v.seekable.length - 1);
      v.currentTime = Math.min(edge, v.currentTime + 10);
      cvShowToast("⚡ +10s");
      return;
    }
  } catch {}
  if (isFinite(v.duration)) {
    v.currentTime = Math.min(v.duration, v.currentTime + 10);
    cvShowToast("⏩ +10s");
  }
}
function cvGoLive() {
  const v = $("#main-hybrid-video-node");
  if (!v) return;
  try {
    if (v.seekable && v.seekable.length > 0) {
      v.currentTime = v.seekable.end(v.seekable.length - 1) - 0.5;
      v.play();
      cvShowToast("🔴 Back to LIVE!");
      const btn = $("#cv-golive-btn");
      if (btn) btn.style.display = "none";
    }
  } catch { cvShowToast("Could not seek to live edge"); }
}
function cvTakeScreenshot() {
  const v = $("#main-hybrid-video-node");
  if (!v) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 1280;
    canvas.height = v.videoHeight || 720;
    canvas.getContext("2d").drawImage(v, 0, 0, canvas.width, canvas.height);
    const link = document.createElement("a");
    link.download = "screenshot-" + Date.now() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();
    cvShowToast("📸 Screenshot saved!");
  } catch { cvShowToast("⚠ Screenshot failed (CORS)"); }
}

// ── icon/poster/loader helpers ──
function cvUpdateVolIcon(val, muted) {
  const icon = $("#cv-vol-icon");
  if (!icon) return;
  if (muted || val == 0) icon.className = "fa-solid fa-volume-xmark";
  else if (val < 0.4) icon.className = "fa-solid fa-volume-off";
  else if (val < 0.7) icon.className = "fa-solid fa-volume-low";
  else icon.className = "fa-solid fa-volume-high";
}
function cvUpdatePlayIcon() {
  const v = $("#main-hybrid-video-node");
  const icon = $("#cv-play-icon");
  if (!icon || !v) return;
  icon.className = v.paused ? "fa-solid fa-play" : "fa-solid fa-pause";
}
function cvShowLoader(show) {
  const l = $("#cv-loader");
  if (l) l.className = show ? "cv-loading-ring active" : "cv-loading-ring";
}
function cvHidePoster() { $("#cv-poster")?.classList.add("hidden"); }
function cvShowPoster() { $("#cv-poster")?.classList.remove("hidden"); }

function cvInitVideoEvents() {
  const v = $("#main-hybrid-video-node");
  const frame = $("#cv-player-frame");
  if (!v) return;
  v.onplay = () => { cvUpdatePlayIcon(); cvShowLoader(false); cvHidePoster(); clearTimeout(cvStallTimer); };
  v.onplaying = () => { cvShowLoader(false); cvHidePoster(); clearTimeout(cvStallTimer); cvConfirmPlayback(); };
  v.onpause = () => cvUpdatePlayIcon();
  v.onwaiting = () => cvShowLoader(true);
  v.oncanplay = () => { cvShowLoader(false); cvUpdateProgress(); };
  v.onerror = () => { cvShowLoader(false); cvHandleStall(currentStreamUrl); };
  v.ontimeupdate = () => cvUpdateProgress();
  v.ondurationchange = () => cvUpdateProgress();
  if (frame && !frame._cvLeaveBound) {
    frame._cvLeaveBound = true;
    frame.addEventListener("mouseleave", () => {
      if (!document.fullscreenElement) {
        clearTimeout(cvControlsTimer);
        frame.classList.remove("controls-visible");
      }
    });
  }
}

// The video element really produced playback — the strongest proof a stream
// works, so upgrade the badge (and the cached result) on the spot. This keeps
// the ON count honest in the direction the old checker never verified.
function cvConfirmPlayback() {
  const ch = currentChannel;
  const raw = realUrl(currentStreamUrl || "");
  if (!ch || !raw) return;
  if (ch.liveStatus === "on" && ch.verifiedUrl === raw) return;
  markChannelLive(ch, raw);
}

// ── global mouse/touch → show controls, then auto-hide ──
document.addEventListener("mousemove", () => {
  const frame = $("#cv-player-frame");
  if (!frame) return;
  frame.classList.add("controls-visible");
  clearTimeout(cvControlsTimer);
  cvControlsTimer = setTimeout(() => frame.classList.remove("controls-visible"), 2500);
});
document.addEventListener("touchstart", () => {
  const frame = $("#cv-player-frame");
  if (!frame) return;
  frame.classList.add("controls-visible");
  clearTimeout(cvControlsTimer);
  cvControlsTimer = setTimeout(() => frame.classList.remove("controls-visible"), 2500);
});
document.addEventListener("dblclick", (e) => {
  const frame = $("#cv-player-frame");
  if (!frame || !frame.contains(e.target)) return;
  if (e.target.closest(".cv-controls-row") || e.target.closest(".cv-progress-wrap") || e.target.closest(".cv-topright-overlay") || e.target.closest(".cv-settings-menu")) return;
  cvToggleFullscreen();
});

// ── floating channel-list panel inside the player ──
function cvToggleChannelSidebar() {
  const panel = $("#cv-float-chlist");
  if (!panel) return;
  panel.classList.contains("open") ? cvCloseFloatChList() : cvOpenFloatChList();
}
function cvOpenFloatChList() {
  cvCloseSettings();
  const panel = $("#cv-float-chlist");
  const btn = $("#cv-chlist-btn");
  if (!panel) return;
  cvRenderFloatChList("");
  panel.classList.add("open");
  btn?.classList.add("active");
  const inp = $("#cv-float-search");
  if (inp) { inp.value = ""; inp.focus(); }
}
function cvCloseFloatChList() {
  $("#cv-float-chlist")?.classList.remove("open");
  $("#cv-chlist-btn")?.classList.remove("active");
}
function cvRenderFloatChList(query) {
  const body = $("#cv-float-chlist-body");
  if (!body) return;
  const q = (query || "").toLowerCase().trim();
  const pool = visibleChannels();
  const filtered = q ? pool.filter((c) => c.name.toLowerCase().includes(q)) : pool;
  body.innerHTML = "";
  if (!filtered.length) {
    body.innerHTML = `<div style="padding:20px;text-align:center;color:#555;font-size:12px;">No channels found</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  filtered.forEach((ch, idx) => {
    const item = document.createElement("div");
    item.className = "cv-float-ch-item" + (currentChannel && ch.id === currentChannel.id ? " active" : "");
    const logoHtml = ch.logo
      ? `<img class="cv-float-ch-logo" src="${ch.logo}" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextSibling.style.display='block'"><div class="cv-float-ch-logo-ph" style="display:none"></div>`
      : `<div class="cv-float-ch-logo-ph"></div>`;
    item.innerHTML = `
      <span class="cv-float-ch-num">${idx + 1}</span>
      ${logoHtml}
      <div class="cv-float-ch-info">
        <div class="cv-float-ch-name">${ch.name}</div>
        <div class="cv-float-ch-group">${ch.group}</div>
      </div>
      <span class="cv-float-status-dot"></span>`;
    item.onclick = () => { playChannel(ch); cvCloseFloatChList(); };
    frag.appendChild(item);
  });
  body.appendChild(frag);
}
function cvFloatChSearch(val) { cvRenderFloatChList(val); }

document.addEventListener("fullscreenchange", () => {
  const frame = $("#cv-player-frame");
  const icon = $("#cv-fs-icon");
  if (document.fullscreenElement) {
    if (icon) icon.className = "fa-solid fa-compress";
    if (frame) {
      frame.classList.add("controls-visible");
      clearTimeout(cvControlsTimer);
      cvControlsTimer = setTimeout(() => frame.classList.remove("controls-visible"), 2500);
    }
  } else {
    if (icon) icon.className = "fa-solid fa-expand";
    if (frame) { clearTimeout(cvControlsTimer); frame.classList.remove("controls-visible"); }
  }
});

// ── keyboard shortcuts (Space/M/F/P/Arrows/L/S) ──
document.addEventListener("keydown", (e) => {
  const tag = (e.target || e.srcElement).tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  const v = $("#main-hybrid-video-node");
  if (!v || (!v.src && !activeHlsEngineInstance)) return;
  switch (e.code) {
    case "Space": e.preventDefault(); cvTogglePlay(); break;
    case "KeyM": cvToggleMute(); break;
    case "KeyF": cvToggleFullscreen(); break;
    case "KeyP": cvTogglePip(); break;
    case "ArrowUp": {
      e.preventDefault();
      v.volume = Math.min(1, v.volume + 0.1);
      if (v.volume > 0) cvUserVolume = v.volume;
      const s = $("#cv-vol-slider"); if (s) s.value = v.volume;
      cvShowToast("🔊 " + Math.round(v.volume * 100) + "%");
      break;
    }
    case "ArrowDown": {
      e.preventDefault();
      v.volume = Math.max(0, v.volume - 0.1);
      if (v.volume > 0) cvUserVolume = v.volume;
      const s2 = $("#cv-vol-slider"); if (s2) s2.value = v.volume;
      cvShowToast("🔉 " + Math.round(v.volume * 100) + "%");
      break;
    }
    case "ArrowLeft": e.preventDefault(); cvRewind(); break;
    case "ArrowRight": e.preventDefault(); cvFastForward(); break;
    case "KeyL": cvGoLive(); break;
    case "KeyS": cvTakeScreenshot(); break;
  }
});

// ── live clock (Asia/Dhaka) in the top-right header ──
function startBSTClockEngine() {
  function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const el = $("#liveClock");
    if (el) el.textContent = timeStr;
  }
  updateClock();
  setInterval(updateClock, 1000);
}

// ── real-time visitor counter, backed by a Cloudflare Worker + KV ──
// (a static site alone has no shared memory across visitors' browsers, so
// an accurate count needs a small server-side counter — see WORKER-README.md
// for the one-time setup). Fill in the deployed Worker URL below.
const VISITOR_COUNTER_API = "https://shamim-visitor-counter.iamshamimhasan.workers.dev";
const VISITOR_SESSION_FLAG = "shamim_visit_counted_session";

async function initVisitorCounter() {
  const textEl = $("#visitorCountText");
  if (!textEl) return;
  if (!VISITOR_COUNTER_API) { textEl.textContent = "সেটআপ বাকি"; return; }

  try {
    const alreadyCountedThisSession = sessionStorage.getItem(VISITOR_SESSION_FLAG);
    const endpoint = alreadyCountedThisSession ? `${VISITOR_COUNTER_API}/count` : `${VISITOR_COUNTER_API}/hit`;
    const res = await fetch(endpoint, { cache: "no-store" });
    if (!res.ok) throw new Error("bad status");
    const data = await res.json();
    if (!alreadyCountedThisSession) sessionStorage.setItem(VISITOR_SESSION_FLAG, "1");
    textEl.textContent = Number(data.count || 0).toLocaleString("en-US");
  } catch {
    textEl.textContent = "—";
  }
}

function setupPlayerControls() {
  // Slot A already reveals its controls from the global mouse/touch listeners;
  // slot B lives in a separate frame, so it needs its own.
  const splitFrame = $("#splitFrame");
  if (splitFrame && !splitFrame._spHoverBound) {
    splitFrame._spHoverBound = true;
    splitFrame.addEventListener("mousemove", spRevealControls);
    splitFrame.addEventListener("mousedown", spRevealControls);
    splitFrame.addEventListener("touchstart", spRevealControls, { passive: true });
  }
}

// ============================================================
// TOOLS EXTRAS
//  1. Admin Playlists — playlists defined in JS, each opening in its
//     own player + channel list right inside the Tools page.
//  2. Auto-floating player — the video shrinks into a floating window
//     once you scroll past it and returns when you scroll back.
//  3. Duplicate / Unique checker — compare two M3U playlists.
// ============================================================

// ---- add as many admin playlists as you like here -------------------------
const ADMIN_PLAYLISTS = [
  { name: "XNIPTV", url: "https://raw.githubusercontent.com/tvbd/m3uplayer/refs/heads/main/m3u/xniptv.m3u" },
  { name: "Nafi TV", url: "https://raw.githubusercontent.com/nfiptv24-max/NAFITV/refs/heads/main/Nafitv24.m3u" },
  { name: "Toffee", url: "https://tv9.workerbot-tv9.workers.dev/toffee.m3u" },
  { name: "SkyTop", url: "https://raw.githubusercontent.com/shiptv75/skytop/refs/heads/main/playlist.m3u" },
  { name: "JagoBD", url: "https://raw.githubusercontent.com/sm-monirulislam/jago_bd_auto_update_playlist-/refs/heads/main/jago_bd.m3u" },
  // add more here: { name: "My Playlist", url: "https://example.com/playlist.m3u" },
];

let adminChannels = [];
let adminCurrent = null;
let adminHls = null;
let adminMpegts = null;
let adminVolume = 1;
let adminMuted = false;
let adminFloat = null;

function adminEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function adminDestroyPlayers() {
  if (adminHls) { try { adminHls.destroy(); } catch {} adminHls = null; }
  if (adminMpegts) { try { adminMpegts.destroy(); } catch {} adminMpegts = null; }
  const v = $("#adminVideoNode");
  if (v) { try { v.pause(); v.removeAttribute("src"); v.load(); } catch {} }
}

// M3U text -> [{ id, name, logo, group, sources[] }] merged by channel name.
function adminParse(text) {
  const byName = new Map();
  parseSingleSourceRaw(text).forEach((e) => {
    const key = slugify(e.name);
    if (!byName.has(key)) {
      byName.set(key, { id: key, name: e.name, logo: e.logo || "", group: e.group || "", sources: [] });
    }
    const ch = byName.get(key);
    (e.sources || []).forEach((u) => { if (!ch.sources.includes(u)) ch.sources.push(u); });
    if (!ch.logo && e.logo) ch.logo = e.logo;
    if (!ch.group && e.group) ch.group = e.group;
  });
  return [...byName.values()];
}

function renderAdminPlaylists() {
  const box = $("#adminPlaylistList");
  if (!box) return;
  if (!ADMIN_PLAYLISTS.length) {
    box.innerHTML = '<div class="pl-store-empty">No admin playlists configured yet</div>';
    return;
  }
  box.innerHTML = ADMIN_PLAYLISTS.map((p, i) => `
    <div class="pl-store-item">
      <div class="pl-store-info">
        <div class="pl-store-name">${adminEsc(p.name || nameFromUrl(p.url))}</div>
        <div class="pl-store-link" title="${adminEsc(p.url)}">${adminEsc(p.url)}</div>
      </div>
      <button class="pl-store-btn load" data-admin-play="${i}" type="button"><i class="fa-solid fa-play"></i> Open</button>
    </div>`).join("");
  box.querySelectorAll("[data-admin-play]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const def = ADMIN_PLAYLISTS[Number(btn.dataset.adminPlay)];
      if (def) adminOpenPlaylist(def);
    });
  });
}

async function adminOpenPlaylist(def) {
  const section = $("#adminPlayerSection");
  const listEl = $("#adminChList");
  if (!section || !listEl || !def) return;

  section.classList.remove("hidden");
  const nameEl = $("#adminPlaylistName");
  if (nameEl) nameEl.textContent = def.name || "Admin Playlist";
  const countEl = $("#adminChCount");
  if (countEl) countEl.textContent = "";
  listEl.innerHTML = '<div class="admin-empty"><span class="scan-spinner"></span> লোড হচ্ছে…</div>';
  adminChannels = [];
  adminCurrent = null;

  try {
    const text = await toolsFetchText(def.url);
    adminChannels = adminParse(text);
    if (!adminChannels.length) {
      listEl.innerHTML = '<div class="admin-empty">এই প্লেলিস্টে কোনো চ্যানেল পাওয়া যায়নি</div>';
      toast("প্লেলিস্টে কোনো চ্যানেল নেই");
      return;
    }
    if (countEl) countEl.textContent = adminChannels.length;
    adminRenderChannels("");
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    requestAnimationFrame(() => { if (adminFloat) adminFloat.refresh(); });
    adminPlayChannel(adminChannels[0]);
  } catch (e) {
    listEl.innerHTML = '<div class="admin-empty">প্লেলিস্ট লোড করা যায়নি</div>';
    toast("প্লেলিস্ট লোড করা যায়নি");
  }
}

function adminRenderChannels(query) {
  const body = $("#adminChList");
  if (!body) return;
  const q = (query || "").toLowerCase().trim();
  const list = q ? adminChannels.filter((c) => c.name.toLowerCase().includes(q)) : adminChannels;
  if (!list.length) {
    body.innerHTML = '<div class="admin-empty">কোনো চ্যানেল পাওয়া যায়নি</div>';
    return;
  }
  body.innerHTML = list.map((c) => `
    <button class="admin-ch-item${adminCurrent && adminCurrent.id === c.id ? " active" : ""}" type="button" data-ch="${adminEsc(c.id)}">
      ${c.logo
        ? `<img src="${adminEsc(c.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
        : `<span class="admin-ch-fallback">${adminEsc(c.name.slice(0, 2).toUpperCase())}</span>`}
      <span class="admin-ch-name">${adminEsc(c.name)}</span>
    </button>`).join("");
  body.querySelectorAll(".admin-ch-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ch = adminChannels.find((c) => c.id === btn.dataset.ch);
      if (ch) adminPlayChannel(ch);
    });
  });
}

function adminPlayChannel(ch) {
  if (!ch || !ch.sources || !ch.sources.length) { toast("এই চ্যানেলের কোনো সোর্স নেই"); return; }
  const video = $("#adminVideoNode");
  if (!video) return;

  adminCurrent = ch;
  adminRenderChannels($("#adminSearch") ? $("#adminSearch").value : "");
  adminDestroyPlayers();

  const loader = $("#adminLoader");
  if (loader) loader.classList.add("active");
  const titleEl = $("#adminChannelTitle");
  if (titleEl) titleEl.textContent = ch.name;
  const statusEl = $("#adminChannelStatus");
  if (statusEl) statusEl.textContent = "Category: " + (ch.group || "—") + " · Sources: " + ch.sources.length;

  const logoFrame = $("#adminLogoFrame");
  if (logoFrame) {
    logoFrame.innerHTML = ch.logo
      ? `<img src="${adminEsc(ch.logo)}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
      : `<i class="fa-solid fa-play" style="font-size:20px;color:var(--cv-primary);"></i>`;
  }

  video.volume = adminVolume;
  video.muted = adminMuted;
  video.onplaying = () => { if (loader) loader.classList.remove("active"); adminSyncPlayIcon(); };
  video.oncanplay = () => { if (loader) loader.classList.remove("active"); };
  video.onerror = () => { if (loader) loader.classList.remove("active"); };

  const url = playbackUrl(ch.sources[0]);
  const done = () => { if (loader) loader.classList.remove("active"); };

  if (isTsStream(url) && typeof mpegts !== "undefined" && mpegts.isSupported()) {
    adminMpegts = mpegts.createPlayer({
      type: "mpegts", url, isLive: true, enableWorker: true, cors: true, withCredentials: false, liveBufferLatencyChasing: true,
    });
    adminMpegts.attachMediaElement(video);
    adminMpegts.load();
    adminMpegts.play().catch(() => {});
  } else if (window.Hls && Hls.isSupported()) {
    adminHls = new Hls({
      enableWorker: true, lowLatencyMode: true,
      manifestLoadingTimeOut: 10000, manifestLoadingMaxRetry: 2,
      levelLoadingTimeOut: 8000, fragLoadingTimeOut: 10000,
    });
    adminHls.loadSource(url);
    adminHls.attachMedia(video);
    adminHls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
    adminHls.on(Hls.Events.ERROR, (evt, data) => { if (data && data.fatal) done(); });
  } else {
    video.src = url;
    video.play().catch(() => {});
  }

  adminSyncPlayIcon();
  adminSyncMute();
}

function adminSyncPlayIcon() {
  const v = $("#adminVideoNode");
  const icon = $("#adminPlayIcon");
  if (v && icon) icon.className = "fa-solid " + (v.paused ? "fa-play" : "fa-pause");
}
function adminSyncMute() {
  const v = $("#adminVideoNode");
  if (!v) return;
  const icon = $("#adminVolIcon");
  const slider = $("#adminVolSlider");
  if (slider) slider.value = v.muted ? 0 : v.volume;
  if (!icon) return;
  if (v.muted || v.volume === 0) icon.className = "fa-solid fa-volume-xmark";
  else if (v.volume < 0.4) icon.className = "fa-solid fa-volume-off";
  else if (v.volume < 0.7) icon.className = "fa-solid fa-volume-low";
  else icon.className = "fa-solid fa-volume-high";
}
function adminTogglePlay() {
  const v = $("#adminVideoNode");
  if (!v) return;
  if (v.paused) v.play().catch(() => {}); else v.pause();
  adminSyncPlayIcon();
}
function adminToggleMute() {
  const v = $("#adminVideoNode");
  if (!v) return;
  v.muted = !v.muted;
  adminMuted = v.muted;
  adminSyncMute();
}
function adminSetVolume(val) {
  const v = $("#adminVideoNode");
  if (!v) return;
  const n = parseFloat(val);
  v.volume = n;
  v.muted = n === 0;
  adminMuted = v.muted;
  if (n > 0) adminVolume = n;
  adminSyncMute();
}
function adminToggleFullscreen() {
  const frame = $("#adminFrame");
  const icon = $("#adminFsIcon");
  if (!frame) return;
  if (!document.fullscreenElement) {
    frame.requestFullscreen?.().catch(() => {});
    if (icon) icon.className = "fa-solid fa-compress";
  } else {
    document.exitFullscreen?.();
    if (icon) icon.className = "fa-solid fa-expand";
  }
}
function adminClosePlayer() {
  adminDestroyPlayers();
  adminChannels = [];
  adminCurrent = null;
  if (adminFloat) adminFloat.leave();
  const section = $("#adminPlayerSection");
  if (section) section.classList.add("hidden");
}

// ------------------------------------------------------------
// Auto-floating player
//   Once the player's slot is scrolled past, the pane is pinned as a small
//   floating window (a spacer keeps the page layout from jumping). Scrolling
//   back restores it to its normal place and size.
// ------------------------------------------------------------
function setupAutoFloat(pane, opts = {}) {
  if (!pane) return null;
  const pad = opts.thresholdPad != null ? opts.thresholdPad : 120;
  let floating = false;
  let spacer = null;
  let backBtn = null;
  let staticTop = 0;
  let ticking = false;

  function measure() {
    if (floating || pane.offsetParent === null) return;
    staticTop = window.scrollY + pane.getBoundingClientRect().top;
  }

  function enter() {
    if (floating) return;
    if (opts.canFloat && !opts.canFloat()) return;
    const rect = pane.getBoundingClientRect();
    if (!rect.height) return;
    floating = true;
    spacer = document.createElement("div");
    spacer.className = "float-spacer";
    spacer.style.width = Math.round(rect.width) + "px";
    spacer.style.height = Math.round(rect.height) + "px";
    spacer.style.flex = "1 1 auto";
    spacer.style.minWidth = "0";
    pane.parentNode.insertBefore(spacer, pane);
    pane.classList.add("player-float");
    backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "float-back-btn";
    backBtn.title = "আসল জায়গায় ফিরে যান";
    backBtn.innerHTML = '<i class="fa-solid fa-compress"></i>';
    backBtn.addEventListener("click", () => {
      window.scrollTo({ top: Math.max(0, staticTop - 140), behavior: "smooth" });
    });
    pane.appendChild(backBtn);
  }

  function leave() {
    if (!floating) return;
    floating = false;
    pane.classList.remove("player-float");
    if (spacer && spacer.parentNode) spacer.parentNode.removeChild(spacer);
    spacer = null;
    if (backBtn && backBtn.parentNode) backBtn.parentNode.removeChild(backBtn);
    backBtn = null;
    measure();
  }

  function update() {
    if (pane.offsetParent === null) { leave(); return; }
    if (floating && opts.canFloat && !opts.canFloat()) { leave(); return; }
    if (!staticTop) measure();
    if (!staticTop) return;
    const threshold = staticTop + (pane.offsetHeight || 0) - pad;
    const y = window.scrollY;
    if (!floating && y > threshold) enter();
    else if (floating && y < threshold - 80) leave();
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; update(); });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => { if (!floating) measure(); onScroll(); });
  requestAnimationFrame(() => { measure(); update(); });

  return {
    refresh() { if (!floating) { staticTop = 0; measure(); } update(); },
    leave,
    isFloating: () => floating,
  };
}

// ------------------------------------------------------------
// Duplicate / Unique checker
// ------------------------------------------------------------
let cmpSet = "both";
let cmpData = { both: [], a: [], b: [] };

function cmpNormalize(name) {
  return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
}
function cmpParse(text) {
  const map = new Map();
  parseSingleSourceRaw(text).forEach((e) => {
    const key = cmpNormalize(e.name);
    if (!key) return;
    if (!map.has(key)) map.set(key, { name: e.name, group: e.group || "", urls: [] });
    const item = map.get(key);
    (e.sources || []).forEach((u) => { if (!item.urls.includes(u)) item.urls.push(u); });
  });
  return [...map.values()];
}
async function cmpGetText(which) {
  const urlEl = $("#cmpUrl" + which);
  const textEl = $("#cmpText" + which);
  const pasted = (textEl && textEl.value || "").trim();
  if (pasted) return pasted;
  const url = (urlEl && urlEl.value || "").trim();
  if (!isHttpUrl(url)) throw new Error("প্লেলিস্ট " + which + ": URL দিন বা টেক্সট পেস্ট করুন");
  return await toolsFetchText(url);
}

function setCmpStatus(msg, kind) {
  const el = $("#cmpStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "chk-status" + (kind ? " " + kind : "");
}

async function cmpRun() {
  setCmpStatus("তুলনা করা হচ্ছে…");
  try {
    const [aText, bText] = await Promise.all([cmpGetText("A"), cmpGetText("B")]);
    const a = cmpParse(aText);
    const b = cmpParse(bText);
    if (!a.length || !b.length) throw new Error("দুই প্লেলিস্টেই অন্তত একটি চ্যানেল থাকতে হবে");

    const aMap = new Map(a.map((x) => [cmpNormalize(x.name), x]));
    const bMap = new Map(b.map((x) => [cmpNormalize(x.name), x]));
    const both = [];
    const onlyA = [];
    const onlyB = [];
    aMap.forEach((x, k) => (bMap.has(k) ? both.push(x) : onlyA.push(x)));
    bMap.forEach((x, k) => { if (!aMap.has(k)) onlyB.push(x); });
    const byName = (x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" });
    both.sort(byName); onlyA.sort(byName); onlyB.sort(byName);

    cmpData = { both, a: onlyA, b: onlyB };
    const setN = (id, n) => { const el = $(id); if (el) el.textContent = n; };
    setN("#cmpNBoth", both.length);
    setN("#cmpNA", onlyA.length);
    setN("#cmpNB", onlyB.length);

    const summary = $("#cmpSummary");
    if (summary) {
      summary.innerHTML =
        "A: <b>" + a.length + "</b> · B: <b>" + b.length + "</b> · " +
        "Common: <b class=\"w\">" + both.length + "</b> · " +
        "Only A: <b>" + onlyA.length + "</b> · Only B: <b>" + onlyB.length + "</b>";
    }
    const results = $("#cmpResults");
    if (results) results.classList.remove("hidden");
    setCmpStatus("✓ তুলনা সম্পন্ন", "ok");
    cmpRender();
  } catch (e) {
    setCmpStatus("✗ " + (e && e.message ? e.message : "তুলনা ব্যর্থ"), "err");
  }
}

function cmpRender() {
  const list = $("#cmpList");
  if (!list) return;
  const items = cmpData[cmpSet] || [];
  if (!items.length) {
    list.innerHTML = '<div class="chk-empty">এই তালিকায় কিছু নেই</div>';
    return;
  }
  list.innerHTML = items.map((it) => `
    <div class="chk-row cmp-row">
      <div class="chk-name">${adminEsc(it.name)}</div>
      <div class="chk-url">${adminEsc(it.group || "—")}</div>
      <div class="cmp-n">${it.urls.length}</div>
    </div>`).join("");
}

function setCmpFilter(key) {
  cmpSet = key;
  $$("#cmpTabs .chk-tab").forEach((b) => b.classList.toggle("active", b.dataset.set === key));
  cmpRender();
}

async function cmpCopy() {
  const items = cmpData[cmpSet] || [];
  if (!items.length) { toast("কপি করার মতো কিছু নেই"); return; }
  try {
    await navigator.clipboard.writeText(items.map((i) => i.name).join("\n"));
    toast(items.length + " চ্যানেল কপি হয়েছে");
  } catch {
    toast("কপি করা যায়নি");
  }
}

function cmpExport() {
  const items = cmpData[cmpSet] || [];
  if (!items.length) { toast("এক্সপোর্ট করার মতো কিছু নেই"); return; }
  const lines = ["#EXTM3U"];
  items.forEach((it) => {
    const urls = it.urls.length ? it.urls : [""];
    urls.forEach((u) => {
      lines.push('#EXTINF:-1 group-title="' + (it.group || "Other").replace(/"/g, "") + '",' + it.name);
      if (u) lines.push(u);
    });
  });
  const blob = new Blob([lines.join("\n")], { type: "audio/x-mpegurl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "channels-" + cmpSet + ".m3u";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("M3U ডাউনলোড হচ্ছে");
}

function cmpClear() {
  ["cmpUrlA", "cmpUrlB"].forEach((id) => { const el = $("#" + id); if (el) el.value = ""; });
  ["cmpTextA", "cmpTextB"].forEach((id) => { const el = $("#" + id); if (el) el.value = ""; });
  cmpData = { both: [], a: [], b: [] };
  const results = $("#cmpResults");
  if (results) results.classList.add("hidden");
  setCmpStatus("");
}

// ------------------------------------------------------------
// wiring
// ------------------------------------------------------------
function setupToolsExtras() {
  // Every block is independent on purpose: if one ever fails (missing element,
  // bad config) the rest of the Tools page keeps working instead of going dead.
  try { renderAdminPlaylists(); } catch (e) { console.error("Admin playlists failed:", e); }

  try {
    $("#cmpRunBtn")?.addEventListener("click", cmpRun);
    $("#cmpClearBtn")?.addEventListener("click", cmpClear);
    $("#cmpCopy")?.addEventListener("click", cmpCopy);
    $("#cmpExport")?.addEventListener("click", cmpExport);
    $$("#cmpTabs .chk-tab").forEach((b) => b.addEventListener("click", () => setCmpFilter(b.dataset.set)));
    ["cmpUrlA", "cmpUrlB"].forEach((id) => {
      $("#" + id)?.addEventListener("keydown", (e) => { if (e.key === "Enter") cmpRun(); });
    });
  } catch (e) { console.error("Compare tool failed:", e); }

  try { $("#adminPlayerClose")?.addEventListener("click", adminClosePlayer); } catch (e) { console.error("Admin player failed:", e); }

  try {
    adminFloat = setupAutoFloat($("#adminPlayerCol"), {
      thresholdPad: 140,
      canFloat: () => !!adminCurrent,
    });
  } catch (e) { console.error("Tools float failed:", e); }

  try {
    setupAutoFloat($("#playerPane"), {
      thresholdPad: 120,
      canFloat: () => !!currentChannel,
    });
  } catch (e) { console.error("Player float failed:", e); }
}

// ---------- INIT ----------
async function init() {
  try { setupThemeToggle(); } catch (e) { console.error("Theme toggle failed to start:", e); }
  try { setupToolsPage(); } catch (e) { console.error("Tools page failed to start:", e); } // never let Tools block the main site
  try { setupToolsExtras(); } catch (e) { console.error("Tools extras failed to start:", e); }
  setupHomeButton();
  setupSearch();
  setupHelpDrawer();
  setupServerFilterMenu();
  setupOffChannelToggle();
  setupChipScrollIndicator();
  setupPaneHeightSync();
  setupPlayerControls();
  startBSTClockEngine();
  initVisitorCounter();

  setSplashProgress(20, "প্লেলিস্ট আনা হচ্ছে…");

  // Stale-while-revalidate: if every source has a recent cached copy (from a
  // visit within the last 20 minutes), paint the whole grid from that cache
  // immediately — no network wait at all — and hide the splash right away.
  // The real network fetch below still runs (or continues) in the
  // background and quietly refreshes everything once it lands.
  let paintedFromCache = false;
  const cachedPlaylists = getFreshCachedPlaylists();
  if (cachedPlaylists.length === SOURCE_NAMES.length) {
    try {
      const cachedAdminConfig = getFreshCachedAdminConfig();
      if (cachedAdminConfig) applyAdminConfigData(cachedAdminConfig);

      CHANNELS = mergeAllChannels(withCustomSource(cachedPlaylists)).filter((c) => !ADMIN_HIDDEN_SLUGS.includes(slugify(c.name)));
      if (CHANNELS.length) {
        buildGroups();
        renderServerFilterMenu();
        renderChipBar();
        applyFilters();
        renderLiveEventsRow();
        renderUpdatesTicker();
        setSplashProgress(100, "");
        setTimeout(hideSplash, 120);
        paintedFromCache = true;
      }
    } catch {
      paintedFromCache = false;
    }
  }

  try {
    const [results] = await Promise.all([fetchPlaylist(), fetchAdminConfig()]);
    setSplashProgress(65, "চ্যানেল সাজানো হচ্ছে…");
    CHANNELS = mergeAllChannels(withCustomSource(results)).filter((c) => !ADMIN_HIDDEN_SLUGS.includes(slugify(c.name)));
    if (!CHANNELS.length) throw new Error("empty");

    buildGroups();
    renderServerFilterMenu();
    renderChipBar();
    applyFilters();
    renderLiveEventsRow();
    renderUpdatesTicker();

    // Classify every channel in the background so only the live ones stay
    // listed, and keep re-checking so anything that comes back online returns.
    startStatusSweep();
    startPeriodicRecheck();

    setSplashProgress(100, "");
    if (!paintedFromCache) setTimeout(hideSplash, 350);
  } catch (e) {
    if (!paintedFromCache) {
      setSplashProgress(100, "লোড ব্যর্থ হয়েছে — আবার চেষ্টা করা হচ্ছে");
      setTimeout(() => location.reload(), 2500);
    }
    // Already showing a good cached copy of the site — a failed background
    // refresh shouldn't force a reload loop on top of a working page.
  }
}

// ---------- Theme (dark / light) ----------
// The saved choice is applied by a tiny inline script in <head> before first paint;
// this only wires the toggle button and keeps other open tabs in sync.
const LS_THEME = "shamim_theme";
let _themeWired = false;
function currentTheme() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }
function applyTheme(theme, persist) {
  const t = theme === "light" ? "light" : "dark";
  if (t === "light") document.documentElement.setAttribute("data-theme", "light");
  else document.documentElement.removeAttribute("data-theme");
  const b = document.getElementById("themeBtn");
  if (b) { b.setAttribute("aria-pressed", String(t === "light")); b.title = t === "light" ? "ডার্ক থিমে যান" : "লাইট থিমে যান"; }
  if (persist) { try { localStorage.setItem(LS_THEME, t); } catch {} }
}
function setupThemeToggle() {
  if (_themeWired) return;
  _themeWired = true;
  applyTheme(currentTheme(), false); // sync button state with what the head script applied
  const b = document.getElementById("themeBtn");
  if (b) b.addEventListener("click", () => applyTheme(currentTheme() === "light" ? "dark" : "light", true));
  window.addEventListener("storage", (e) => { if (e.key === LS_THEME) applyTheme(e.newValue === "light" ? "light" : "dark", false); });
}

// =====================================================================
// TOOLS — My Saved Playlists + M3U Checker
// Ported from the old Blogger site's Tools tab. Everything here is
// self-contained: setupToolsPage() is called inside try/catch from init(),
// so an error in this block can never stop the main site from loading.
// =====================================================================
const LS_SAVED_PLAYLISTS = "iptv_saved_playlists";
const LS_CUSTOM_CHANNELS = "shamim_custom_channels_v1";
const CHECK_TIMEOUT_MS = 10000;   // per-channel verdict deadline (same as the old tool)
const CHECK_CONCURRENCY = 6;      // channels tested at the same time

let checkerChannels = [];         // [{ id, name, url, logo, group, status, selected }]
let checkerFilter = "all";        // all | working | blocked | dead
let checkerRun = 0;               // bumped on every new load/clear so stale async results are ignored
let checkerSeq = 0;               // unique row ids

const escHtml = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Custom channels (saved from the checker, merged into the site) ----------
function loadCustomChannels() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_CUSTOM_CHANNELS) || "[]");
    return Array.isArray(v) ? v.filter((c) => c && c.name && c.url) : [];
  } catch { return []; }
}
function hasCustomChannels() { return loadCustomChannels().length > 0; }
function allSourceNames() { return hasCustomChannels() ? ["Custom", ...SOURCE_NAMES] : SOURCE_NAMES; }

const m3uAttr = (v) => String(v == null ? "" : v).replace(/"/g, "'").replace(/[\r\n]+/g, " ").trim();
const m3uText = (v) => String(v == null ? "" : v).replace(/[\r\n]+/g, " ").trim();

// Builds playlist text with REAL newline characters. (The old Blogger tool wrote
// the two characters "\" + "n" between #EXTINF and the URL, which produced
// playlists — like skytop — with every entry jammed onto one line.)
function channelsToM3U(list) {
  const out = ["#EXTM3U"];
  list.forEach((c) => {
    out.push(`#EXTINF:-1 tvg-logo="${m3uAttr(c.logo)}" group-title="${m3uAttr(c.group)}",${m3uText(c.name)}`);
    out.push(c.url);
  });
  return out.join("\n") + "\n";
}

// Saved Custom channels join the normal merge as one more source, listed
// first so the URLs the user hand-picked as "working" become Server 1.
function withCustomSource(results) {
  const list = loadCustomChannels();
  if (!list.length) return results;
  return [{ source: "Custom", text: channelsToM3U(list) }, ...results];
}

// ---------- small helpers ----------
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove();
    return ok;
  } catch { return false; }
}

// Reads a remote text file the same way the playlists are loaded: direct
// first, CORS proxies in parallel as fallback.
async function toolsFetchText(url) {
  const tryProxy = async (wrap) => {
    const res = await fetchWithTimeout(wrap(url), { cache: "no-store" }, 15000);
    if (!res.ok) throw new Error("bad status " + res.status);
    return res.text();
  };
  return Promise.any(CORS_PROXIES.map(tryProxy));
}

function nameFromUrl(u) {
  try {
    const x = new URL(u);
    const last = x.pathname.split("/").filter(Boolean).pop() || x.hostname;
    return decodeURIComponent(last).replace(/\.(m3u8?|ts|mp4)$/i, "") || u;
  } catch { return u; }
}
const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(u);

// M3U text -> [{ name, url, logo, group }]. Reuses the site's own parser, so
// quirks it already handles (literal "\n" files, commas inside logo URLs…) work here too.
function parseToCheckerChannels(text, defaultGroup) {
  const out = [];
  parseSingleSourceRaw(text).forEach((e) => {
    (e.sources || []).forEach((url) => out.push({ name: e.name, url, logo: e.logo || "", group: e.group || defaultGroup || "" }));
  });
  return out;
}
function urlsToCheckerChannels(urls, group) {
  return urls.map((url) => ({ name: nameFromUrl(url), url, logo: "", group }));
}

// ---------- page open / close ----------
function openToolsPage() {
  document.body.classList.add("tools-mode");
  const b = $("#toolsBtn"); if (b) { b.classList.add("active"); b.setAttribute("aria-pressed", "true"); }
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function closeToolsPage() {
  if (!document.body.classList.contains("tools-mode")) return;
  document.body.classList.remove("tools-mode");
  const adminVideo = $("#adminVideoNode");
  if (adminVideo && !adminVideo.paused) { adminVideo.pause(); try { adminSyncPlayIcon(); } catch {} }
  const b = $("#toolsBtn"); if (b) { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); }
  requestAnimationFrame(() => { try { syncPaneHeights(); } catch {} }); // player pane was hidden — re-measure
}
function toggleToolsPage() {
  document.body.classList.contains("tools-mode") ? closeToolsPage() : openToolsPage();
}

// ---------- My Saved Playlists ----------
function loadSavedPlaylists() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_SAVED_PLAYLISTS) || "[]");
    return Array.isArray(v) ? v.filter((p) => p && p.url) : [];
  } catch { return []; }
}
function saveSavedPlaylists(list) {
  try { localStorage.setItem(LS_SAVED_PLAYLISTS, JSON.stringify(list)); return true; } catch { return false; }
}
function renderSavedPlaylists() {
  const box = $("#plStoreList"); if (!box) return;
  const list = loadSavedPlaylists();
  if (!list.length) { box.innerHTML = `<div class="pl-store-empty">এখনো কোনো প্লেলিস্ট সেভ করা নেই</div>`; return; }
  box.innerHTML = list.map((p, i) => `
    <div class="pl-store-item" data-i="${i}">
      <div class="pl-store-info">
        <div class="pl-store-name">${escHtml(p.name || nameFromUrl(p.url))}</div>
        <div class="pl-store-link" title="${escHtml(p.url)}">${escHtml(p.url)}</div>
      </div>
      <button class="pl-store-btn load" data-act="load" type="button"><i class="fa-solid fa-play"></i> Load</button>
      <button class="pl-store-btn del" data-act="del" type="button"><i class="fa-solid fa-trash-can"></i></button>
    </div>`).join("");
}
function addSavedPlaylist() {
  const nameEl = $("#plStoreName"), urlEl = $("#plStoreUrl");
  const url = (urlEl.value || "").trim();
  const name = (nameEl.value || "").trim() || nameFromUrl(url);
  if (!isHttpUrl(url)) return toast("সঠিক প্লেলিস্ট URL দিন (http/https)");
  const list = loadSavedPlaylists();
  const existing = list.find((p) => p.url === url);
  if (existing) existing.name = name; else list.push({ name, url });
  if (!saveSavedPlaylists(list)) return toast("সেভ করা যায়নি (স্টোরেজ ভর্তি?)");
  nameEl.value = ""; urlEl.value = "";
  renderSavedPlaylists();
  toast(existing ? "প্লেলিস্ট আপডেট হয়েছে" : "প্লেলিস্ট সেভ হয়েছে");
}

// ---------- Checker: loading channels into the list ----------
function setChkStatus(msg, kind) {
  const el = $("#chkStatus"); if (!el) return;
  el.textContent = msg || "";
  el.className = "chk-status" + (kind ? " " + kind : "");
}

function setCheckerChannels(list, msg) {
  checkerRun++;
  checkerChannels = list.map((c) => ({ id: ++checkerSeq, name: c.name, url: c.url, logo: c.logo || "", group: c.group || "", status: "checking", selected: false }));
  checkerFilter = "all";
  renderCheckerResults();
  if (msg) setChkStatus(msg, "ok");
  startCheckerQueue();
}

function clearChecker() {
  checkerRun++;            // stop anything still running
  checkerChannels = [];
  renderCheckerResults();
  setChkStatus("");
}

async function loadPlaylistFromUrl(url, label) {
  setChkStatus("⏳ লোড হচ্ছে…");
  try {
    const text = await toolsFetchText(url);
    const list = parseToCheckerChannels(text, "");
    if (!list.length) return setChkStatus("⚠ এই লিংকে কোনো চ্যানেল পাওয়া যায়নি", "err");
    setCheckerChannels(list, `✓ ${list.length} channels loaded${label ? " — " + label : ""} — Checking status…`);
  } catch {
    setChkStatus("✗ লিংক লোড করা যায়নি (বন্ধ বা ব্লকড)", "err");
  }
}

const looksLikeHlsManifest = (t) => /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|VERSION)/.test(t);
const looksLikeDirectStream = (u) => isTsStream(u) || /\.(mp4|mkv|flv|aac|mp3)(\?|#|$)/i.test(u);

function playDirectStream(url) {
  const ch = { id: "chk_direct_" + Date.now(), name: nameFromUrl(url), logo: "", group: "Direct", sources: [url], sourceTags: new Set(["Checker"]), liveStatus: "on" };
  closeToolsPage();
  openPlayer(ch);
}

async function chkPlay() {
  const url = ($("#chkSingleUrl").value || "").trim();
  if (!isHttpUrl(url)) return setChkStatus("✗ সঠিক URL দিন", "err");
  if (looksLikeDirectStream(url)) return playDirectStream(url);
  setChkStatus("⏳ চেক করা হচ্ছে…");
  let text = "";
  try { text = await toolsFetchText(url); }
  catch {
    // can't read it (CORS etc.) — a .m3u8 link is most likely a stream, so just try to play it
    if (/\.m3u8(\?|#|$)/i.test(url)) return playDirectStream(url);
    return setChkStatus("✗ লিংক লোড করা যায়নি (বন্ধ বা ব্লকড)", "err");
  }
  if (looksLikeHlsManifest(text)) return playDirectStream(url);
  const list = parseToCheckerChannels(text, "");
  if (!list.length) return setChkStatus("⚠ এই লিংকে কোনো চ্যানেল পাওয়া যায়নি", "err");
  setCheckerChannels(list, `✓ ${list.length} channels loaded — Checking status…`);
}

async function chkCheck() {
  const url = ($("#chkSingleUrl").value || "").trim();
  if (!isHttpUrl(url)) return setChkStatus("✗ সঠিক URL দিন", "err");
  if (looksLikeDirectStream(url)) {
    setChkStatus("⏳ স্ট্রিম টেস্ট হচ্ছে…");
    return checkStreamStatus(url, (st) => setChkStatus(
      st === "working" ? "✓ Working stream" : st === "blocked" ? "⛔ Blocked (403/451)" : "✗ Dead / unreachable",
      st === "working" ? "ok" : "err"));
  }
  setChkStatus("⏳ চেক করা হচ্ছে…");
  try {
    const text = await toolsFetchText(url);
    if (looksLikeHlsManifest(text)) return setChkStatus("✓ Valid HLS stream", "ok");
    const n = (text.match(/#EXTINF/g) || []).length;
    n ? setChkStatus(`✓ Valid M3U — ${n} channels found`, "ok") : setChkStatus("✗ Not a valid playlist", "err");
  } catch { setChkStatus("✗ Invalid or unreachable URL", "err"); }
}

function handleCheckerFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const list = parseToCheckerChannels(String(reader.result || ""), "");
    if (!list.length) return setChkStatus("⚠ ফাইলে কোনো চ্যানেল পাওয়া যায়নি", "err");
    setCheckerChannels(list, `✓ ${list.length} channels loaded — ${file.name} — Checking status…`);
  };
  reader.onerror = () => setChkStatus("✗ ফাইল পড়া যায়নি", "err");
  reader.readAsText(file);
}

async function chkBulkRun() {
  const raw = ($("#chkBulk").value || "").trim();
  if (!raw) return setChkStatus("⚠ আগে কিছু পেস্ট করুন", "err");

  // 1) pasted M3U text
  if (/#EXTM3U|#EXTINF/.test(raw)) {
    const list = parseToCheckerChannels(raw, "");
    if (list.length) return setCheckerChannels(list, `✓ ${list.length} channels loaded — Checking status…`);
  }
  // 2) pasted HTML -> pull out stream/playlist links
  if (/<\/?[a-z][\s\S]*>/i.test(raw)) {
    const found = [...new Set(raw.match(/https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|m3u|ts)(?:\?[^\s"'<>\\]*)?/gi) || [])];
    if (found.length) return setCheckerChannels(urlsToCheckerChannels(found, "HTML"), `✓ ${found.length} links found — Checking status…`);
  }
  // 3) one URL per line
  const urls = [...new Set(raw.split(/\r?\n/).map((l) => l.trim()).filter(isHttpUrl))];
  if (!urls.length) return setChkStatus("⚠ কোনো বৈধ M3U বা URL পাওয়া যায়নি", "err");
  if (urls.length === 1 && !looksLikeDirectStream(urls[0])) return loadPlaylistFromUrl(urls[0], "");
  setCheckerChannels(urlsToCheckerChannels(urls, "Bulk"), `✓ ${urls.length} URLs loaded — Checking status…`);
}

// ---------- Checker: the actual testing ----------
// Verdicts (same rules as the old tool): working = real data/segment arrived;
// blocked = HTTP 403/451; dead = anything else, including no answer in 10s.
function checkStreamStatus(url, done) {
  let finished = false, hls = null, mp = null, timer = null;
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.preload = "auto";
  video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9px;top:-9px;";
  document.body.appendChild(video);

  const finish = (status) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    try { if (hls) { hls.stopLoad(); hls.destroy(); } } catch {}
    try { if (mp) { mp.pause(); mp.unload(); mp.detachMediaElement(); mp.destroy(); } } catch {}
    try { video.pause(); video.removeAttribute("src"); video.load(); video.remove(); } catch {}
    done(status);
  };
  timer = setTimeout(() => finish("dead"), CHECK_TIMEOUT_MS);

  try {
    if (isTsStream(url) && typeof mpegts !== "undefined" && mpegts.isSupported()) {
      mp = mpegts.createPlayer({ type: "mpegts", url, isLive: true, cors: true });
      mp.attachMediaElement(video);
      mp.on(mpegts.Events.ERROR, (type, detail, info) => finish(info && info.code === 403 ? "blocked" : "dead"));
      mp.on(mpegts.Events.MEDIA_INFO, () => finish("working"));
      mp.on(mpegts.Events.STATISTICS_INFO, (st) => { if (st && st.speed > 0) finish("working"); });
      video.addEventListener("canplay", () => finish("working"));
      mp.load();
      return;
    }
    if (window.Hls && Hls.isSupported()) {
      hls = new Hls({
        manifestLoadingTimeOut: 8000, manifestLoadingMaxRetry: 0,
        levelLoadingTimeOut: 8000, levelLoadingMaxRetry: 0,
        fragLoadingTimeOut: 8000, fragLoadingMaxRetry: 0, debug: false,
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      // a parsed manifest proves nothing (it can stay valid after a token expires) —
      // only an actual media fragment counts as "working"
      hls.on(Hls.Events.FRAG_LOADED, () => finish("working"));
      video.addEventListener("canplay", () => finish("working"));
      video.addEventListener("playing", () => finish("working"));
      hls.on(Hls.Events.ERROR, (evt, data) => {
        if (!data || !data.fatal) return;
        const code = data.response && data.response.code;
        finish(code === 403 || code === 451 ? "blocked" : "dead");
      });
      return;
    }
    // no hls.js support: let the browser try natively
    video.addEventListener("canplay", () => finish("working"));
    video.addEventListener("playing", () => finish("working"));
    video.addEventListener("error", () => finish("dead"));
    video.src = url; video.load();
  } catch { finish("dead"); }
}

// Runs up to CHECK_CONCURRENCY checks at once (the old tool fired them all at
// once with a 300ms stagger, which hammered the browser on long lists).
function startCheckerQueue() {
  const run = checkerRun;
  let cursor = 0;
  const next = () => {
    if (run !== checkerRun) return;                         // a newer load/clear replaced this list
    while (cursor < checkerChannels.length && checkerChannels[cursor].status !== "checking") cursor++;
    if (cursor >= checkerChannels.length) return;
    const c = checkerChannels[cursor++];
    checkStreamStatus(c.url, (status) => {
      if (run !== checkerRun) return;
      setRowStatus(c, status);
      next();
    });
  };
  for (let i = 0; i < CHECK_CONCURRENCY; i++) next();
}

// ---------- Checker: rendering ----------
const BADGE_TEXT = { working: "WORKING", blocked: "BLOCKED", dead: "DEAD", checking: "CHECKING…" };

function rowHtml(c) {
  const initials = escHtml((c.name || "?").slice(0, 2).toUpperCase());
  const logo = c.logo
    ? `<img src="${escHtml(c.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-i="${initials}" onerror="this.parentNode.textContent=this.dataset.i">`
    : initials;
  return `<div class="chk-row" id="chk-row-${c.id}" data-id="${c.id}" data-status="${c.status}">
    <input type="checkbox" class="chk-cb"${c.selected ? " checked" : ""}>
    <div class="chk-logo">${logo}</div>
    <div class="chk-info"><div class="chk-name" title="${escHtml(c.name)}">${escHtml(c.name)}</div><div class="chk-url" title="${escHtml(c.url)}">${escHtml(c.url)}</div></div>
    <span class="chk-badge ${c.status}">${BADGE_TEXT[c.status] || ""}</span>
    <div class="chk-actions">
      <button class="chk-act" data-act="copy" type="button" title="URL কপি"><i class="fa-regular fa-copy"></i></button>
      <button class="chk-act rm" data-act="remove" type="button" title="তালিকা থেকে সরান"><i class="fa-solid fa-xmark"></i></button>
      <button class="chk-act" data-act="play" type="button" title="প্লে করুন"><i class="fa-solid fa-play"></i></button>
    </div>
  </div>`;
}

function setRowStatus(c, status) {
  c.status = status;
  const row = document.getElementById("chk-row-" + c.id);
  if (row) {
    row.dataset.status = status;
    const b = row.querySelector(".chk-badge");
    if (b) { b.className = "chk-badge " + status; b.textContent = BADGE_TEXT[status] || ""; }
  }
  updateCheckerSummary();
}

function checkerCounts() {
  const n = { all: checkerChannels.length, working: 0, blocked: 0, dead: 0, checking: 0 };
  checkerChannels.forEach((c) => { if (n[c.status] !== undefined && c.status !== "checking") n[c.status]++; else n.checking++; });
  return n;
}

function updateCheckerSummary() {
  const n = checkerCounts();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("chkNAll", n.all); set("chkNWorking", n.working); set("chkNBlocked", n.blocked); set("chkNDead", n.dead);
  const s = $("#chkSummary");
  if (s) s.innerHTML = `${n.all} channels — <b class="w">${n.working} working</b> · <b class="d">${n.dead + n.blocked} Dead/Blocked</b> · ${n.checking} Checking`;
}

function renderCheckerResults() {
  const box = $("#chkResults"), listEl = $("#chkList");
  if (!box || !listEl) return;
  if (!checkerChannels.length) { box.classList.add("hidden"); listEl.innerHTML = ""; updateCheckerSummary(); return; }
  box.classList.remove("hidden");
  listEl.dataset.filter = checkerFilter;
  listEl.innerHTML = checkerChannels.map(rowHtml).join("");
  $$("#chkTabs .chk-tab").forEach((t) => t.classList.toggle("active", t.dataset.filter === checkerFilter));
  updateCheckerSummary();
}

function setCheckerFilter(f) {
  checkerFilter = f;
  const listEl = $("#chkList"); if (listEl) listEl.dataset.filter = f;
  $$("#chkTabs .chk-tab").forEach((t) => t.classList.toggle("active", t.dataset.filter === f));
}

const visibleCheckerChannels = () => checkerChannels.filter((c) => checkerFilter === "all" || c.status === checkerFilter);
const checkerChannelById = (id) => checkerChannels.find((c) => c.id === Number(id));

function syncCheckerCheckboxes() {
  $$("#chkList .chk-row").forEach((row) => {
    const c = checkerChannelById(row.dataset.id); const cb = row.querySelector(".chk-cb");
    if (c && cb) cb.checked = !!c.selected;
  });
}

// ---------- Checker: toolbar actions ----------
async function copyChannels(list, label) {
  if (!list.length) return toast(`${label}: কোনো চ্যানেল নেই`);
  const ok = await copyText(channelsToM3U(list));
  toast(ok ? `${list.length}টা চ্যানেল কপি হয়েছে (${label})` : "কপি করা যায়নি");
}

function playCheckerChannel(c) {
  const ch = { id: "chk_" + c.id, name: c.name, logo: c.logo, group: c.group || "Checker", sources: [c.url], sourceTags: new Set(["Checker"]), liveStatus: "on" };
  closeToolsPage();
  openPlayer(ch);
}

function saveSelectedAsCustom() {
  const picked = checkerChannels.filter((c) => c.selected);
  if (!picked.length) return toast("আগে সেভ করার চ্যানেলগুলো সিলেক্ট করুন");
  const byUrl = new Map(loadCustomChannels().map((c) => [c.url, c]));
  let added = 0;
  picked.forEach((c) => {
    if (!byUrl.has(c.url)) added++;
    byUrl.set(c.url, { name: c.name, url: c.url, logo: c.logo, group: c.group });
  });
  try { localStorage.setItem(LS_CUSTOM_CHANNELS, JSON.stringify([...byUrl.values()])); }
  catch { return toast("সেভ করা যায়নি (স্টোরেজ ভর্তি?)"); }
  toast(`${added}টা নতুন Custom চ্যানেল সেভ হয়েছে — রিলোড হচ্ছে…`);
  setTimeout(() => location.reload(), 900);
}

function removeCustomChannels() {
  const n = loadCustomChannels().length;
  if (!n) return toast("কোনো Custom চ্যানেল সেভ করা নেই");
  if (!confirm(`সেভ করা ${n}টা Custom চ্যানেল মুছে ফেলবেন?`)) return;
  try { localStorage.removeItem(LS_CUSTOM_CHANNELS); } catch {}
  toast("Custom চ্যানেল মুছে ফেলা হয়েছে — রিলোড হচ্ছে…");
  setTimeout(() => location.reload(), 900);
}

// ---------- wiring ----------
let _toolsWired = false;
function setupToolsPage() {
  if (_toolsWired) return;   // safe to call twice — listeners are only attached once
  _toolsWired = true;
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };

  on("toolsBtn", "click", toggleToolsPage);
  // typing in the main search box means "I want to browse channels" — leave Tools
  on("searchInput", "input", () => closeToolsPage());

  // saved playlists
  renderSavedPlaylists();
  on("plStoreAdd", "click", addSavedPlaylist);
  on("plStoreUrl", "keydown", (e) => { if (e.key === "Enter") addSavedPlaylist(); });
  on("plStoreList", "click", (e) => {
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const item = btn.closest(".pl-store-item"); const list = loadSavedPlaylists(); const p = list[Number(item.dataset.i)];
    if (!p) return;
    if (btn.dataset.act === "load") {
      loadPlaylistFromUrl(p.url, p.name);
      const r = $("#chkResults") || $("#chkStatus"); if (r) r.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (btn.dataset.act === "del") {
      if (!confirm(`"${p.name || p.url}" মুছে ফেলবেন?`)) return;
      list.splice(Number(item.dataset.i), 1); saveSavedPlaylists(list); renderSavedPlaylists();
    }
  });

  // single URL / file / bulk
  on("chkPlayBtn", "click", chkPlay);
  on("chkCheckBtn", "click", chkCheck);
  on("chkSingleUrl", "keydown", (e) => { if (e.key === "Enter") chkPlay(); });
  on("chkBrowseBtn", "click", () => { const f = $("#chkFileInput"); if (f) f.click(); });
  on("chkFileInput", "change", (e) => { handleCheckerFile(e.target.files && e.target.files[0]); e.target.value = ""; });
  on("chkClearBtn", "click", () => { const u = $("#chkSingleUrl"); if (u) u.value = ""; clearChecker(); });
  on("chkRemoveCustomBtn", "click", removeCustomChannels);
  on("chkCheckAllBtn", "click", chkBulkRun);
  on("chkBulkClearBtn", "click", () => { const b = $("#chkBulk"); if (b) b.value = ""; clearChecker(); });

  // results: filter tabs, row actions, checkboxes
  on("chkTabs", "click", (e) => { const t = e.target.closest(".chk-tab"); if (t) setCheckerFilter(t.dataset.filter); });
  on("chkList", "click", (e) => {
    const btn = e.target.closest(".chk-act"); if (!btn) return;
    const row = btn.closest(".chk-row"); const c = row && checkerChannelById(row.dataset.id); if (!c) return;
    if (btn.dataset.act === "copy") copyText(c.url).then((ok) => toast(ok ? "URL কপি হয়েছে" : "কপি করা যায়নি"));
    else if (btn.dataset.act === "play") playCheckerChannel(c);
    else if (btn.dataset.act === "remove") {
      checkerChannels = checkerChannels.filter((x) => x !== c);
      row.remove();
      checkerChannels.length ? updateCheckerSummary() : renderCheckerResults();
    }
  });
  on("chkList", "change", (e) => {
    if (!e.target.classList.contains("chk-cb")) return;
    const row = e.target.closest(".chk-row"); const c = row && checkerChannelById(row.dataset.id);
    if (c) c.selected = e.target.checked;
  });

  // toolbar
  on("chkSelectAll", "click", () => {
    const vis = visibleCheckerChannels();
    const allSelected = vis.length > 0 && vis.every((c) => c.selected);
    vis.forEach((c) => { c.selected = !allSelected; });
    syncCheckerCheckboxes();
  });
  on("chkCopySelected", "click", () => copyChannels(checkerChannels.filter((c) => c.selected), "Selected"));
  on("chkCopyWorking", "click", () => copyChannels(checkerChannels.filter((c) => c.status === "working"), "Working"));
  on("chkCopyDead", "click", () => copyChannels(checkerChannels.filter((c) => c.status === "dead"), "Dead"));
  on("chkCopyBlocked", "click", () => copyChannels(checkerChannels.filter((c) => c.status === "blocked"), "Blocked"));
  on("chkSaveCustom", "click", saveSelectedAsCustom);

  const n = loadCustomChannels().length;
  if (n) setChkStatus(`${n}টা Custom চ্যানেল সেভ করা আছে`);
}


document.addEventListener("DOMContentLoaded", init);
