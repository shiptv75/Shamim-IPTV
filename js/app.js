// ============================================================
// SHAMIM IPTV — app.js
// ============================================================

const M3U_URL = "https://raw.githubusercontent.com/shiptv75/SHIPTV/main/playlist.m3u";
const M3U_URL_2 = "https://raw.githubusercontent.com/ahan443/FAST-IPTV/refs/heads/main/z.m3u";
const JSON_PLAYLIST_URL = "https://raw.githubusercontent.com/hossainhridoyx/HridoyTV_Server/refs/heads/main/channels.json";
const M3U_URL_TAPMAD = "https://raw.githubusercontent.com/srhady/tapmad-bd/refs/heads/main/tapmad_bd.m3u";
const M3U_URL_FANCODE = "https://raw.githubusercontent.com/sportlive18/Fancode-New-Auto-Update/refs/heads/main/fancode.m3u";
const M3U_URL_XNIPTV = "https://raw.githubusercontent.com/tvbd/m3uplayer/refs/heads/main/m3u/xniptv.m3u";
const M3U_SOURCES = [
  { url: M3U_URL, type: "m3u", source: "SHIPTV" },
  { url: M3U_URL_2, type: "m3u", source: "FAST-IPTV" },
  { url: JSON_PLAYLIST_URL, type: "json", source: "HridoyTV" },
  { url: M3U_URL_TAPMAD, type: "m3u", source: "Tapmad-BD" },
  { url: M3U_URL_FANCODE, type: "m3u", source: "FanCode" },
  { url: M3U_URL_XNIPTV, type: "m3u", source: "XNIPTV" },
];
const SOURCE_NAMES = M3U_SOURCES.map((s) => s.source);
const CORS_PROXIES = [
  (u) => u, // try direct first
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

const LS_FAV = "obiram_favorites";
const LS_RESUME = "obiram_resume";

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
  const lines = text.split(/\r?\n/);
  const raw = [];
  let pending = null;

  for (let ln of lines) {
    const line = ln.trim();
    if (!line || line.startsWith("#EXTM3U")) continue;

    if (line.startsWith("#EXTINF")) {
      if (pending && pending.sources.length) raw.push(pending);

      const nameMatch = line.match(/,(.*)$/);
      const name = (nameMatch ? nameMatch[1].trim() : "Unknown").normalize("NFKC");
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
function mergeAllChannels(sourceResults) {
  const merged = new Map();
  const order = [];

  sourceResults.forEach(({ source, text }) => {
    if (!text) return;
    const rawEntries = parseSingleSourceRaw(text);
    rawEntries.forEach((entry) => {
      const key = slugify(entry.name);
      if (!merged.has(key)) {
        merged.set(key, {
          id: key,
          name: entry.name.trim(),
          logo: entry.logo,
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
      if (!chan.logo && entry.logo) chan.logo = entry.logo;
      entry.sources.forEach((s) => { if (!chan.sources.includes(s)) chan.sources.push(s); });
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
    return chan;
  });
}

// ---------- Fetch playlist with proxy fallback ----------
async function fetchOnePlaylist(sourceDef) {
  const { url, type, source } = sourceDef;
  for (const wrap of CORS_PROXIES) {
    try {
      const res = await fetch(wrap(url), { cache: "no-store" });
      if (!res.ok) throw new Error("bad status " + res.status);
      if (type === "json") {
        const data = await res.json();
        const m3u = jsonPlaylistToM3U(data);
        if (m3u) return { source, text: m3u };
      } else {
        const text = await res.text();
        if (text && (text.includes("#EXTM3U") || text.includes("#EXTINF"))) return { source, text };
      }
    } catch (e) {
      continue;
    }
  }
  return null; // this source failed, but others may still succeed
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

async function fetchAdminConfig() {
  for (const wrap of CORS_PROXIES) {
    try {
      const res = await fetch(wrap(ADMIN_CONFIG_URL), { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      ADMIN_PINNED_SLUGS = (data.pinned || []).map(slugify);
      ADMIN_HIDDEN_SLUGS = (data.hidden || []).map(slugify);
      return;
    } catch {
      continue;
    }
  }
  // file missing or unreachable — just proceed with no pinned/hidden channels
}

const CATEGORY_DEFS = [
  { key: "sports", label: "🏏 Sports", match: /sport|fifa|cricket|golf|racing|f1\b/i },
  { key: "news", label: "📰 News", match: /news/i },
  { key: "bangla", label: "🇧🇩 Bangla", match: /^bangla$|bangladeshi/i },
  { key: "indian_bangla", label: "🇮🇳 Indian Bangla", match: /indian.?bangla|kolkata/i },
  { key: "movies", label: "🍿 Movies", match: /movie/i },
  { key: "kids", label: "🧸 Kids", match: /kids/i },
  { key: "entertainment", label: "🎭 Entertainment", match: /entertainment|music/i },
  { key: "lifestyle", label: "📖 Lifestyle", match: /document|lifestyle/i },
  { key: "religious", label: "🛐 Religious", match: /islamic|religious/i },
];

function categorize(chan) {
  for (const def of CATEGORY_DEFS) {
    if (def.match.test(chan.group)) return def.key;
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

// ---------- Live status checking (accurate ON/OFF, not just playlist metadata) ----------
// Rationale: the "off" flag from the playlist source only exists for a
// handful of HridoyTV entries. The other two M3U sources carry no such
// signal at all, so every channel from them would otherwise always render
// "ON" regardless of whether the stream actually loads. To give a genuinely
// accurate status we do a real, lightweight connectivity probe using the
// exact same loading mechanism the player itself uses (hls.js manifest
// fetch for .m3u8, a cancelled GET for everything else) — so the result
// reflects whether the stream will actually play on this site, not just
// whether the origin server is reachable in the abstract.
const LIVE_CACHE_KEY = "obiram_stream_status";
const LIVE_CACHE_TTL = 20 * 60 * 1000; // 20 minutes
const LIVE_CHECK_TIMEOUT = 7000;
// Raised from 4: every channel now gets swept in the background (not just the
// ones scrolled into view), so the whole list has to finish in a sane amount
// of time. 6 channels x up to 3 parallel source probes = ~18 in-flight
// requests worst case, which stays within what mobile browsers handle happily.
const MAX_CONCURRENT_PROBES = 6;
// Only probe the first few merged sources of a channel. Beyond three it is
// almost always the same stream mirrored again, and each extra URL costs a
// full timeout on dead channels.
const MAX_SOURCES_PER_PROBE = 3;
// How often to look for channels whose cached status has gone stale, so a
// channel that comes back online un-hides itself without a page reload.
const RECHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
// Grid is re-listed at most this often while statuses stream in, so hundreds
// of resolving probes can't cause hundreds of re-renders.
const RELIST_THROTTLE = 700;

let liveStatusCache = loadJSON(LIVE_CACHE_KEY, {});
let activeProbes = 0;
const probeQueue = [];
let statusObserver = null;

function getCachedStatus(chan) {
  const entry = liveStatusCache[chan.id];
  if (entry && Date.now() - entry.ts < LIVE_CACHE_TTL) return entry.status;
  return null;
}
function setCachedStatus(chan, status) {
  liveStatusCache[chan.id] = { status, ts: Date.now() };
  saveJSON(LIVE_CACHE_KEY, liveStatusCache);
}

// Decides each channel's starting badge state before any probing happens.
function initLiveStatus(chan) {
  if (chan.isOff) { chan.liveStatus = "off"; return; } // source explicitly marked it down — authoritative
  const cached = getCachedStatus(chan);
  chan.liveStatus = cached || "checking";
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(false), ms)),
  ]);
}

function probeViaHls(url) {
  return new Promise((resolve) => {
    if (!window.Hls || !Hls.isSupported()) { resolve(null); return; } // can't tell — fall back to fetch
    let done = false;
    const hls = new Hls({ manifestLoadingTimeOut: LIVE_CHECK_TIMEOUT, manifestLoadingMaxRetry: 0 });
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { hls.destroy(); } catch {}
      resolve(ok);
    };
    hls.on(Hls.Events.MANIFEST_PARSED, () => finish(true));
    hls.on(Hls.Events.ERROR, (evt, data) => { if (data.fatal) finish(false); });
    try { hls.loadSource(url); } catch { finish(false); }
  });
}

async function probeViaFetch(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_CHECK_TIMEOUT);
  try {
    const res = await fetch(url, { method: "GET", mode: "cors", cache: "no-store", signal: controller.signal });
    try { res.body && res.body.cancel && res.body.cancel(); } catch {}
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Probes a single stream URL the same way the player itself would load it.
async function probeOneUrl(url) {
  try {
    if (/\.m3u8(\?|$)/i.test(url)) {
      const hlsResult = await withTimeout(probeViaHls(url), LIVE_CHECK_TIMEOUT);
      return hlsResult === null ? await withTimeout(probeViaFetch(url), LIVE_CHECK_TIMEOUT) : hlsResult;
    }
    return await withTimeout(probeViaFetch(url), LIVE_CHECK_TIMEOUT);
  } catch {
    return false;
  }
}

// Tries every merged source URL, all at once rather than one after another.
// This is what makes auto-hiding practical: a channel with 3 dead sources used
// to burn 3 x 7s = 21s before it could be called OFF, so a few hundred
// channels took forever to classify. Racing them caps a channel at roughly a
// single timeout, and the answer is identical — the badge reads ON as long as
// at least one source actually plays, matching what the server-switch dropdown
// in the player can fall back to.
function probeAnySource(urls) {
  return new Promise((resolve) => {
    const list = (urls || []).slice(0, MAX_SOURCES_PER_PROBE);
    if (!list.length) { resolve(false); return; }
    let pending = list.length;
    let settled = false;
    list.forEach((url) => {
      probeOneUrl(url)
        .catch(() => false)
        .then((ok) => {
          if (settled) return;
          if (ok) { settled = true; resolve(true); return; }
          pending -= 1;
          if (pending === 0) { settled = true; resolve(false); }
        });
    });
  });
}

async function probeChannelStatus(chan) {
  if (chan.isOff) return; // never override an authoritative source-level off
  const ok = await probeAnySource(chan.sources);
  chan.liveStatus = ok ? "on" : "off";
  setCachedStatus(chan, chan.liveStatus);
  updateCardStatusBadge(chan);
  onStatusResolved();
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

// ---------- Background sweep: classify every channel, not just visible ones ----------
// Off channels are hidden from the grid, which breaks the old lazy model: a
// hidden card never scrolls into view, so it would never be re-probed and could
// never come back once it went OFF. Sweeping the whole list in the background
// fixes that and is also what makes the channel counter honest — it can only
// count "channels that are actually on" if every channel has been checked.
function startStatusSweep() {
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
  if (text) text.textContent = `চ্যানেল চেক করা হচ্ছে… ${done}/${total}`;
}

function onStatusResolved() {
  updateScanProgress();
  scheduleRelist();
}

// Every ~5 minutes, hand back to the sweep any channel whose cached status has
// expired. A channel that has come back online flips to ON and un-hides itself
// on its own; one that went down disappears. Skipped while the tab is in the
// background so it never burns a visitor's data when nobody is looking.
function startPeriodicRecheck() {
  setInterval(() => {
    if (document.hidden) return;
    let revived = 0;
    CHANNELS.forEach((c) => {
      if (c.isOff) return;                  // source says it's down — authoritative
      if (c.liveStatus === "checking" || c._queued) return;
      if (getCachedStatus(c)) return;       // cached status still fresh
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
    <span class="chan-status ${statusClass(chan.liveStatus)}" title="স্ট্রিম স্ট্যাটাস">${statusText(chan.liveStatus)}</span>
    <div class="chan-icon-box">
      ${badgeHtml}
      ${
        chan.logo
          ? `<img src="${chan.logo}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;chan-logo-fallback&quot;>${chan.name.slice(0, 2).toUpperCase()}</div>'">`
          : `<div class="chan-logo-fallback">${chan.name.slice(0, 2).toUpperCase()}</div>`
      }
    </div>
    <div class="chan-name">${chan.name}</div>
  `;

  card.addEventListener("click", (e) => {
    if (e.target.closest(".chan-fav")) return;
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

  const items = [{ key: "all", label: "🌐 সব সোর্স" }, ...SOURCE_NAMES.map((s) => ({ key: s, label: `🖥️ ${s}` }))];
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
function renderGrid(list) {
  const grid = $("#mainGrid");
  grid.innerHTML = "";
  $("#emptyState").classList.toggle("hidden", list.length > 0);
  list.forEach((c) => grid.appendChild(channelCard(c)));
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

  renderGrid(list);
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
  renderResumeRow();

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

// ---------- Resume row ----------
function renderResumeRow() {
  const resume = loadJSON(LS_RESUME, null);
  const section = $("#resumeSection");
  if (!resume) { section.classList.add("hidden"); return; }
  const chan = CHANNELS.find((c) => c.id === resume.id);
  if (!chan) { section.classList.add("hidden"); return; }
  // Don't dangle a "continue watching" card for a channel that's now off.
  if (!isChannelVisible(chan)) { section.classList.add("hidden"); return; }
  section.classList.remove("hidden");
  const row = $("#resumeRow");
  row.innerHTML = "";
  const card = document.createElement("div");
  card.className = "resume-card";
  card.innerHTML = `
    <img src="${chan.logo || ""}" alt="" onerror="this.style.display='none'">
    <div class="rc-name">${chan.name}</div>
    <div class="rc-grp">${chan.group}</div>
  `;
  card.addEventListener("click", () => openPlayer(chan));
  row.appendChild(card);
}

function saveResume(chan) {
  saveJSON(LS_RESUME, { id: chan.id, t: Date.now() });
}

// ---------- Search ----------
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
  saveResume(chan);
  renderResumeRow();

  cvInitVideoEvents();
  playChannel(chan);

  // on mobile the player pane sits above the grid — scroll it into view
  if (window.innerWidth <= 860) {
    $("#playerPane")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function closePlayer() {
  clearTimeout(cvStallTimer);
  destroyExistingPlayers();
  cvShowPoster();
  $("#videoError")?.remove();
  $("#player-channel-title").textContent = "Select a Channel to Stream";
  $("#player-channel-status").textContent = "System Engine: Ready";
  currentChannel = null;
}

// ── same channel selected from grid/float-list/prev-next ──
function playChannel(ch) {
  currentChannel = ch;
  activeChannelIndex = CHANNELS.findIndex((c) => c.id === ch.id);

  const titleEl = $("#player-channel-title");
  if (titleEl) titleEl.textContent = ch.name;
  const statusEl = $("#player-channel-status");
  if (statusEl) statusEl.innerHTML = `▶ You're watching <strong>${ch.name}</strong> live on Shamim IPTV`;
  const logoFrame = $("#player-logo-frame");
  if (logoFrame) {
    logoFrame.innerHTML = ch.logo
      ? `<img src="${ch.logo}" style="max-width:100%;max-height:100%;object-fit:contain;" onerror="this.style.display='none'">`
      : `<i class="fa-solid fa-play" style="font-size:20px;color:var(--cv-primary);"></i>`;
  }

  cvBuildServerListFromChannel(ch);
  cvLoadStreamSource(ch.sources[0]);
}

// ── server list is simply the channel's own merged sources[] ──
function cvBuildServerListFromChannel(ch) {
  currentServerList = ch.sources.map((url, i) => ({ name: `Server ${i + 1}`, url }));
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

function toggleServerMenu() { $("#cv-server-dropdown")?.classList.toggle("open"); }
function closeServerMenu() { $("#cv-server-dropdown")?.classList.remove("open"); }
document.addEventListener("click", (e) => {
  const dd = $("#cv-server-dropdown");
  const btn = $("#cv-server-btn");
  if (dd && dd.classList.contains("open") && !dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
    closeServerMenu();
  }
});

// ── TS vs HLS detection heuristic ──
function isTsStream(url) {
  if (!url) return false;
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

// ── reusable stream loader (channel switch & server switch both use this) ──
function cvLoadStreamSource(rawUrl) {
  const video = $("#main-hybrid-video-node");
  if (!rawUrl || !video) return;

  const savedVolume = video.volume || 1;
  const savedMuted = video.muted || false;

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

  function restoreVolume() {
    video.volume = savedVolume;
    video.muted = savedMuted;
    const slider = $("#cv-vol-slider");
    if (slider) slider.value = savedMuted ? 0 : savedVolume;
    cvUpdateVolIcon(savedVolume, savedMuted);
  }

  function tryNative() {
    destroyExistingPlayers();
    video.src = url;
    restoreVolume();
    video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
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
    video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
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
      video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
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
    video.addEventListener("loadedmetadata", () => video.play().catch(() => { video.muted = true; video.play().catch(() => {}); }), { once: true });
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
  $("#videoErrorRetry").addEventListener("click", () => { box.remove(); if (currentStreamUrl) cvLoadStreamSource(currentStreamUrl); });
  $("#videoErrorServers").addEventListener("click", () => { box.remove(); toggleServerMenu(); });
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
  cvUpdateVolIcon(v.volume, v.muted);
  if (slider) slider.value = v.muted ? 0 : v.volume;
  cvShowToast(v.muted ? "🔇 Muted" : "🔊 Unmuted");
}

function cvSetVolume(val) {
  const v = $("#main-hybrid-video-node");
  if (!v) return;
  v.volume = parseFloat(val);
  v.muted = parseFloat(val) === 0;
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
  v.onplaying = () => { cvShowLoader(false); cvHidePoster(); clearTimeout(cvStallTimer); };
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
  if (e.target.closest(".cv-controls-row") || e.target.closest(".cv-progress-wrap") || e.target.closest(".cv-topright-overlay")) return;
  cvToggleFullscreen();
});

// ── floating channel-list panel inside the player ──
function cvToggleChannelSidebar() {
  const panel = $("#cv-float-chlist");
  if (!panel) return;
  panel.classList.contains("open") ? cvCloseFloatChList() : cvOpenFloatChList();
}
function cvOpenFloatChList() {
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
      ? `<img class="cv-float-ch-logo" src="${ch.logo}" onerror="this.style.display='none';this.nextSibling.style.display='block'"><div class="cv-float-ch-logo-ph" style="display:none"></div>`
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
      const s = $("#cv-vol-slider"); if (s) s.value = v.volume;
      cvShowToast("🔊 " + Math.round(v.volume * 100) + "%");
      break;
    }
    case "ArrowDown": {
      e.preventDefault();
      v.volume = Math.max(0, v.volume - 0.1);
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
  // (no-op: player is now a persistent pane, not a closable modal)
}

// ---------- INIT ----------
async function init() {
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
  try {
    const [results] = await Promise.all([fetchPlaylist(), fetchAdminConfig()]);
    setSplashProgress(65, "চ্যানেল সাজানো হচ্ছে…");
    CHANNELS = mergeAllChannels(results).filter((c) => !ADMIN_HIDDEN_SLUGS.includes(slugify(c.name)));
    if (!CHANNELS.length) throw new Error("empty");

    buildGroups();
    renderServerFilterMenu();
    renderChipBar();
    applyFilters();
    renderResumeRow();

    // Classify every channel in the background so only the live ones stay
    // listed, and keep re-checking so anything that comes back online returns.
    startStatusSweep();
    startPeriodicRecheck();

    setSplashProgress(100, "");
    setTimeout(hideSplash, 350);
  } catch (e) {
    setSplashProgress(100, "লোড ব্যর্থ হয়েছে — আবার চেষ্টা করা হচ্ছে");
    setTimeout(() => location.reload(), 2500);
  }
}

document.addEventListener("DOMContentLoaded", init);
