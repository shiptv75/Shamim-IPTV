// Homepage playlist rows: one separate section per playlist, each scrolling
// right-to-left. Sections: Live Events + 5 admin playlists + Recents & Favs.
(function () {
  "use strict";

  var RECENT_KEY = "shamim_last_watched_v1";
  var RECENT_LIMIT = 40;
  var LIVE_KEY = "__live_events__";
  var RECENT_TAB = "__recent_favs__";

  var LIVE_DEFS = [
    { name: "TapMad", url: typeof M3U_URL_TAPMAD !== "undefined" ? M3U_URL_TAPMAD : "https://gist.githubusercontent.com/albatr0ssss/3cff7a26be49b1d352c15f615067e7cd/raw/tapmad_bd.m3u", type: "m3u" },
    { name: "FanCode", url: typeof M3U_URL_FANCODE !== "undefined" ? M3U_URL_FANCODE : "https://raw.githubusercontent.com/sportlive18/Fancode-New-Auto-Update/refs/heads/main/fancode.m3u", type: "m3u" },
    { name: "FanCode BD", url: typeof M3U_URL_FANCODE_BD !== "undefined" ? M3U_URL_FANCODE_BD : "https://raw.githubusercontent.com/srhady/Fancode-bd/refs/heads/main/main_playlist.json", type: "json" },
    { name: "SonyLiv", url: typeof M3U_URL_SONYLIV !== "undefined" ? M3U_URL_SONYLIV : "https://srhady-sliv.hf.space/live.m3u", type: "m3u" },
  ];

  var loaded = new Map();
  var sections = [];
  var scrollPaused = new WeakMap();

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

  function makeChannel(source) {
    var tags = source.sourceTags;
    if (tags && !Array.isArray(tags) && typeof tags.forEach === "function") tags = Array.from(tags);
    return {
      id: source.id || String(source.name || "channel").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: source.name || "Unknown",
      logo: source.logo || "",
      group: source.group || "Others",
      sources: (source.sources || []).slice(),
      sourceTags: new Set(tags || []),
      liveStatus: "on"
    };
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
      channels.forEach(function (ch) { ch.sourceTags.add(key); });
    } catch (error) {
      console.warn("Could not load " + key + ": " + error.message);
    }
    loaded.set(key, channels);
    return channels;
  }

  function mainChannels() {
    return typeof CHANNELS !== "undefined" && Array.isArray(CHANNELS) ? CHANNELS : [];
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
    var result = readJSON(RECENT_KEY, []).map(makeChannel);
    var favKey = typeof LS_FAV !== "undefined" ? LS_FAV : "obiram_favorites";
    var pool = mainChannels().slice();
    sections.forEach(function (section) {
      if (section.key === RECENT_TAB) return;
      (section.channels || []).forEach(function (ch) { pool.push(ch); });
    });

    readJSON(favKey, []).forEach(function (id) {
      var found = pool.find(function (ch) { return ch.id === id; });
      if (found && !result.some(function (ch) { return ch.id === found.id; })) result.push(makeChannel(found));
    });
    return result;
  }

  function recordRecent(channel) {
    if (!channel || !channel.name) return;
    var snapshot = makeChannel(channel);
    var list = readJSON(RECENT_KEY, []).filter(function (item) { return item.id !== snapshot.id; });
    list.unshift({
      id: snapshot.id,
      name: snapshot.name,
      logo: snapshot.logo,
      group: snapshot.group,
      sources: snapshot.sources,
      sourceTags: Array.from(snapshot.sourceTags),
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

  function cardFor(channel) {
    var card = document.createElement("div");
    card.className = "le-card";
    var initials = channel.name.slice(0, 2).toUpperCase();
    var logoHtml = channel.logo
      ? '<img src="' + esc(channel.logo) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=\'<div class=&quot;chan-logo-fallback&quot;>' + esc(initials) + '</div>\'">'
      : '<div class="chan-logo-fallback">' + esc(initials) + "</div>";
    card.innerHTML =
      '<div class="le-logo"><span class="le-badge">▶</span>' + logoHtml + "</div>" +
      '<div class="le-name">' + esc(channel.name) + "</div>" +
      '<div class="le-group">' + esc(channel.group || "Others") + "</div>";
    card.addEventListener("click", function () {
      if (typeof window.openPlayer === "function") window.openPlayer(channel);
    });
    return card;
  }

  function renderSection(section) {
    if (!section || !section.row) return;
    var channels;

    if (section.key === LIVE_KEY) channels = liveChannels();
    else if (section.key === RECENT_TAB) channels = recentAndFavoriteChannels();
    else channels = loaded.get(section.key) || [];

    channels = channels.filter(function (ch) { return ch && ch.sources && ch.sources.length; });
    section.channels = channels;
    section.row.innerHTML = "";
    if (section.count) section.count.textContent = channels.length ? String(channels.length) : "";
    if (section.element) section.element.classList.remove("hidden");

    if (!channels.length) {
      section.row.innerHTML = '<div class="empty-state"><p>No channels found.</p></div>';
      return;
    }
    channels.forEach(function (channel) { section.row.appendChild(cardFor(channel)); });
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
    hookSiteFunctions();
    renderAll();

    Promise.allSettled(LIVE_DEFS.concat(definitions).map(loadPlaylist)).then(renderAll);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
