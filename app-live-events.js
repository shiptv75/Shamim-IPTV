// Live Events tabs for the homepage.
// Isolated in an IIFE so its names never collide with app.js globals.
(function () {
  "use strict";

  // One tab per playlist. Edit this list to add/remove tabs.
  const LIVE_TAB_PLAYLISTS = [
    { name: "SHIPTV", url: "https://raw.githubusercontent.com/shiptv75/SHIPTV/refs/heads/main/playlist.m3u" },
    { name: "FanCode", url: "https://raw.githubusercontent.com/sportlive18/Fancode-New-Auto-Update/refs/heads/main/fancode.m3u" },
    { name: "TapMad", url: "https://gist.githubusercontent.com/albatr0ssss/3cff7a26be49b1d352c15f615067e7cd/raw/tapmad_bd.m3u" },
    { name: "SonyLiv", url: "https://srhady-sliv.hf.space/live.m3u" },
  ];

  async function fetchM3U(url) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return await response.text();
    } catch (_) { /* try the proxy below */ }
    const proxy = "https://corsproxy.io/?url=" + encodeURIComponent(url);
    const response = await fetch(proxy, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return await response.text();
  }

  function parseM3U(text, sourceTag) {
    const channels = [];
    let pending = null;
    const lines = text.replace(/\r\n/g, "\n").split("\n");

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#EXTM3U")) continue;

      if (line.startsWith("#EXTINF")) {
        if (pending && pending.sources.length) channels.push(pending);
        const comma = line.lastIndexOf(",");
        const name = (comma === -1 ? "Unknown" : line.slice(comma + 1)).trim() || "Unknown";
        const logo = line.match(/tvg-logo="([^"]*)"/)?.[1] || "";
        const group = line.match(/group-title="([^"]*)"/)?.[1] || "Others";
        pending = { name, logo, group: group || "Others", sources: [], sourceTag };
      } else if (!line.startsWith("#") && /^https?:\/\//i.test(line)) {
        if (!pending) pending = { name: "Unknown", logo: "", group: "Others", sources: [], sourceTag };
        pending.sources.push(line);
      }
    }
    if (pending && pending.sources.length) channels.push(pending);
    return channels;
  }

  function leToast(message) {
    const el = document.getElementById("toast");
    if (!el) { console.log(message); return; }
    el.textContent = message;
    el.classList.remove("hidden");
    clearTimeout(leToast.timer);
    leToast.timer = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  async function initAdminLiveEvents() {
    const section = document.getElementById("liveEventsSection");
    const row = document.getElementById("liveEventsRow");
    const count = document.getElementById("leCount");
    if (!section || !row) return;
    if (row.parentElement.querySelector(".live-event-tab-nav")) return;

    const bySource = new Map();
    const seen = new Map();

    for (const playlist of LIVE_TAB_PLAYLISTS) {
      try {
        const channels = parseM3U(await fetchM3U(playlist.url), playlist.name);
        if (!channels.length) continue;
        bySource.set(playlist.name, channels);

        channels.forEach((ch) => {
          const key = ch.name.toLowerCase();
          let entry = seen.get(key);
          if (!entry) {
            entry = {
              id: "le-" + Math.random().toString(36).slice(2),
              name: ch.name,
              logo: ch.logo,
              group: ch.group,
              sources: [],
              sourceTags: new Set(),
            };
            seen.set(key, entry);
          }
          ch.sources.forEach((url) => { if (!entry.sources.includes(url)) entry.sources.push(url); });
          entry.sourceTags.add(ch.sourceTag);
        });
      } catch (error) {
        console.warn("Live Events: cannot load " + playlist.name + " — " + error.message);
      }
    }

    const sources = [...bySource.keys()];
    const tabNav = document.createElement("div");
    tabNav.className = "live-event-tab-nav";
    const makeButton = (label, value, active) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "live-event-tab-btn" + (active ? " active" : "");
      button.dataset.source = value;
      button.textContent = label;
      return button;
    };
    tabNav.appendChild(makeButton(sources.length ? "All Live" : "All", "all", true));
    sources.forEach((name) => tabNav.appendChild(makeButton(name, name, false)));
    row.parentElement.insertBefore(tabNav, row);

    if (count) count.textContent = seen.size;

    let currentFilter = "all";

    function render(filter) {
      currentFilter = filter;
      row.innerHTML = "";
      const channels = [...seen.values()].filter((ch) =>
        filter === "all" ? true : ch.sourceTags.has(filter)
      );
      if (count) count.textContent = channels.length ? String(channels.length) : "";
      if (!channels.length) {
        row.innerHTML = '<div class="empty-state"><p>No live events found for this playlist.</p></div>';
        return;
      }
      channels.forEach((ch) => {
        const card = document.createElement("div");
        card.className = "mini-chan-card";
        card.innerHTML =
          '<div class="rc-icon-box">' +
          (ch.logo
            ? '<img src="' + ch.logo + '" alt="" referrerpolicy="no-referrer">'
            : '<div class="chan-logo-fallback">' + ch.name.charAt(0) + "</div>") +
          "</div>" +
          '<div class="rc-name">' + ch.name + "</div>" +
          '<div class="rc-grp">' + ch.group + "</div>";
        card.addEventListener("click", () => {
          if (typeof window.playChannel === "function") window.playChannel(ch);
          else leToast("Selected: " + ch.name);
        });
        row.appendChild(card);
      });
    }

    render(currentFilter);

    // app.js also renders this row and clears it on status changes. Re-apply
    // our tab view straight after its render so both features stay visible.
    const baseRender = window.renderLiveEventsRow;
    if (typeof baseRender === "function") {
      window.renderLiveEventsRow = function () {
        const result = baseRender.apply(this, arguments);
        if (seen.size) {
          section.classList.remove("hidden");
          render(currentFilter);
        }
        return result;
      };
    }
    const baseSync = window.syncLiveEventsVisibility;
    if (typeof baseSync === "function") {
      window.syncLiveEventsVisibility = function () {
        const result = baseSync.apply(this, arguments);
        if (seen.size) section.classList.remove("hidden");
        return result;
      };
    }

    tabNav.addEventListener("click", (event) => {
      const button = event.target.closest(".live-event-tab-btn");
      if (!button) return;
      tabNav.querySelectorAll(".live-event-tab-btn").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      render(button.dataset.source);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAdminLiveEvents);
  } else {
    initAdminLiveEvents();
  }
})();
