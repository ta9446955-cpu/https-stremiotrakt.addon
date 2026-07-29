// index.js
// Snakeeyes Trakt Addon — Node.js/Express format for Render.com

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const TRAKT_CLIENT_ID = process.env.TRAKT_CLIENT_ID;
const TRAKT_CLIENT_SECRET = process.env.TRAKT_CLIENT_SECRET;
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// In-memory token store (persists while server is running)
// For production, replace with a database
const tokenStore = {};

// ── Manifest builder ──────────────────────────────────────────────────────────
function buildManifest(userKey) {
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
      { type: "movie",  id: "trakt-history-movies",    name: "Trakt History (Movies)" },
      { type: "series", id: "trakt-history-series",    name: "Trakt History (Series)" },
      { type: "movie",  id: "trakt-watchlist-movies",  name: "Trakt Watchlist (Movies)" },
      { type: "series", id: "trakt-watchlist-series",  name: "Trakt Watchlist (Series)" },
      { type: "movie",  id: "trakt-ratings-movies",    name: "Trakt Ratings (Movies)" },
      { type: "series", id: "trakt-ratings-series",    name: "Trakt Ratings (Series)" },
      { type: "movie",  id: "trakt-collection-movies", name: "Trakt Collection (Movies)" },
      { type: "series", id: "trakt-collection-series", name: "Trakt Collection (Series)" }
    ]
  };
}

// ── TMDB poster fetch helper ──────────────────────────────────────────────────
async function fetchTMDBPoster(imdbId, type) {
  if (!TMDB_API_KEY) {
    console.error('TMDB_API_KEY is not set');
    return { poster: null, background: null };
  }
  try {
    const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`TMDB error for ${imdbId}: ${res.status}`);
      return { poster: null, background: null };
    }
    const data = await res.json();
    const results = type === 'movie' ? data.movie_results : data.tv_results;
    if (!results || results.length === 0) {
      console.log(`TMDB no results for ${imdbId} (${type})`);
      return { poster: null, background: null };
    }
    const item = results[0];
    return {
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
      background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null
    };
  } catch (e) {
    console.error(`TMDB fetch error for ${imdbId}:`, e.message);
    return { poster: null, background: null };
  }
}

// ── Trakt API helper ──────────────────────────────────────────────────────────
async function traktGet(path, accessToken) {
  const res = await fetch(`https://api.trakt.tv${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'trakt-api-version': '2',
      'trakt-api-key': TRAKT_CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`,
      'User-Agent': 'SnakeyesTraktAddon/1.0'
    }
  });
  if (!res.ok) throw new Error(`Trakt API error: ${res.status}`);
  return res.json();
}

// ── Convert Trakt item to Stremio meta ────────────────────────────────────────
function traktItemToMeta(item, type) {
  const obj = type === 'movie' ? item.movie : item.show;
  if (!obj) return null;
  const imdbId = obj.ids && obj.ids.imdb;
  if (!imdbId) return null;
  return {
    id: imdbId,
    type: type,
    name: obj.title,
    releaseInfo: obj.year ? String(obj.year) : undefined
  };
}

// ── Landing page ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const workerUrl = `${req.protocol}://${req.get('host')}`;
  res.send(`<!DOCTYPE html>
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
    .code { font-size: 2em; font-weight: bold; color: #ed1c24; letter-spacing: 4px; margin: 15px 0; }
    .url-box { background: #111; padding: 12px; border-radius: 6px; word-break: break-all; font-family: monospace; font-size: 0.9em; margin: 10px 0; }
    #step1 { display: block; }
    #step2, #step3 { display: none; }
    .spinner { display: inline-block; width: 20px; height: 20px; border: 3px solid #444; border-top-color: #ed1c24; border-radius: 50%; animation: spin 0.8s linear infinite; vertical-align: middle; margin-right: 8px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <h1>🐍 Snakeeyes Trakt Addon</h1>
  <p>Connect your Trakt account to see your history, watchlist, ratings and collection in Stremio.</p>

  <div id="step1" class="box">
    <h2>Step 1 — Connect Trakt</h2>
    <p>Click below to get your Trakt authorization code.</p>
    <button class="btn" onclick="startAuth()">Connect Trakt Account</button>
  </div>

  <div id="step2" class="box">
    <h2>Step 2 — Authorize</h2>
    <p>Go to <strong><a href="https://trakt.tv/activate" target="_blank" style="color:#ed1c24">trakt.tv/activate</a></strong> and enter this code:</p>
    <div class="code" id="userCode">------</div>
    <p><span class="spinner"></span> Waiting for you to authorize on Trakt...</p>
    <p id="pollStatus" style="color:#ff6b6b;"></p>
  </div>

  <div id="step3" class="box">
    <h2>Step 3 — Install in Stremio</h2>
    <p>Your Trakt account is connected! Use the URL below to install in Stremio.</p>
    <div class="url-box" id="manifestUrl"></div>
    <a class="btn btn-install" id="installBtn" href="#">Install in Stremio</a>
    <p style="margin-top:20px;font-size:0.85em;color:#888;">Or paste the URL above manually into Stremio's addon search field using https://</p>
  </div>

  <script>
    const BASE_URL = '${workerUrl}';
    let pollInterval = null;

    async function startAuth() {
      document.getElementById('step1').style.display = 'none';
      document.getElementById('step2').style.display = 'block';

      try {
        const res = await fetch(BASE_URL + '/auth/start');
        const data = await res.json();

        if (data.error) {
          document.getElementById('pollStatus').textContent = 'Error: ' + data.error;
          return;
        }

        document.getElementById('userCode').textContent = data.user_code;

        pollInterval = setInterval(async () => {
          try {
            const poll = await fetch(BASE_URL + '/auth/poll?device_code=' + encodeURIComponent(data.device_code));
            const result = await poll.json();

            if (result.ready && result.key) {
              clearInterval(pollInterval);
              showInstall(result.key);
            } else if (result.error) {
              clearInterval(pollInterval);
              document.getElementById('pollStatus').textContent = 'Error: ' + result.error + '. Please refresh and try again.';
            }
          } catch (e) {
            clearInterval(pollInterval);
            document.getElementById('pollStatus').textContent = 'Network error. Please refresh and try again.';
          }
        }, 5000);
      } catch (e) {
        document.getElementById('pollStatus').textContent = 'Failed to connect. Please refresh and try again.';
      }
    }

    function showInstall(userKey) {
      document.getElementById('step2').style.display = 'none';
      document.getElementById('step3').style.display = 'block';
      const manifestUrl = BASE_URL + '/' + userKey + '/manifest.json';
      document.getElementById('manifestUrl').textContent = manifestUrl;
      document.getElementById('installBtn').href = 'stremio://' + manifestUrl.replace('https://', '').replace('http://', '');
    }
  </script>
</body>
</html>`);
});

// ── Auth: start device flow ───────────────────────────────────────────────────
app.get('/auth/start', async (req, res) => {
  if (!TRAKT_CLIENT_ID) {
    return res.json({ error: 'TRAKT_CLIENT_ID not set' });
  }
  try {
    const response = await fetch('https://api.trakt.tv/oauth/device/code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SnakeyesTraktAddon/1.0'
      },
      body: JSON.stringify({ client_id: TRAKT_CLIENT_ID.trim() })
    });
    const text = await response.text();
    if (!response.ok) {
      console.error(`Trakt device/code error ${response.status}: ${text}`);
      return res.json({ error: `Trakt returned ${response.status}` });
    }
    const data = JSON.parse(text);
    res.json({
      device_code: data.device_code,
      user_code: data.user_code,
      verification_url: data.verification_url,
      expires_in: data.expires_in,
      interval: data.interval
    });
  } catch (e) {
    console.error('Auth start error:', e.message);
    res.json({ error: e.message });
  }
});

// ── Auth: poll for token ──────────────────────────────────────────────────────
app.get('/auth/poll', async (req, res) => {
  const deviceCode = req.query.device_code;
  if (!deviceCode) return res.json({ error: 'missing device_code' });

  try {
    const response = await fetch('https://api.trakt.tv/oauth/device/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SnakeyesTraktAddon/1.0'
      },
      body: JSON.stringify({
        code: deviceCode,
        client_id: TRAKT_CLIENT_ID.trim(),
        client_secret: TRAKT_CLIENT_SECRET.trim()
      })
    });

    if (response.status === 200) {
      const tokens = await response.json();
      const userKey = crypto.randomBytes(8).toString('hex');
      tokenStore[userKey] = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in * 1000)
      };
      console.log(`New user authenticated: ${userKey}`);
      return res.json({ ready: true, key: userKey });
    } else if (response.status === 400) {
      // Still waiting
      return res.json({ ready: false });
    } else {
      const errText = await response.text();
      console.error(`Trakt poll error ${response.status}: ${errText}`);
      return res.json({ ready: false, error: `Trakt ${response.status}` });
    }
  } catch (e) {
    console.error('Poll error:', e.message);
    return res.json({ ready: false, error: e.message });
  }
});

// ── User manifest ─────────────────────────────────────────────────────────────
app.get('/:userKey/manifest.json', (req, res) => {
  const { userKey } = req.params;
  if (!tokenStore[userKey]) {
    return res.status(404).json({ error: 'User not found. Please reconnect your Trakt account.' });
  }
  res.json(buildManifest(userKey));
});

// ── Catalog ───────────────────────────────────────────────────────────────────
app.get('/:userKey/catalog/:type/:catalogId.json', async (req, res) => {
  const { userKey, type, catalogId } = req.params;

  const userData = tokenStore[userKey];
  if (!userData) {
    return res.json({ metas: [] });
  }

  const accessToken = userData.access_token;
  const typeParam = type === 'movie' ? 'movies' : 'shows';

  try {
    let items = [];

    if (catalogId.includes('history')) {
      items = await traktGet(`/users/me/history/${typeParam}?limit=50`, accessToken);
    } else if (catalogId.includes('watchlist')) {
      items = await traktGet(`/users/me/watchlist/${typeParam}`, accessToken);
    } else if (catalogId.includes('ratings')) {
      items = await traktGet(`/users/me/ratings/${typeParam}`, accessToken);
    } else if (catalogId.includes('collection')) {
      items = await traktGet(`/users/me/collection/${typeParam}`, accessToken);
    }

    const basicMetas = items
      .map(item => traktItemToMeta(item, type))
      .filter(Boolean)
      .filter((item, index, self) => index === self.findIndex(t => t.id === item.id));

    // Fetch posters from TMDB in parallel
    const metas = await Promise.all(
      basicMetas.map(async (meta) => {
        const { poster, background } = await fetchTMDBPoster(meta.id, type);
        return { ...meta, poster, background };
      })
    );

    res.json({ metas });
  } catch (e) {
    console.error('Catalog error:', e.message);
    res.json({ metas: [] });
  }
});

// ── Meta ──────────────────────────────────────────────────────────────────────
app.get('/:userKey/meta/:type/:id.json', async (req, res) => {
  const { userKey, type, id } = req.params;
  const userData = tokenStore[userKey];
  if (!userData) return res.json({ meta: {} });

  try {
    const findRes = await fetch(`https://api.trakt.tv/search/imdb/${id}?type=${type === 'series' ? 'show' : 'movie'}`, {
      headers: {
        'Content-Type': 'application/json',
        'trakt-api-version': '2',
        'trakt-api-key': TRAKT_CLIENT_ID,
        'User-Agent': 'SnakeyesTraktAddon/1.0'
      }
    });
    const findData = await findRes.json();
    if (!findData || findData.length === 0) return res.json({ meta: {} });

    const obj = type === 'movie' ? findData[0].movie : findData[0].show;
    res.json({
      meta: {
        id: id,
        type: type,
        name: obj.title,
        releaseInfo: obj.year ? String(obj.year) : undefined
      }
    });
  } catch (e) {
    console.error('Meta error:', e.message);
    res.json({ meta: {} });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    users: Object.keys(tokenStore).length,
    tmdb: TMDB_API_KEY ? 'set' : 'NOT SET',
    trakt: TRAKT_CLIENT_ID ? 'set' : 'NOT SET'
  });
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Snakeeyes Trakt Addon running on port ${PORT}`);
  if (!TRAKT_CLIENT_ID) console.warn('WARNING: TRAKT_CLIENT_ID is not set');
  if (!TRAKT_CLIENT_SECRET) console.warn('WARNING: TRAKT_CLIENT_SECRET is not set');
});
