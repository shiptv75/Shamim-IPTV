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
// ===================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

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
      const response = await fetch(selectedPlaylistUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
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
      return jsonResponse({ error: error.message }, 500);
    }
  }

  // ---------------------------------------------------------
  // ২. নির্দিষ্ট চ্যানেল ও ভিডিও স্ট্রিম ফেচিং
  // ---------------------------------------------------------
  const targetUrl = targetUrlParam;
  if (!targetUrl) {
    return jsonResponse({ error: 'No URL provided' }, 400);
  }

  try {
    const targetOrigin = new URL(targetUrl).origin;

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Referer': targetOrigin + '/',
        'Origin': targetOrigin
      }
    });

    if (!response.ok) {
      return jsonResponse({ error: `Stream failed (${response.status})` }, response.status);
    }

    const contentType = response.headers.get('content-type') || '';
    const finalUrl = response.url;

    const isPlaylist = targetUrl.includes('.m3u') ||
                       contentType.includes('mpegurl') ||
                       contentType.includes('m3u') ||
                       contentType.includes('text/plain');

    if (isPlaylist) {
      const text = await response.text();

      if (text.trim().startsWith('#EXTM3U') || targetUrl.includes('.m3u8')) {
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

    const arrayBuffer = await response.arrayBuffer();
    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType || 'video/mp2t',
        'Cache-Control': 'public, max-age=3600'
      }
    });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
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
