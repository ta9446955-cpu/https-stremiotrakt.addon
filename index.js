// index.js
// Snakeeyes Simkl Addon — Node.js/Express format for Render.com

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const SIMKL_CLIENT_ID = process.env.SIMKL_CLIENT_ID;
const SIMKL_CLIENT_SECRET = process.env.SIMKL_CLIENT_SECRET;
const REDIRECT_URI = 'https://snakeeyes-trakt.onrender.com/auth/callback';

// In-memory token store
const tokenStore = {};

// ── Manifest builder ──────────────────────────────────────────────────────────
function buildManifest(userKey) {
    return {
        id: 'community.snakeeyes.simkl',
        version: '1.0.0',
        name: 'Snakeeyes Simkl',
        description: 'Your Simkl history, watchlist, ratings and collection in Stremio.',
        logo: 'https://simkl.com/favicon.ico',
        resources: ['catalog', 'meta'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: [
            { type: 'movie',  id: 'simkl-history-movies',    name: 'Simkl History (Movies)' },
            { type: 'series', id: 'simkl-history-series',    name: 'Simkl History (Series)' },
            { type: 'movie',  id: 'simkl-watchlist-movies',  name: 'Simkl Watchlist (Movies)' },
            { type: 'series', id: 'simkl-watchlist-series',  name: 'Simkl Watchlist (Series)' },
            { type: 'movie',  id: 'simkl-ratings-movies',    name: 'Simkl Ratings (Movies)' },
            { type: 'series', id: 'simkl-ratings-series',    name: 'Simkl Ratings (Series)' },
            { type: 'movie',  id: 'simkl-collection-movies', name: 'Simkl Collection (Movies)' },
            { type: 'series', id: 'simkl-collection-series', name: 'Simkl Collection (Series)' }
        ]
    };
}

// ── Simkl API helper ──────────────────────────────────────────────────────────
async function simklGet(path, accessToken) {
    const res = await fetch(`https://api.simkl.com${path}`, {
        headers: {
            'Content-Type': 'application/json',
            'simkl-api-key': SIMKL_CLIENT_ID,
            'Authorization': `Bearer ${accessToken}`
        }
    });
    if (!res.ok) throw new Error(`Simkl API error: ${res.status}`);
    return res.json();
}

// ── Convert Simkl item to Stremio meta ────────────────────────────────────────
function simklItemToMeta(item, type) {
    const obj = item.movie || item.show;
    if (!obj) return null;
    const imdbId = obj.ids?.imdb;
    if (!imdbId) return null;
    return {
        id: imdbId,
        type: type,
        name: obj.title,
        releaseInfo: obj.year ? String(obj.year) : undefined,
        poster: obj.poster ? `https://simkl.in/posters/${obj.poster}_m.jpg` : null
    };
}

// ── Landing page ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const authUrl = `https://simkl.com/oauth/authorize?response_type=code&client_id=${SIMKL_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Snakeeyes Simkl Addon</title>
  <style>
    body { font-family: Arial, sans-serif; background: #1a1a1a; color: white; text-align: center; padding: 40px 20px; max-width: 600px; margin: 0 auto; }
    h1 { color: #00c865; }
    .btn { background: #00c865; color: white; padding: 14px 28px; border-radius: 6px; font-size: 1.1em; text-decoration: none; display: inline-block; margin: 10px; }
    .btn:hover { background: #00a050; }
    .btn-install { background: #7b5cff; }
    .btn-install:hover { background: #6245e0; }
    .box { background: #2a2a2a; border-radius: 10px; padding: 20px; margin: 20px 0; }
    .url-box { background: #111; padding: 12px; border-radius: 6px; word-break: break-all; font-family: monospace; font-size: 0.9em; margin: 10px 0; }
  </style>
</head>
<body>
  <h1>🐍 Snakeeyes Simkl</h1>
  <p>Connect your Simkl account to see your history, watchlist, ratings and collection in Stremio.</p>
  <div class="box">
    <h2>Connect Simkl Account</h2>
    <p>Click below to authorize with Simkl.</p>
    <a class="btn" href="${authUrl}">Connect Simkl</a>
  </div>
</body>
</html>`);
});

// ── Auth callback ─────────────────────────────────────────────────────────────
app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send('Error: no code received from Simkl.');

    try {
        const response = await fetch('https://api.simkl.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code,
                client_id: SIMKL_CLIENT_ID,
                client_secret: SIMKL_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('Token error:', err);
            return res.send('Error getting token from Simkl. Please try again.');
        }

        const tokens = await response.json();
        const userKey = crypto.randomBytes(8).toString('hex');
        tokenStore[userKey] = {
            access_token: tokens.access_token
        };

        console.log(`New user authenticated: ${userKey}`);

        const manifestUrl = `https://${req.get('host')}/${userKey}/manifest.json`;
        const installUrl = `stremio://${req.get('host')}/${userKey}/manifest.json`;

        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connected!</title>
  <style>
    body { font-family: Arial, sans-serif; background: #1a1a1a; color: white; text-align: center; padding: 40px 20px; max-width: 600px; margin: 0 auto; }
    h1 { color: #00c865; }
    .btn-install { background: #7b5cff; color: white; padding: 14px 28px; border-radius: 6px; font-size: 1.1em; text-decoration: none; display: inline-block; margin: 10px; }
    .url-box { background: #111; padding: 12px; border-radius: 6px; word-break: break-all; font-family: monospace; font-size: 0.9em; margin: 10px 0; }
  </style>
</head>
<body>
  <h1>✅ Connected!</h1>
  <p>Your Simkl account is connected. Install the addon in Stremio:</p>
  <div class="url-box">${manifestUrl}</div>
  <a class="btn-install" href="${installUrl}">Install in Stremio</a>
  <p style="margin-top:20px;font-size:0.85em;color:#888;">Or paste the URL above manually into Stremio's addon search field.</p>
</body>
</html>`);
    } catch (e) {
        console.error('Auth callback error:', e.message);
        res.send('Error: ' + e.message);
    }
});

// ── User manifest ─────────────────────────────────────────────────────────────
app.get('/:userKey/manifest.json', (req, res) => {
    const { userKey } = req.params;
    if (!tokenStore[userKey]) {
        return res.status(404).json({ error: 'User not found. Please reconnect your Simkl account.' });
    }
    res.json(buildManifest(userKey));
});

// ── Catalog ───────────────────────────────────────────────────────────────────
app.get('/:userKey/catalog/:type/:catalogId.json', async (req, res) => {
    const { userKey, type, catalogId } = req.params;
    const userData = tokenStore[userKey];
    if (!userData) return res.json({ metas: [] });

    const typeParam = type === 'movie' ? 'movies' : 'shows';

    try {
        let items = [];

        if (catalogId.includes('history')) {
            const data = await simklGet(`/sync/all-items/${typeParam}/watching?extended=full`, userData.access_token);
            items = data[typeParam] || [];
        } else if (catalogId.includes('watchlist')) {
            const data = await simklGet(`/sync/all-items/${typeParam}/plantowatch?extended=full`, userData.access_token);
            items = data[typeParam] || [];
        } else if (catalogId.includes('ratings')) {
            const data = await simklGet(`/sync/ratings/${typeParam}?extended=full`, userData.access_token);
            items = data || [];
        } else if (catalogId.includes('collection')) {
            const data = await simklGet(`/sync/all-items/${typeParam}/completed?extended=full`, userData.access_token);
            items = data[typeParam] || [];
        }

        const metas = items
            .map(item => simklItemToMeta(item, type))
            .filter(Boolean)
            .filter((item, index, self) => index === self.findIndex(t => t.id === item.id));

        res.json({ metas });
    } catch (e) {
        console.error('Catalog error:', e.message);
        res.json({ metas: [] });
    }
});

// ── Meta ──────────────────────────────────────────────────────────────────────
app.get('/:userKey/meta/:type/:id.json', (req, res) => {
    const { type, id } = req.params;
    res.json({ meta: { id, type } });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        simkl: SIMKL_CLIENT_ID ? 'set' : 'NOT SET',
        users: Object.keys(tokenStore).length
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Snakeeyes Simkl Addon running on port ${PORT}`);
    if (!SIMKL_CLIENT_ID) console.warn('WARNING: SIMKL_CLIENT_ID is not set');
    if (!SIMKL_CLIENT_SECRET) console.warn('WARNING: SIMKL_CLIENT_SECRET is not set');
});
