// Homepage playlist rows: one separate section per playlist, each scrolling
// right-to-left. Sections: Live Events + 5 admin playlists + Recents & Favs.
//
// Badges are the REAL stream status (ON / OFF / checking). For channels the
// main grid already knows, the exact SAME channel object is reused — so the
// homepage badge, the player, the main grid and the status cache can never
// disagree. Channels unique to a homepage row are probed only when they come
// into view, instead of hammering every one of the 600+ cards at page load.
(function () {
  "use strict";

  var RECENT_KEY = "shamim_last_watched_v1";
  var STATUS_KEY = "shamim_playlist_status_v1";
  var STATUS_TTL = 15 * 60 * 1000;
  var RECENT_LIMIT = 40;
  var LIVE_KEY = "__live_events__";
  var RECENT_TAB = "__recent_favs__";
  var MAX_PROBES = 8;

  var LIVE_DEFS = [
    { name: "TapMad", url: typeof M3U_URL_TAPMAD !== "undefined" ? M3U_URL_TAPMAD : "https://gist.githubusercontent.com/albatr0ssss/3cff7a26be49b1d352c15f615067e7cd/raw/tapmad_bd.m3u", type: "m3u" },
    { name: "FanCode", url: typeof M3U_URL_FANCODE !== "undefined" ? M3U_URL_FANCODE : "https://raw.githubusercontent.com/sportlive18/Fancode-New-Auto-Update/refs/heads/main/fancode.m3u", type: "m3u" },
    { name: "FanCode BD", url: typeof M3U_URL_FANCODE_BD !== "undefined" ? M3U_URL_FANCODE_BD : "https://raw.githubusercontent.com/srhady/Fancode-bd/refs/heads/main/main_playlist.json", type: "json" },
    { name: "SonyLiv", url: typeof M3U_URL_SONYLIV !== "undefined" ? M3U_URL_SONYLIV : "https://srhady-sliv.hf.space/live.m3u", type: "m3u" }
  ];

  // Hosts that reject direct browser requests (CORS / Referer checks). The site
  // proxy supplies the headers and rewrites nested playlist URLs through itself.
  var PROXY_HOSTS = [
    "fancode.com",
    "tapmad.com",
    "akamaized.net",
    "githubusercontent.com"
  ];

  var loaded = new Map();
  var sections = [];
  var scrollPaused = new WeakMap();
  var cardChannels = new WeakMap();
  var statusCache = readJSON(STATUS_KEY, {});
  var probeQueue = [];
  var activeProbes = 0;
  var cardObserver = null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function readJSON(key, fallback) {
    try {
      var value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (_) { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  // Matches app.js slugify(), including Bengali names, so a homepage card and
  // the same channel in the main grid resolve to one and the same object.
  function slug(value) {
    return String(value || "chan")
      .toLowerCase()
      .replace(/[^a-z0-9\u0980-\u09FF]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  function proxyBase() {
    return typeof STREAM_PROXY_BASE !== "undefined"
      ? STREAM_PROXY_BASE
      : "https://shamimiptv.pages.dev/api/proxy?url=";
  }

  function needsProxy(url) {
    try {
      var host = new URL(url).hostname.toLowerCase();
      return PROXY_HOSTS.some(function (suffix) {
        return host === suffix || host.endsWith("." + suffix);
      });
    } catch (_) { return false; }
  }

  function prepareSources(urls) {
    var base = proxyBase();
    return (urls || []).map(function (url) {
      if (!url || url.indexOf(base) === 0) return url; // already proxied
      return needsProxy(url) ? base + encodeURIComponent(url) : url;
    });
  }

  function mainChannels() {
    return typeof CHANNELS !== "undefined" && Array.isArray(CHANNELS) ? CHANNELS : [];
  }

  function mainMap() {
    var map = new Map();
    mainChannels().forEach(function (ch) { if (ch && ch.id) map.set(ch.id, ch); });
    return map;
  }

  function findMain(ch) {
    if (!ch || !ch.id) return null;
    return mainMap().get(ch.id) || null;
  }

  function tagSection(ch, tags) {
    if (!ch) return;
    if (!ch._sectionTags) ch._sectionTags = new Set();
    (tags || []).forEach(function (tag) { if (tag) ch._sectionTags.add(tag); });
  }

  // If the main grid has since loaded this channel, hand its real object to the
  // homepage card. That object already carries authoritative status, proof and
  // the app's own proxy handling.
  function resolveMain(ch) {
    if (!ch || ch._sharedWithMain) return ch;
    var main = findMain(ch);
    if (!main) return ch;
    tagSection(main, ch._sectionTags ? Array.from(ch._sectionTags) : []);
    main._sharedWithMain = true;
    return main;
  }

  function applyStatus(ch, entry) {
    ch.liveStatus = entry.status === "on" ? "on" : entry.status === "off" ? "off" : "checking";
    ch.verifiedUrl = entry.url || null;
    ch.verifiedAt = entry.ts || 0;
  }

  function enqueueProbe(ch, priority) {
    if (!ch || ch._sharedWithMain || ch.liveStatus !== "checking" || ch._queued) return;
    if (findMain(ch)) return; // main grid owns this channel's probe
    ch._queued = true;
    if (priority) probeQueue.unshift(ch);
    else probeQueue.push(ch);
    pumpProbeQueue();
  }

  function seedStatus(ch) {
    if (ch._sharedWithMain || findMain(ch)) return;
    if (ch.isOff) { ch.liveStatus = "off"; return; }
    var cached = statusCache[ch.id];
    if (cached && Date.now() - cached.ts < STATUS_TTL) {
      applyStatus(ch, cached);
      return;
    }
    ch.liveStatus = "checking";
  }

  function makeChannel(source, skipStatus) {
    var tags = source.sourceTags;
    if (tags && !Array.isArray(tags) && typeof tags.forEach === "function") tags = Array.from(tags);
    var id = source.id || slug(source.name);
    var main = mainMap().get(id);

    if (main) {
      tagSection(main, tags);
      main._sharedWithMain = true;
      if (!skipStatus && main.liveStatus === "checking" && typeof window.enqueueProbe === "function") {
        window.enqueueProbe(main, true);
      }
      return main;
    }

    var ch = {
      id: id,
      name: source.name || "Unknown",
      logo: source.logo || "",
      group: source.group || "Others",
      sources: prepareSources(source.sources),
      sourceTags: new Set(tags || []),
      liveStatus: "checking",
      verifiedUrl: null,
      verifiedAt: 0,
      isOff: !!source.isOff,
      _sharedWithMain: false,
      _queued: false
    };
    tagSection(ch, tags);
    if (!skipStatus) seedStatus(ch);
    return ch;
  }

  function pumpProbeQueue() {
    while (probeQueue.length && activeProbes < MAX_PROBES) {
      var ch = probeQueue.shift();
      ch._queued = false;
      if (!ch || ch.liveStatus !== "checking") continue;

      // The main grid may have loaded while this card was waiting.
      var main = findMain(ch);
      if (main) {
        tagSection(main, Array.from(ch._sectionTags || []));
        main._sharedWithMain = true;
        updateBadge(main);
        continue;
      }
      if (!ch.sources.length) { ch.liveStatus = "off"; updateBadge(ch); continue; }

      activeProbes++;
      (async function () {
        var status = "off";
        var url = null;
        try {
          if (typeof probeRaceSources === "function") {
            var result = await probeRaceSources(ch.sources.slice(0, 2));
            if (result && result.ok) { status = "on"; url = result.rawUrl; }
          }
        } catch (_) {}
        applyStatus(ch, { status: status, url: url, ts: Date.now() });
        statusCache[ch.id] = { status: ch.liveStatus, url: ch.verifiedUrl, ts: ch.verifiedAt };
        writeJSON(STATUS_KEY, statusCache);
        if (findMain(ch)) {
          // Hand over to the authoritative object if it appeared mid-probe.
          var nowMain = findMain(ch);
          tagSection(nowMain, Array.from(ch._sectionTags || []));
          nowMain._sharedWithMain = true;
          updateBadge(nowMain);
        } else {
          updateBadge(ch);
        }
        activeProbes--;
        pumpProbeQueue();
      })();
    }
  }

  function statusLabel(status) {
    if (status === "on") return "ON";
    if (status === "off") return "OFF";
    return "•••";
  }

  function updateBadge(ch) {
    if (!ch || !ch.id) return;
    var cards = document.querySelectorAll(".le-card[data-le-id]");
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].dataset.leId !== ch.id) continue;
      var badge = cards[i].querySelector(".le-badge");
      if (!badge) continue;
      badge.className = "le-badge status-" + ch.liveStatus;
      badge.textContent = statusLabel(ch.liveStatus);
      badge.title = "Stream status: " + ch.liveStatus;
      cards[i].classList.toggle("is-off", ch.liveStatus === "off");
    }
  }

  // Main-grid probes call their own badge updater, which does not know about
  // homepage cards. This small mirror keeps both badge sets identical.
  function syncMainStatuses() {
    var needsRender = false;
    sections.forEach(function (section) {
      section.channels = (section.channels || []).map(function (ch) {
        var resolved = resolveMain(ch);
        if (resolved !== ch) needsRender = true;
        return resolved;
      });
      section.channels.forEach(updateBadge);
    });
    if (needsRender) renderAll();
  }

  function manualParse(text, tag) {
    var byName = new Map();
    String(text || "").replace(/\r\n/g, "\n").split("\n").forEach(function (line) {
      line = line.trim();
      if (line.indexOf("#EXTINF") === 0) {
        var comma = line.lastIndexOf(",");
        var name = (comma === -1 ? "Unknown" : line.slice(comma + 1)).trim() || "Unknown";
        var logo = (line.match(/tvg-logo="([^"]*)"/) || [])[1] || "";
        var group = (line.match(/group-title="([^"]*)"/) || [])[1] || "Others";
        byName.set(name, makeChannel({ name: name, logo: logo, group: group, sources: [], sourceTags: [tag] }));
        return;
      }
      if (!line || line.charAt(0) === "#" || !/^https?:\/\//i.test(line)) return;
      var last = Array.from(byName.values()).pop();
      if (!last) {
        last = makeChannel({ name: "Unknown", sources: [], sourceTags: [tag] });
        byName.set(last.id, last);
      }
      if (last.sources.indexOf(line) === -1) last.sources.push(line);
    });
    return Array.from(byName.values()).filter(function (ch) { return ch.sources.length; });
  }

  async function loadPlaylist(definition) {
    var key = definition.name;
    if (loaded.has(key)) return loaded.get(key);
    var channels = [];
    try {
      var text;
      if (typeof window.toolsFetchText === "function") {
        text = await window.toolsFetchText(definition.url);
      } else {
        var response = await fetch(definition.url, { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        text = await response.text();
      }
      if (definition.type === "json") {
        text = typeof window.jsonPlaylistToM3U === "function"
          ? window.jsonPlaylistToM3U(JSON.parse(text))
          : null;
        if (!text) throw new Error("no playable matches");
      }
      channels = typeof window.adminParse === "function"
        ? window.adminParse(text).map(makeChannel)
        : manualParse(text, key);
      channels.forEach(function (ch) { tagSection(ch, [key]); });
    } catch (error) {
      console.warn("Could not load " + key + ": " + error.message);
    }
    loaded.set(key, channels);
    pumpProbeQueue();
    return channels;
  }

  function liveChannels() {
    var result = [];
    LIVE_DEFS.forEach(function (definition) {
      (loaded.get(definition.name) || []).forEach(function (channel) {
        if (!result.some(function (existing) { return existing.id === channel.id; })) result.push(channel);
      });
    });
    return result;
  }

  function recentAndFavoriteChannels() {
    var result = readJSON(RECENT_KEY, []).map(function (item) { return makeChannel(item, true); });
    var favKey = typeof LS_FAV !== "undefined" ? LS_FAV : "obiram_favorites";
    var pool = mainChannels().slice();
    sections.forEach(function (section) {
      if (section.key === RECENT_TAB) return;
      (section.channels || []).forEach(function (ch) { pool.push(ch); });
    });

    readJSON(favKey, []).forEach(function (id) {
      var found = pool.find(function (ch) { return ch.id === id; });
      if (found && !result.some(function (ch) { return ch.id === found.id; })) {
        result.push(makeChannel(found, true));
      }
    });
    return result;
  }

  function recordRecent(channel) {
    if (!channel || !channel.name) return;
    var snapshot = makeChannel(channel, true);
    var list = readJSON(RECENT_KEY, []).filter(function (item) { return item.id !== snapshot.id; });
    list.unshift({
      id: snapshot.id,
      name: snapshot.name,
      logo: snapshot.logo,
      group: snapshot.group,
      sources: snapshot.sources,
      sourceTags: Array.from(snapshot.sourceTags || []),
      at: Date.now()
    });
    writeJSON(RECENT_KEY, list.slice(0, RECENT_LIMIT));
    var recents = sections.find(function (section) { return section.key === RECENT_TAB; });
    if (recents) renderSection(recents);
  }

  function setupRowScroll(row) {
    if (!row || scrollPaused.has(row)) return;
    scrollPaused.set(row, false);
    row.addEventListener("mouseenter", function () { scrollPaused.set(row, true); });
    row.addEventListener("mouseleave", function () { scrollPaused.set(row, false); });
    row.addEventListener("touchstart", function () { scrollPaused.set(row, true); }, { passive: true });
    row.addEventListener("touchend", function () {
      setTimeout(function () { scrollPaused.set(row, false); }, 2500);
    }, { passive: true });
  }

  function startGlobalScroll() {
    setInterval(function () {
      sections.forEach(function (section) {
        var row = section.row;
        if (!row || !row.children.length || scrollPaused.get(row)) return;
        var limit = row.scrollWidth - row.clientWidth;
        if (limit <= 0) return;
        if (row.scrollLeft >= limit - 2) row.scrollLeft = 0;
        else row.scrollBy({ left: 110, behavior: "smooth" });
      });
    }, 2400);
  }

  function leToast(message) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  function setupCardObserver() {
    if (cardObserver || typeof IntersectionObserver !== "function") return;
    cardObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var ch = cardChannels.get(entry.target);
        cardObserver.unobserve(entry.target);
        if (!ch || ch.liveStatus !== "checking") return;
        if (ch._sharedWithMain) {
          if (typeof window.enqueueProbe === "function") window.enqueueProbe(ch, true);
        } else {
          enqueueProbe(ch, true);
        }
      });
    }, { rootMargin: "200px" });
  }

  function cardFor(channel) {
    var card = document.createElement("div");
    card.className = "le-card" + (channel.liveStatus === "off" ? " is-off" : "");
    card.dataset.leId = channel.id;
    var initials = channel.name.slice(0, 2).toUpperCase();
    var logoHtml = channel.logo
      ? '<img src="' + esc(channel.logo) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=\'<div class=&quot;chan-logo-fallback&quot;>' + esc(initials) + '</div>\'">'
      : '<div class="chan-logo-fallback">' + esc(initials) + "</div>";
    card.innerHTML =
      '<div class="le-logo"><span class="le-badge status-' + channel.liveStatus + '" title="Stream status: ' +
      channel.liveStatus + '">' + statusLabel(channel.liveStatus) + "</span>" + logoHtml + "</div>" +
      '<div class="le-name">' + esc(channel.name) + "</div>" +
      '<div class="le-group">' + esc(channel.group || "Others") + "</div>";
    card.addEventListener("click", function () {
      if (channel.liveStatus === "off") {
        leToast("এই চ্যানেলটি এখন চালু নেই (OFF)");
        return;
      }
      // "checking" is not a verdict. Let the player do its own fresh proof so a
      // card is never dead just because the background sweep hasn't reached it.
      if (channel.liveStatus === "checking") {
        if (channel._sharedWithMain && typeof window.enqueueProbe === "function") {
          window.enqueueProbe(channel, true);
        } else {
          enqueueProbe(channel, true);
        }
      }
      if (typeof window.openPlayer === "function") window.openPlayer(channel);
      else leToast("Selected: " + channel.name);
    });
    cardChannels.set(card, channel);
    return card;
  }

  function renderSection(section) {
    if (!section || !section.row) return;
    var channels;

    if (section.key === LIVE_KEY) channels = liveChannels();
    else if (section.key === RECENT_TAB) channels = recentAndFavoriteChannels();
    else channels = loaded.get(section.key) || [];

    channels = channels.map(resolveMain).filter(function (ch) {
      return ch && ch.sources && ch.sources.length;
    });
    section.channels = channels;
    if (cardObserver) {
      Array.from(section.row.children).forEach(function (card) { cardObserver.unobserve(card); });
    }
    section.row.innerHTML = "";
    if (section.count) section.count.textContent = channels.length ? String(channels.length) : "";
    if (section.element) section.element.classList.remove("hidden");

    if (!channels.length) {
      section.row.innerHTML = '<div class="empty-state"><p>No channels found.</p></div>';
      return;
    }
    setupCardObserver();
    channels.forEach(function (channel) {
      var card = cardFor(channel);
      section.row.appendChild(card);
      if (cardObserver && channel.liveStatus === "checking") cardObserver.observe(card);
    });
    setupRowScroll(section.row);
  }

  function renderAll() {
    sections.forEach(renderSection);
  }

  function createSection(key, label, afterElement) {
    var element = document.createElement("section");
    element.className = "row live-events-section playlist-row-section";
    element.innerHTML =
      '<div class="live-events-header">' +
        '<h2 class="le-label"><span class="le-dot"></span>' + esc(label) +
        ' <span class="le-count"></span></h2>' +
      "</div>" +
      '<div class="live-events-body"><div class="row-scroll"></div></div>';
    afterElement.parentNode.insertBefore(element, afterElement.nextSibling);

    var section = {
      key: key,
      label: label,
      element: element,
      row: element.querySelector(".row-scroll"),
      count: element.querySelector(".le-count"),
      channels: []
    };
    sections.push(section);
    setupRowScroll(section.row);
    return section;
  }

  function hookSiteFunctions() {
    var baseOpen = window.openPlayer;
    if (typeof baseOpen === "function") {
      window.openPlayer = function (channel) {
        recordRecent(channel);
        return baseOpen.apply(this, arguments);
      };
    }
    var baseAdmin = window.adminPlayChannel;
    if (typeof baseAdmin === "function") {
      window.adminPlayChannel = function (channel) {
        recordRecent(channel);
        return baseAdmin.apply(this, arguments);
      };
    }

    var live = sections.find(function (section) { return section.key === LIVE_KEY; });
    var baseRender = window.renderLiveEventsRow;
    if (typeof baseRender === "function" && live) {
      window.renderLiveEventsRow = function () {
        var result = baseRender.apply(this, arguments);
        if (typeof window.stopLiveEventsAutoScroll === "function") window.stopLiveEventsAutoScroll();
        live.element.classList.remove("hidden");
        renderSection(live);
        return result;
      };
    }
    var baseSync = window.syncLiveEventsVisibility;
    if (typeof baseSync === "function") {
      window.syncLiveEventsVisibility = function () {
        var result = baseSync.apply(this, arguments);
        sections.forEach(function (section) {
          if (section.element) section.element.classList.remove("hidden");
        });
        return result;
      };
    }
  }

  function init() {
    var liveElement = document.getElementById("liveEventsSection");
    var liveRow = document.getElementById("liveEventsRow");
    if (!liveElement || !liveRow) return;

    document.querySelectorAll(".live-event-tab-nav").forEach(function (nav) { nav.remove(); });
    liveElement.classList.remove("hidden");
    sections = [{
      key: LIVE_KEY,
      label: "Live Events",
      element: liveElement,
      row: liveRow,
      count: document.getElementById("leCount"),
      channels: []
    }];

    var anchor = liveElement;
    var definitions = [];
    if (typeof ADMIN_PLAYLISTS !== "undefined" && Array.isArray(ADMIN_PLAYLISTS)) {
      ADMIN_PLAYLISTS.forEach(function (definition) {
        createSection(definition.name, definition.name, anchor);
        anchor = sections[sections.length - 1].element;
        definitions.push(definition);
      });
    }
    createSection(RECENT_TAB, "Last Watched & Favs", anchor);
    setupRowScroll(liveRow);
    startGlobalScroll();
    setupCardObserver();
    hookSiteFunctions();
    renderAll();

    Promise.allSettled(LIVE_DEFS.concat(definitions).map(loadPlaylist)).then(function () {
      syncMainStatuses();
      renderAll();
    });
    setInterval(syncMainStatuses, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
