// index.js
// Snakeeyes Trakt Addon — Cloudflare Workers format
// Shows Trakt history, watchlist, ratings and collection as Stremio catalogs

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json"
};

const HTML_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "text/html;charset=UTF-8"
};

// ── Manifest builder (per-user URL includes their token key) ──────────────────
function buildManifest(userKey) {
  const base = userKey ? `/${userKey}` : "";
  return {
    id: "community.snakeeyes.trakt",
    version: "1.0.0",
    name: "Snakeeyes Trakt",
    description: "Your Trakt history, watchlist, ratings and collection in Stremio.",
    logo: "https://walter.trakt.tv/hotlink-ok/public/favicon.ico",
    resources: ["catalog", "meta"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [
      { type: "movie",  id: `${base}/trakt-history-movies`,    name: "Trakt History (Movies)" },
      { type: "series", id: `${base}/trakt-history-series`,    name: "Trakt History (Series)" },
      { type: "movie",  id: `${base}/trakt-watchlist-movies`,  name: "Trakt Watchlist (Movies)" },
      { type: "series", id: `${base}/trakt-watchlist-series`,  name: "Trakt Watchlist (Series)" },
      { type: "movie",  id: `${base}/trakt-ratings-movies`,    name: "Trakt Ratings (Movies)" },
      { type: "series", id: `${base}/trakt-ratings-series`,    name: "Trakt Ratings (Series)" },
      { type: "movie",  id: `${base}/trakt-collection-movies`, name: "Trakt Collection (Movies)" },
      { type: "series", id: `${base}/trakt-collection-series`, name: "Trakt Collection (Series)" },
    ]
  };
}

// ── Trakt API helpers ─────────────────────────────────────────────────────────
async function traktGet(path, accessToken, clientId) {
  const res = await fetch(`https://api.trakt.tv${path}`, {
    headers: {
      "Content-Type": "application/json",
      "trakt-api-version": "2",
      "trakt-api-key": clientId,
      "Authorization": `Bearer ${accessToken}`
    }
  });
  if (!res.ok) throw new Error(`Trakt API error: ${res.status}`);
  return res.json();
}

// Convert Trakt item to Stremio meta object
function traktItemToMeta(item, type) {
  const obj = type === "movie" ? item.movie : item.show;
  if (!obj) return null;
  const imdbId = obj.ids?.imdb;
  if (!imdbId) return null;
  return {
    id: imdbId,
    type: type,
    name: obj.title,
    releaseInfo: obj.year ? String(obj.year) : undefined
  };
}

// ── Device Auth flow helpers ──────────────────────────────────────────────────
async function startDeviceAuth(clientId) {
  const res = await fetch("https://api.trakt.tv/oauth/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId })
  });
  return res.json();
}

async function pollDeviceAuth(clientId, clientSecret, deviceCode) {
  const res = await fetch("https://api.trakt.tv/oauth/device/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: device_code,
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  if (res.status === 200) return res.json();
  return null;
}

// ── Configure page HTML ───────────────────────────────────────────────────────
function configPage(workerUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Snakeeyes Trakt Addon</title>
  <style>
    body { font-family: Arial, sans-serif; background: #1a1a1a; color: white; text-align: center; padding: 40px 20px; max-width: 600px; margin: 0 auto; }
    h1 { color: #ed1c24; }
    .btn { background: #ed1c24; color: white; padding: 14px 28px; border: none; border-radius: 6px; font-size: 1.1em; cursor: pointer; text-decoration: none; display: inline-block; margin: 10px; }
    .btn:hover { background: #c0151b; }
    .btn-install { background: #7b5cff; }
    .btn-install:hover { background: #6245e0; }
    .box { background: #2a2a2a; border-radius: 10px; padding: 20px; margin: 20px 0; }
    .code { font-size: 2em; font-weight: bold; color: #ed1c24; letter-spacing: 4px; }
    .url-box { background: #111; padding: 12px; border-radius: 6px; word-break: break-all; font-family: monospace; font-size: 0.9em; margin: 10px 0; }
    #step1, #step2, #step3 { display: none; }
    #step1 { display: block; }
    .spinner { display: inline-block; width: 20px; height: 20px; border: 3px solid #444; border-top-color: #ed1c24; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <h1>🐍 Snakeeyes Trakt Addon</h1>
  <p>Connect your Trakt account to see your history, watchlist, ratings and collection in Stremio.</p>

  <!-- Step 1: Start -->
  <div id="step1" class="box">
    <h2>Step 1 — Connect Trakt</h2>
    <p>Click below to get your Trakt authorization code.</p>
    <button class="btn" onclick="startAuth()">Connect Trakt Account</button>
  </div>

  <!-- Step 2: Enter code -->
  <div id="step2" class="box">
    <h2>Step 2 — Authorize</h2>
    <p>Go to <strong>trakt.tv/activate</strong> and enter this code:</p>
    <div class="code" id="userCode">------</div>
    <p><span class="spinner"></span> Waiting for you to authorize on Trakt...</p>
    <p id="pollStatus"></p>
  </div>

  <!-- Step 3: Install -->
  <div id="step3" class="box">
    <h2>Step 3 — Install in Stremio</h2>
    <p>Your Trakt account is connected! Click below to install your personal addon in Stremio.</p>
    <div class="url-box" id="manifestUrl"></div>
    <a class="btn btn-install" id="installBtn" href="#">Install in Stremio</a>
    <p style="margin-top:20px;font-size:0.85em;color:#888;">Or paste the URL above manually into Stremio's addon search field.</p>
  </div>

  <script>
    let pollInterval = null;

    async function startAuth() {
      document.getElementById('step1').style.display = 'none';
      document.getElementById('step2').style.display = 'block';

      const res = await fetch('/auth/start');
      const data = await res.json();

      document.getElementById('userCode').textContent = data.user_code;

      // Poll for token
      pollInterval = setInterval(async () => {
        const poll = await fetch('/auth/poll?device_code=' + encodeURIComponent(data.device_code));
        const result = await poll.json();

        if (result.ready && result.key) {
          clearInterval(pollInterval);
          showInstall(result.key);
        } else if (result.error) {
          clearInterval(pollInterval);
          document.getElementById('pollStatus').textContent = 'Error: ' + result.error + '. Please refresh and try again.';
        }
      }, 5000);
    }

    function showInstall(userKey) {
      document.getElementById('step2').style.display = 'none';
      document.getElementById('step3').style.display = 'block';

      const manifestUrl = '${workerUrl}/' + userKey + '/manifest.json';
      document.getElementById('manifestUrl').textContent = manifestUrl;
      document.getElementById('installBtn').href = 'stremio://' + manifestUrl.replace('https://', '');
    }
  </script>
</body>
</html>`;
}

// ── Main fetch handler ────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const workerUrl = `${url.protocol}//${url.host}`;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "*" } });
    }

    // ── Landing / config page ──────────────────────────────────────────────
    if (path === "/" || path === "/index.html") {
      return new Response(configPage(workerUrl), { headers: HTML_HEADERS });
    }

    // ── Auth: start device flow ────────────────────────────────────────────
    if (path === "/auth/start") {
      try {
        const clientId = env.TRAKT_CLIENT_ID;
        if (!clientId) {
          return new Response(JSON.stringify({ error: "TRAKT_CLIENT_ID not set" }), { status: 500, headers: CORS_HEADERS });
        }

        const res = await fetch("https://api.trakt.tv/oauth/device/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId.trim() })
        });

        const text = await res.text();
        if (!res.ok) {
          console.error(`Trakt device/code error ${res.status}: ${text}`);
          return new Response(JSON.stringify({ error: `Trakt returned ${res.status}: ${text}` }), { status: 500, headers: CORS_HEADERS });
        }

        const data = JSON.parse(text);
        return new Response(JSON.stringify({
          device_code: data.device_code,
          user_code: data.user_code,
          verification_url: data.verification_url,
          expires_in: data.expires_in,
          interval: data.interval
        }), { headers: CORS_HEADERS });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS_HEADERS });
      }
    }

    // ── Auth: poll for token ───────────────────────────────────────────────
    if (path === "/auth/poll") {
      const deviceCode = url.searchParams.get("device_code");
      if (!deviceCode) return new Response(JSON.stringify({ error: "missing device_code" }), { status: 400, headers: CORS_HEADERS });

      try {
        const res = await fetch("https://api.trakt.tv/oauth/device/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: deviceCode,
            client_id: env.TRAKT_CLIENT_ID,
            client_secret: env.TRAKT_CLIENT_SECRET
          })
        });

        if (res.status === 200) {
          const tokens = await res.json();
          // Generate a unique key for this user
          const userKey = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
          // Store token in KV
          await env.TRAKT_TOKENS.put(userKey, JSON.stringify({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + (tokens.expires_in * 1000)
          }), { expirationTtl: 60 * 60 * 24 * 90 }); // 90 days

          return new Response(JSON.stringify({ ready: true, key: userKey }), { headers: CORS_HEADERS });
        } else if (res.status === 400) {
          // Still waiting (pending authorization)
          return new Response(JSON.stringify({ ready: false }), { headers: CORS_HEADERS });
        } else {
          return new Response(JSON.stringify({ ready: false, error: `status ${res.status}` }), { headers: CORS_HEADERS });
        }
      } catch (e) {
        return new Response(JSON.stringify({ ready: false, error: e.message }), { headers: CORS_HEADERS });
      }
    }

    // ── User-specific routes: /:userKey/manifest.json and /:userKey/catalog/... ──
    const userMatch = path.match(/^\/([a-f0-9]{16})(\/.*)?$/);
    if (userMatch) {
      const userKey = userMatch[1];
      const subPath = userMatch[2] || "/manifest.json";

      // Load user token from KV
      const tokenData = await env.TRAKT_TOKENS.get(userKey, { type: "json" });
      if (!tokenData) {
        return new Response(JSON.stringify({ error: "User not found. Please reconnect your Trakt account." }), { status: 404, headers: CORS_HEADERS });
      }

      const accessToken = tokenData.access_token;

      // Manifest
      if (subPath === "/manifest.json") {
        return new Response(JSON.stringify(buildManifest(userKey)), { headers: CORS_HEADERS });
      }

      // Catalog: /:userKey/catalog/:type/:catalogId.json
      const catalogMatch = subPath.match(/^\/catalog\/(movie|series)\/[a-f0-9]{16}\/trakt-(history|watchlist|ratings|collection)-(movies|series)\.json$/);
      if (catalogMatch) {
        const type = catalogMatch[1];
        const listType = catalogMatch[2]; // history | watchlist | ratings | collection

        try {
          let items = [];
          const typeParam = type === "movie" ? "movies" : "shows";

          if (listType === "history") {
            items = await traktGet(`/users/me/history/${typeParam}?limit=50`, accessToken, env.TRAKT_CLIENT_ID);
          } else if (listType === "watchlist") {
            items = await traktGet(`/users/me/watchlist/${typeParam}`, accessToken, env.TRAKT_CLIENT_ID);
          } else if (listType === "ratings") {
            items = await traktGet(`/users/me/ratings/${typeParam}`, accessToken, env.TRAKT_CLIENT_ID);
          } else if (listType === "collection") {
            items = await traktGet(`/users/me/collection/${typeParam}`, accessToken, env.TRAKT_CLIENT_ID);
          }

          const metas = items
            .map(item => traktItemToMeta(item, type))
            .filter(Boolean)
            // Deduplicate by IMDb ID (history can repeat)
            .filter((item, index, self) => index === self.findIndex(t => t.id === item.id));

          return new Response(JSON.stringify({ metas }), { headers: CORS_HEADERS });
        } catch (e) {
          console.error("Catalog error:", e.message);
          return new Response(JSON.stringify({ metas: [] }), { headers: CORS_HEADERS });
        }
      }
    }

    // ── Fallback ───────────────────────────────────────────────────────────
    return new Response("Snakeeyes Trakt Addon", { headers: { "Access-Control-Allow-Origin": "*" } });
  }
};
