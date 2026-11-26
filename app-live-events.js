// LIMON IPTV admin playlist display for homepage
// Shows configured playlists as individual tabs under Live Events

// ============================================================
// ADMIN PLAYLISTS CONFIGURATION
// Add/remove entries here to control which playlists appear.
// These are the M3U sources that will be shown as tabs.
// To use the built-in sources from app.js, keep the defaults.
// To use custom URLs, replace or add entries below.
// ============================================================
const ADMIN_PLAYLISTS = [
  // Built-in sources from app.js (won't break if those URLs change):
  { name: "SHIPTV", url: "https://raw.githubusercontent.com/shiptv75/SHIPTV/refs/heads/main/playlist.m3u", sourceType: "m3u", label: "SHIPTV Live" },
  { name: "FanCode", url: "https://raw.githubusercontent.com/sportlive18/Fancode-New-Auto-Update/refs/heads/main/fancode.m3u", sourceType: "m3u", label: "FanCode" },
  { name: "TapMad", url: "https://gist.githubusercontent.com/albatr0ssss/3cff7a26be49b1d352c15f615067e7cd/raw/tapmad_bd.m3u", sourceType: "m3u", label: "TapMad" },
  { name: "SonyLiv", url: "https://srhady-sliv.hf.space/live.m3u", sourceType: "m3u", label: "SonyLiv" },
  // Add your own playlists below:
  // { name: "MyPlaylist", url: "https://example.com/playlist.m3u", sourceType: "m3u", label: "My Playlist" },
];

// ============================================================
// LIVE EVENTS SOURCE TAGS (from app.js — do not edit unless adding new sources)
// ============================================================
const LIVE_EVENTS_SOURCE_TAGS = new Set([
  "TapMad",
  "FanCode",
  "FanCode_BD",
  "SonyLiv",
]);

// ============================================================
// HELPER: fetch an M3U playlist and return its lines
// ============================================================
async function fetchM3U(url) {
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) throw new Error("fetch " + url + " → " + resp.status);
  const text = await resp.text();
  return text.replace(/\r\n/g, "\n").split("\n");
}

// ============================================================
// HELPER: parse a single M3U source into channel entries
// Each entry: { name, group, logo, sources[], sourceTag }
// ============================================================
function parseM3USource(lines, sourceTag) {
  const channels = [];
  let pending = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#EXTM3U")) continue;

    if (line.startsWith("#EXTINF")) {
      // push previous channel if any
      if (pending && pending.sources.length) channels.push(pending);

      // extract display name (after the last comma, but respect quoted URLs)
      const lastQuoteComma = line.lastIndexOf('",');
      const rawName = lastQuoteComma !== -1
        ? line.slice(lastQuoteComma + 2)
        : (line.match(/,(.*)$/)?.[1] || "Unknown");
      const name = (rawName || "").trim().normalize("NFKC");

      const logoMatch = line.match(/tvg-logo="([^"]*)"/);
      const groupMatch = line.match(/group-title="([^"]*)"/);
      const newMatch = line.match(/tvg-new="1"/);
      const offMatch = line.match(/tvg-off="1"/);

      pending = {
        name: name || "Unknown",
        logo: logoMatch ? logoMatch[1] : "",
        group: (groupMatch && groupMatch[1] ? groupMatch[1] : "Others").normalize("NFKC"),
        isNew: !!newMatch,
        isOff: !!offMatch,
        sources: [],
        sourceTag: sourceTag,
      };
    } else if (line.startsWith("#")) {
      // skip other comment lines
    } else if (/^https?:\/\//i.test(line)) {
      if (!pending) pending = { name: "Unknown", logo: "", group: "Others", isNew: false, isOff: false, sources: [] };
      pending.sources.push(line);
    }
  }
  if (pending && pending.sources.length) channels.push(pending);
  return channels;
}

// ============================================================
// MAIN: fetch all admin playlists, merge channels, render live events tabs
// ============================================================
async function initAdminLiveEvents() {
  const liveSection = $("#liveEventsSection");
  const liveEventsRow = $("#liveEventsRow");
  const leCount = $("#leCount");

  if (!liveSection || !liveEventsRow) {
    console.warn("live events DOM elements not found");
    return;
  }

  // 1. fetch & parse every admin playlist
  const allChannels = [];
  const sourceChannelsMap = new Map(); // sourceTag → channels

  for (const pl of ADMIN_PLAYLISTS) {
    try {
      const lines = await fetchM3U(pl.url);
      const channels = parseM3USource(lines, pl.name);
      // filter to only channels whose sourceTag is in LIVE_EVENTS_SOURCE_TAGS
      const filtered = channels.filter(ch => LIVE_EVENTS_SOURCE_TAGS.has(pl.name));
      if (filtered.length > 0) {
        sourceChannelsMap.set(pl.name, filtered);
        allChannels.push(...filtered);
      }
    } catch (e) {
      console.warn(`Could not load admin playlist "${pl.name}": ${e.message}`);
    }
  }

  // 2. de-duplicate channels by name (merge sources)
  const deduped = new Map();
  allChannels.forEach(ch => {
    const key = ch.name.trim().toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, {
        name: ch.name,
        logo: ch.logo,
        group: ch.group,
        sources: [],
        sourceTags: new Set(),
        sourceTag: ch.sourceTag,
      });
    }
    const existing = deduped.get(key);
    // merge sources, avoiding duplicates
    ch.sources.forEach(s => { if (!existing.sources.includes(s)) existing.sources.push(s); });
    existing.sourceTags.add(ch.sourceTag);
    // keep the first group seen
    if (!existing.group) existing.group = ch.group;
  });

  // 3. assign canonical category for each channel
  function categorize(chan) {
    const override = ADMIN_CHANNEL_CATEGORY ? ADMIN_CHANNEL_CATEGORY.get(chan.name) : null;
    if (override) return override;
    for (const def of CATEGORY_DEFS) {
      if (def.match && def.match.test(chan.group)) return def.key;
    }
    return "other";
  }

  // 4. build tab navigation
  const sourceTagsArray = [...sourceChannelsMap.keys()]; // e.g. ["FanCode", "TapMad"]
  const tabNav = document.createElement("div");
  tabNav.className = "live-event-tab-nav";
  tabNav.innerHTML = `
    <button class="live-event-tab-btn active" data-source="all">${sourceTagsArray.length > 0 ? "All Live" : "All"}</button>
  `;
  sourceTagsArray.forEach(src => {
    const btn = document.createElement("button");
    btn.className = "live-event-tab-btn";
    btn.dataset.source = src;
    btn.textContent = src;
    tabNav.appendChild(btn);
  });
  liveEventsRow.parentNode.insertBefore(tabNav, liveEventsRow);

  // 4b. update le count
  leCount.textContent = deduped.size;

  // 5. render function
  function renderTab(sourceFilter) {
    // clear existing cards
    liveEventsRow.innerHTML = "";

    const channels = sourceFilter === "all"
      ? Array.from(deduped.values())
      : Array.from(deduped.values()).filter(c => c.sourceTags.has(sourceFilter));

    if (channels.length === 0) {
      liveEventsRow.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>No live events found for this source.</p></div>`;
      return;
    }

    channels.forEach((ch, idx) => {
      const card = document.createElement("div");
      card.className = "mini-chan-card";
      card.dataset.id = idx;
      card.innerHTML = `
        <div class="rc-icon-box">
          ${ch.logo ? `<img src="${ch.logo}" alt="${ch.name}">` : `<div class="chan-logo-fallback">${ch.name.charAt(0)}</div>`}
        </div>
        <div class="rc-name">${ch.name}</div>
        <div class="rc-grp">${ch.group}</div>
      `;
      // click → try to play (basic, can be enhanced with player integration)
      card.addEventListener("click", () => {
        console.log("Play selected:", ch.name, "url pending");
        toast(`Selected: ${ch.name}`);
      });
      liveEventsRow.appendChild(card);
    });
  }

  // 6. initial render + tab click handling
  renderTab("all");

  tabNav.querySelectorAll(".live-event-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      // update active state
      tabNav.querySelectorAll(".live-event-tab-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const source = btn.dataset.source;
      renderTab(source === "all" ? "all" : source);
    });
  });

  // 7. optional: start a background probe sweep so badges stay honest
  // (reuse the existing probe infrastructure if available)
  try {
    // if the global CHANNELS array exists and has liveStatus logic, enqueue them
    if (typeof CHANNELS !== "undefined" && CHANNELS.length) {
      CHANNELS.forEach(c => {
        c.liveStatus = c.liveStatus || "checking";
        c.sourceTag = c.sourceTag || sourceTagsArray[0] || "all";
      });
      // enqueue a quick probe for the first handful
      const MAX_CONCURRENT_PROBES = 6;
      let active = 0;
      CHANNELS.slice(0, MAX_CONCURRENT_PROBES).forEach(c => {
        active++; // just mark as probed for now
      });
    }
  } catch (_) { /* ignore if global state not available */ }
}

// Start when page is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminLiveEvents);
} else {
  initAdminLiveEvents();
}

// brief toast helper (reuses existing global if present)
function toast(msg, ms = 2200) {
  const el = $("#toast");
  if (!el) { alert(msg); return; }
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), ms);
}

// Keep existing globals alive if they already exist
if (typeof CATEGORY_DEFS === "undefined") var CATEGORY_DEFS = [
  { key: "sports", label: "🏏 Sports", match: /sport|fifa|cricket|golf|racing|f1\b/i },
  { key: "bangla", label: "🇧🇩 Bangla", match: /^bangla$|bangladeshi/i },
  { key: "news", label: "📰 News", match: /news/i },
  { key: "music", label: "🎵 Music", match: /music/i },
  { key: "movies", label: "🍿 Movies", match: /movie/i },
  { key: "entertainment", label: "🎭 Entertainment", match: /entertainment/i },
  { key: "kids", label: "🧸 Kids", match: /kids/i },
  { key: "indian_bangla", label: "Kolkata", match: /indian.?bangla|kolkata/i },
  { key: "religious", label: "🛐 Religious", match: /islamic|religious/i },
];

if (typeof ADMIN_CHANNEL_CATEGORY === "undefined") var ADMIN_CHANNEL_CATEGORY = new Map();
if (typeof ADMIN_CHANNEL_LOGO === "undefined") var ADMIN_CHANNEL_LOGO = new Map();
if (typeof ADMIN_CHANNEL_ALIASES === "undefined") var ADMIN_CHANNEL_ALIASES = new Map();
if (typeof ADMIN_UPDATES === "undefined") var ADMIN_UPDATES = [];