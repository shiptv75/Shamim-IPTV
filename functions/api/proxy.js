// ===================================================
// Cloudflare Pages Function
// এই ফাইলটি রাখুন: functions/api/proxy.js
// অ্যাক্সেস হবে: https://shamimiptv.pages.dev/api/proxy
// ===================================================

// সিক্রেট আইডি (প্রয়োজনে পরিবর্তন করুন)
const EXPIRE_CODE = "554075";

// ---------------------------------------------------------
// একাধিক প্লেলিস্ট এখানে যোগ করুন — key হবে ?playlist= এ ব্যবহৃত নাম
// লিংক হবে: /api/proxy?playlist=<key>&code=554075
// ---------------------------------------------------------
const PLAYLISTS = {
  shiptv: "https://raw.githubusercontent.com/shiptv75/SHIPTV/main/playlist.m3u",
  fastiptv: "https://raw.githubusercontent.com/ahan443/FAST-IPTV/refs/heads/main/z.m3u",
  tapmad: "https://raw.githubusercontent.com/srhady/tapmad-bd/refs/heads/main/tapmad_bd.m3u",
  fancode: "https://raw.githubusercontent.com/sportlive18/Fancode-New-Auto-Update/refs/heads/main/fancode.m3u",
  xniptv: "https://raw.githubusercontent.com/tvbd/m3uplayer/refs/heads/main/m3u/xniptv.m3u",
  nafitv: "https://raw.githubusercontent.com/nfiptv24-max/NAFITV/refs/heads/main/Nafitv24.m3u"
};

// playlist প্যারামিটার না দিলে কোনটা দেখাবে (ডিফল্ট)
const DEFAULT_PLAYLIST_KEY = "shiptv";

// ---------------------------------------------------------
// নিরাপত্তা: ?url= দিয়ে শুধু এই হোস্টগুলোই ফেচ করা যাবে (সাবডোমেইনসহ)।
// খোলা প্রক্সি হলে যে কেউ আপনার ডোমেইন দিয়ে যেকোনো ট্রাফিক চালাতে পারবে,
// তাই নতুন কোনো সোর্স প্রক্সি করতে চাইলে তার ডোমেইন এখানে যোগ করুন।
// ---------------------------------------------------------
const ALLOWED_HOST_SUFFIXES = [
  "fancode.com",          // FanCode / FanCode-BD স্ট্রিম CDN
  "githubusercontent.com" // raw / gist / objects.githubusercontent.com
];

// আপস্ট্রিম খুব ধীর হলে রিকোয়েস্ট আটকে না থাকার জন্য
const UPSTREAM_TIMEOUT_MS = 20000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function isAllowedTarget(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith('.' + suffix));
  } catch (e) {
    return false;
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest(context) {
  const { request } = context;

  // OPTIONS (CORS preflight)
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const host = url.host;
  const protocol = url.protocol.replace(':', '');
  const targetUrlParam = url.searchParams.get('url');
  const playlistParam = url.searchParams.get('playlist');
  const codeParam = url.searchParams.get('code');

  // ---------------------------------------------------------
  // ১. M3U প্লেলিস্ট রিকোয়েস্ট
  //    ফরম্যাট: /api/proxy?playlist=shiptv&code=554075
  // ---------------------------------------------------------
  if (!targetUrlParam && playlistParam) {

    // সিকিউরিটি কোড যাচাইকরণ
    if (EXPIRE_CODE && codeParam !== EXPIRE_CODE) {
      return jsonResponse({ error: 'Access Denied: Invalid or Expired ID' }, 403);
    }

    const playlistKey = playlistParam.toLowerCase();
    const selectedPlaylistUrl = PLAYLISTS[playlistKey] || PLAYLISTS[DEFAULT_PLAYLIST_KEY];

    if (!selectedPlaylistUrl) {
      return jsonResponse({ error: `Unknown playlist: "${playlistKey}"` }, 404);
    }

    try {
      const response = await fetchWithTimeout(selectedPlaylistUrl, {
        headers: { 'User-Agent': USER_AGENT }
      });

      if (!response.ok) {
        return jsonResponse({ error: 'Failed to fetch playlist' }, response.status);
      }

      const content = await response.text();
      const baseUrl = response.url;

      const lines = content.split('\n');
      const rewrittenLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          try {
            const absUrl = new URL(trimmed, baseUrl).href;
            return `${protocol}://${host}/api/proxy?url=${encodeURIComponent(absUrl)}`;
          } catch (e) {
            return line;
          }
        }
        return line;
      });

      return new Response(rewrittenLines.join('\n'), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8'
        }
      });

    } catch (error) {
      return errorResponse(error);
    }
  }

  // ---------------------------------------------------------
  // ২. নির্দিষ্ট চ্যানেল ও ভিডিও স্ট্রিম ফেচিং
  // ---------------------------------------------------------
  const targetUrl = targetUrlParam;
  if (!targetUrl) {
    return jsonResponse({ error: 'No URL provided' }, 400);
  }

  // শুধু অনুমোদিত হোস্ট
  if (!isAllowedTarget(targetUrl)) {
    return jsonResponse({ error: 'Blocked: this host is not allowed by the proxy' }, 403);
  }

  try {
    const target = new URL(targetUrl);
    const targetOrigin = target.origin;

    // Range শুধু মিডিয়া ফাইলের জন্য পাঠানো হয়। প্লেলিস্টে Range পাঠালে
    // আংশিক টেক্সট আসে আর URL রিরাইটিং ভেঙে যায়।
    const isPlaylistUrl = /\.m3u8?(\?|$)/i.test(targetUrl);

    const upstreamHeaders = {
      'User-Agent': USER_AGENT,
      'Referer': targetOrigin + '/',
      'Origin': targetOrigin
    };

    const rangeHeader = request.headers.get('Range');
    if (rangeHeader && !isPlaylistUrl) upstreamHeaders['Range'] = rangeHeader;

    const response = await fetchWithTimeout(targetUrl, { headers: upstreamHeaders });

    if (!response.ok) {
      return jsonResponse({ error: `Stream failed (${response.status})` }, response.status);
    }

    const contentType = response.headers.get('content-type') || '';
    const finalUrl = response.url || targetUrl;

    const isPlaylist = isPlaylistUrl ||
                       contentType.includes('mpegurl') ||
                       contentType.includes('application/vnd.apple');

    if (isPlaylist) {
      // 206 (partial) হলে টেক্সট রিরাইট করা নিরাপদ নয় — যেমন আছে পাঠিয়ে দিই।
      if (response.status === 206) {
        return new Response(response.body, {
          status: 206,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': contentType || 'application/vnd.apple.mpegurl; charset=utf-8'
          }
        });
      }

      const text = await response.text();

      if (text.trim().startsWith('#EXTM3U') || isPlaylistUrl) {
        const lines = text.split('\n');
        const rewrittenLines = lines.map(line => {
          const trimmed = line.trim();
          if (!trimmed) return line;

          if (trimmed.startsWith('#')) {
            if (trimmed.includes('URI=')) {
              return trimmed.replace(/URI=["']([^"']+)["']/g, (match, uri) => {
                try {
                  const abs = new URL(uri, finalUrl).href;
                  return `URI="${protocol}://${host}/api/proxy?url=${encodeURIComponent(abs)}"`;
                } catch (e) {
                  return match;
                }
              });
            }
            return line;
          }

          try {
            const abs = new URL(trimmed, finalUrl).href;
            return `${protocol}://${host}/api/proxy?url=${encodeURIComponent(abs)}`;
          } catch (e) {
            return line;
          }
        });

        return new Response(rewrittenLines.join('\n'), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8'
          }
        });
      }

      return new Response(text, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': contentType || 'text/plain'
        }
      });
    }

    // ---------------------------------------------------------
    // বাইনারি (HLS সেগমেন্ট / সরাসরি স্ট্রিম)
    // এখানে arrayBuffer() করলে অসীম লাইভ স্ট্রিম কখনো শেষ হয় না —
    // তাই বডি সরাসরিই স্ট্রিম করে পাঠানো হয় (কম মেমরি, কম লেটেন্সি)।
    // 206 / Content-Range-ও পাস-থ্রু করা হয় যাতে VOD-এ seek কাজ করে।
    // ---------------------------------------------------------
    const outHeaders = {
      ...CORS_HEADERS,
      'Content-Type': contentType || 'video/mp2t',
      'Cache-Control': 'public, max-age=3600'
    };

    const acceptRanges = response.headers.get('accept-ranges');
    if (acceptRanges) outHeaders['Accept-Ranges'] = acceptRanges;

    const contentRange = response.headers.get('content-range');
    if (contentRange) outHeaders['Content-Range'] = contentRange;

    const contentLength = response.headers.get('content-length');
    if (contentLength) outHeaders['Content-Length'] = contentLength;

    return new Response(response.body, {
      status: response.status === 206 ? 206 : 200,
      headers: outHeaders
    });

  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error) {
  const message = (error && error.message) || 'Unknown error';
  const aborted = (error && error.name === 'AbortError') || /abort/i.test(message);
  return jsonResponse(
    { error: aborted ? 'Upstream timeout' : message },
    aborted ? 504 : 500
  );
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json'
    }
  });
}
