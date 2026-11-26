// Homepage LIVE EVENTS section with one tab per playlist.
// 7 tabs: Live Events + 5 admin playlists + Last Watched & Favs.
(function () {
  "use strict";

  var RECENT_KEY = "shamim_last_watched_v1";
  var LIVE_KEY = "__live_events__";
  var RECENT_KEY_TAB = "__recent_favs__";
  var RECENT_LIMIT = 40;

  var section, row, countEl, tabNav;
  var activeKey = LIVE_KEY;
  var loaded = new Map();

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
    if (tags && !Array.isArray(tags) && typeof tags.forEach === "function") {
      tags = Array.from(tags);
    }
    return {
      id: source.id || source.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
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
      if (!line || line.indexOf("#EXTINF") === 0) {
        if (line.indexOf("#EXTINF") === 0) {
          var comma = line.lastIndexOf(",");
          var name = (comma === -1 ? "Unknown" : line.slice(comma + 1)).trim() || "Unknown";
          var logo = (line.match(/tvg-logo="([^"]*)"/) || [])[1] || "";
          var group = (line.match(/group-title="([^"]*)"/) || [])[1] || "Others";
          byName.set(name, makeChannel({ name: name, logo: logo, group: group, sources: [], sourceTags: [tag] }));
        }
        return;
      }
      if (line.charAt(0) === "#" || !/^https?:\/\//i.test(line)) return;
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
      channels = typeof window.adminParse === "function"
        ? window.adminParse(text).map(function (ch) { return makeChannel(ch); })
        : manualParse(text, key);
      channels.forEach(function (ch) { ch.sourceTags.add(key); });
    } catch (error) {
      console.warn("Live Events tab failed to load " + key + ": " + error.message);
    }
    loaded.set(key, channels);
    return channels;
  }

  function mainChannels() {
    return typeof CHANNELS !== "undefined" && Array.isArray(CHANNELS) ? CHANNELS : [];
  }

  function liveChannels() {
    return mainChannels().filter(function (ch) {
      return ch.sourceTags && Array.from(ch.sourceTags).some(function (tag) {
        return typeof LIVE_EVENTS_SOURCE_TAGS !== "undefined" && LIVE_EVENTS_SOURCE_TAGS.has(tag);
      }) && ch.liveStatus === "on";
    });
  }

  function recentAndFavoriteChannels() {
    var recents = readJSON(RECENT_KEY, []).map(makeChannel);
    var favKey = typeof LS_FAV !== "undefined" ? LS_FAV : "obiram_favorites";
    var favIds = readJSON(favKey, []);
    var pool = mainChannels();
    var result = recents.slice();

    favIds.forEach(function (id) {
      var found = pool.find(function (ch) { return ch.id === id; });
      if (!found && activeTabChannels) found = activeTabChannels.find(function (ch) { return ch.id === id; });
      if (found && !result.some(function (ch) { return ch.id === found.id; })) {
        result.push(makeChannel(found));
      }
    });
    return result;
  }

  var activeTabChannels = [];

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
    if (activeKey === RECENT_KEY_TAB) render(RECENT_KEY_TAB);
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

  function render(key) {
    if (!row) return;
    activeKey = key;
    var channels;

    if (key === LIVE_KEY) channels = liveChannels();
    else if (key === RECENT_KEY_TAB) channels = recentAndFavoriteChannels();
    else channels = loaded.get(key) || [];

    channels = channels.filter(function (ch) { return ch && ch.sources && ch.sources.length; });
    activeTabChannels = channels;
    row.innerHTML = "";

    if (countEl) countEl.textContent = channels.length ? String(channels.length) : "";
    if (section) section.classList.remove("hidden");

    if (!channels.length) {
      row.innerHTML = '<div class="empty-state"><p>No channels found for this tab.</p></div>';
      return;
    }
    channels.forEach(function (channel) { row.appendChild(cardFor(channel)); });
  }

  function tabDefinition(key) {
    if (key === LIVE_KEY) return { key: key, label: "Live Events" };
    if (key === RECENT_KEY_TAB) return { key: key, label: "Last Watched & Favs" };
    return { key: key, label: key };
  }

  function buildTabs() {
    var keys = [LIVE_KEY];
    if (typeof ADMIN_PLAYLISTS !== "undefined" && Array.isArray(ADMIN_PLAYLISTS)) {
      ADMIN_PLAYLISTS.forEach(function (definition) { keys.push(definition.name); });
    } else {
      ["XNIPTV", "Nafi TV", "Toffee", "SkyTop", "JagoBD"].forEach(function (name) { keys.push(name); });
    }
    keys.push(RECENT_KEY_TAB);

    tabNav = document.createElement("div");
    tabNav.className = "live-event-tab-nav";
    keys.forEach(function (key) {
      var definition = tabDefinition(key);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "live-event-tab-btn" + (key === activeKey ? " active" : "");
      button.dataset.source = key;
      button.textContent = definition.label;
      tabNav.appendChild(button);
    });
    row.parentElement.insertBefore(tabNav, row);

    tabNav.addEventListener("click", function (event) {
      var button = event.target.closest(".live-event-tab-btn");
      if (!button) return;
      tabNav.querySelectorAll(".live-event-tab-btn").forEach(function (item) {
        item.classList.toggle("active", item === button);
      });
      render(button.dataset.source);
    });
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

    var baseRender = window.renderLiveEventsRow;
    if (typeof baseRender === "function") {
      window.renderLiveEventsRow = function () {
        var result = baseRender.apply(this, arguments);
        if (tabNav) {
          if (section) section.classList.remove("hidden");
          if (activeKey === LIVE_KEY) render(LIVE_KEY);
        }
        return result;
      };
    }
    var baseSync = window.syncLiveEventsVisibility;
    if (typeof baseSync === "function") {
      window.syncLiveEventsVisibility = function () {
        var result = baseSync.apply(this, arguments);
        if (tabNav && section) section.classList.remove("hidden");
        return result;
      };
    }
  }

  function init() {
    section = document.getElementById("liveEventsSection");
    row = document.getElementById("liveEventsRow");
    countEl = document.getElementById("leCount");
    if (!section || !row) return;
    if (row.parentElement.querySelector(".live-event-tab-nav")) return;

    section.classList.remove("hidden");
    buildTabs();
    hookSiteFunctions();
    render(activeKey);

    if (typeof ADMIN_PLAYLISTS !== "undefined" && Array.isArray(ADMIN_PLAYLISTS)) {
      Promise.allSettled(ADMIN_PLAYLISTS.map(loadPlaylist)).then(function () {
        if (activeKey !== LIVE_KEY && activeKey !== RECENT_KEY_TAB) render(activeKey);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
