// index.js
// Snakeeyes Simkl Addon — Node.js/Express format for Render.com
// Combines Simkl personal data + TMDB curated catalogs

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const SIMKL_CLIENT_ID = process.env.SIMKL_CLIENT_ID;
const SIMKL_CLIENT_SECRET = process.env.SIMKL_CLIENT_SECRET;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const REDIRECT_URI = 'https://snakeeyes-trakt.onrender.com/auth/callback';

const tokenStore = {};

// ── TMDB catalog map ──────────────────────────────────────────────────────────
const tmdbCatalogMap = {
    // Award Winning
    'tmdb-oscar-movies':     'discover/movie?with_awards=true&sort_by=vote_count.desc',
    'tmdb-award-series':     'discover/tv?with_awards=true&sort_by=vote_count.desc',
    // Drama
    'tmdb-drama-movies':     'discover/movie?with_genres=18&sort_by=popularity.desc',
    'tmdb-drama-series':     'discover/tv?with_genres=18&sort_by=popularity.desc',
    // Comedy
    'tmdb-comedy-movies':    'discover/movie?with_genres=35&sort_by=popularity.desc',
    'tmdb-comedy-series':    'discover/tv?with_genres=35&sort_by=popularity.desc',
    // Horror
    'tmdb-horror-movies':    'discover/movie?with_genres=27&sort_by=popularity.desc',
    'tmdb-horror-series':    'discover/tv?with_genres=9648&sort_by=popularity.desc',
    // Classic
    'tmdb-classic-comedies': 'discover/movie?with_genres=35&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc',
    'tmdb-classic-drama':    'discover/movie?with_genres=18&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc',
    'tmdb-classic-cartoons': 'discover/tv?with_genres=16&first_air_date.lte=1990-12-31&sort_by=vote_count.desc',
    // Franchises
    'tmdb-marvel':           'discover/movie?with_keywords=180547&sort_by=release_date.asc',
    'tmdb-dc':               'discover/movie?with_keywords=196565&sort_by=release_date.asc',
    'tmdb-starwars':         'discover/movie?with_keywords=161660&sort_by=release_date.asc',
    'tmdb-lotr':             'discover/movie?with_keywords=818&sort_by=release_date.asc',
    'tmdb-harrypotter':      'discover/movie?with_keywords=671&sort_by=release_date.asc',
    'tmdb-jurassicpark':     'discover/movie?with_keywords=1697&sort_by=release_date.asc',
    // Directors
    'tmdb-nolan':            'discover/movie?with_crew=525&sort_by=release_date.desc',
    'tmdb-tarantino':        'discover/movie?with_crew=138&sort_by=release_date.desc',
    'tmdb-spielberg':        'discover/movie?with_crew=488&sort_by=release_date.desc',
    'tmdb-scorsese':         'discover/movie?with_crew=1032&sort_by=release_date.desc',
    // Actors
    'tmdb-dicaprio':         'discover/movie?with_cast=6193&sort_by=release_date.desc',
    'tmdb-denzel':           'discover/movie?with_cast=5292&sort_by=release_date.desc',
    'tmdb-meryl':            'discover/movie?with_cast=5064&sort_by=release_date.desc',
    'tmdb-will-smith':       'discover/movie?with_cast=2888&sort_by=release_date.desc',
};

// ── Manifest builder ──────────────────────────────────────────────────────────
function buildManifest(userKey) {
    return {
        id: 'community.snakeeyes.simkl',
        version: '2.0.0',
        name: 'Snakeeyes Simkl',
        description: 'Your Simkl profile + curated TMDB catalogs in Stremio.',
        logo: 'https://simkl.com/favicon.ico',
        resources: ['catalog', 'meta'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: [
            // Simkl personal
            { type: 'movie',  id: 'simkl-history-movies',    name: '📺 My Watch History (Movies)' },
            { type: 'series', id: 'simkl-history-series',    name: '📺 My Watch History (Series)' },
            { type: 'movie',  id: 'simkl-watchlist-movies',  name: '📋 My Watchlist (Movies)' },
            { type: 'series', id: 'simkl-watchlist-series',  name: '📋 My Watchlist (Series)' },
            { type: 'movie',  id: 'simkl-ratings-movies',    name: '⭐ My Ratings (Movies)' },
            { type: 'series', id: 'simkl-ratings-series',    name: '⭐ My Ratings (Series)' },
            // Award Winning
            { type: 'movie',  id: 'tmdb-oscar-movies',       name: '🏆 Oscar Winning Films' },
            { type: 'series', id: 'tmdb-award-series',       name: '🏆 Award Winning Series' },
            // Drama
            { type: 'movie',  id: 'tmdb-drama-movies',       name: '🎭 Drama Movies' },
            { type: 'series', id: 'tmdb-drama-series',       name: '🎭 Drama Series' },
            // Comedy
            { type: 'movie',  id: 'tmdb-comedy-movies',      name: '😂 Comedy Movies' },
            { type: 'series', id: 'tmdb-comedy-series',      name: '😂 Comedy Series' },
            // Horror
            { type: 'movie',  id: 'tmdb-horror-movies',      name: '👻 Horror Movies' },
            { type: 'series', id: 'tmdb-horror-series',      name: '👻 Horror Series' },
            // Classics
            { type: 'movie',  id: 'tmdb-classic-comedies',   name: '🎬 Classic Comedies' },
            { type: 'movie',  id: 'tmdb-classic-drama',      name: '🎬 Classic Drama' },
            { type: 'series', id: 'tmdb-classic-cartoons',   name: '🎬 Classic Cartoons' },
            // Franchises
            { type: 'movie',  id: 'tmdb-marvel',             name: '🦸 Marvel Collection' },
            { type: 'movie',  id: 'tmdb-dc',                 name: '🦇 DC Collection' },
            { type: 'movie',  id: 'tmdb-starwars',           name: '⚔️ Star Wars Collection' },
            { type: 'movie',  id: 'tmdb-lotr',               name: '💍 Lord of the Rings' },
            { type: 'movie',  id: 'tmdb-harrypotter',        name: '🧙 Harry Potter Collection' },
            { type: 'movie',  id: 'tmdb-jurassicpark',       name: '🦕 Jurassic Park Collection' },
            // Directors
            { type: 'movie',  id: 'tmdb-nolan',              name: '🎬 Christopher Nolan' },
            { type: 'movie',  id: 'tmdb-tarantino',          name: '🎬 Quentin Tarantino' },
            { type: 'movie',  id: 'tmdb-spielberg',          name: '🎬 Steven Spielberg' },
            { type: 'movie',  id: 'tmdb-scorsese',           name: '🎬 Martin Scorsese' },
            // Actors
            { type: 'movie',  id: 'tmdb-dicaprio',           name: '🎭 Leonardo DiCaprio' },
            { type: 'movie',  id: 'tmdb-denzel',             name: '🎭 Denzel Washington' },
            { type: 'movie',  id: 'tmdb-meryl',              name: '🎭 Meryl Streep' },
            { type: 'movie',  id: 'tmdb-will-smith',         name: '🎭 Will Smith' },
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
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Simkl API ${res.status}: ${text}`);
    }
    return res.json();
}

// ── TMDB API helper ───────────────────────────────────────────────────────────
async function tmdbFetch(endpoint, type) {
    if (!TMDB_API_KEY) return [];
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `https://api.themoviedb.org/3/${endpoint}${separator}api_key=${TMDB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || [])
        .filter(item => item.imdb_id || item.id)
        .map(item => ({
            id: `tt${item.imdb_id ? item.imdb_id.replace(/^tt/, '') : item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
            background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
            description: item.overview
        }));
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
    .box { background: #2a2a2a; border-radius: 10px; padding: 20px; margin: 20px 0; }
  </style>
</head>
<body>
  <h1>🐍 Snakeeyes Simkl</h1>
  <p>Connect your Simkl account to see your history, watchlist, ratings plus curated catalogs in Stremio.</p>
  <div class="box">
    <h2>Connect Simkl Account</h2>
    <a class="btn" href="${authUrl}">Connect Simkl</a>
  </div>
</body>
</html>`);
});

// ── Auth callback ─────────────────────────────────────────────────────────────
app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.send('Error: no code received.');
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
            return res.send(`Error: ${err}`);
        }
        const tokens = await response.json();
        const userKey = crypto.randomBytes(8).toString('hex');
        tokenStore[userKey] = { access_token: tokens.access_token };
        const manifestUrl = `https://${req.get('host')}/${userKey}/manifest.json`;
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connected!</title>
  <style>
    body { font-family: Arial, sans-serif; background: #1a1a1a; color: white; text-align: center; padding: 40px 20px; max-width: 600px; margin: 0 auto; }
    h1 { color: #00c865; }
    .btn { background: #7b5cff; color: white; padding: 14px 28px; border-radius: 6px; font-size: 1.1em; text-decoration: none; display: inline-block; margin: 10px; }
    .url-box { background: #111; padding: 12px; border-radius: 6px; word-break: break-all; font-family: monospace; font-size: 0.9em; margin: 10px 0; }
  </style>
</head>
<body>
  <h1>✅ Connected!</h1>
  <p>Your Simkl account is connected. Install the addon in Stremio:</p>
  <div class="url-box">${manifestUrl}</div>
  <a class="btn" href="stremio://${req.get('host')}/${userKey}/manifest.json">Install in Stremio</a>
</body>
</html>`);
    } catch (e) {
        res.send('Error: ' + e.message);
    }
});

// ── User manifest ─────────────────────────────────────────────────────────────
app.get('/:userKey/manifest.json', (req, res) => {
    const { userKey } = req.params;
    if (!tokenStore[userKey]) return res.status(404).json({ error: 'User not found. Please reconnect.' });
    res.json(buildManifest(userKey));
});

// ── Catalog ───────────────────────────────────────────────────────────────────
app.get('/:userKey/catalog/:type/:catalogId.json', async (req, res) => {
    const { userKey, type, catalogId } = req.params;
    const userData = tokenStore[userKey];
    if (!userData) return res.json({ metas: [] });

    // TMDB catalog
    if (tmdbCatalogMap[catalogId]) {
        try {
            const metas = await tmdbFetch(tmdbCatalogMap[catalogId], type);
            return res.json({ metas });
        } catch (e) {
            console.error('TMDB error:', e.message);
            return res.json({ metas: [] });
        }
    }

    // Simkl personal catalog
    const typeParam = type === 'movie' ? 'movies' : 'shows';
    try {
        let items = [];

        if (catalogId.includes('history')) {
            // Simkl: get completed/watching items
            const data = await simklGet(`/sync/all-items/${typeParam}?extended=full&status=completed`, userData.access_token);
            items = data[typeParam] || [];
        } else if (catalogId.includes('watchlist')) {
            const data = await simklGet(`/sync/all-items/${typeParam}?extended=full&status=plantowatch`, userData.access_token);
            items = data[typeParam] || [];
        } else if (catalogId.includes('ratings')) {
            const data = await simklGet(`/sync/ratings/${typeParam}?extended=full`, userData.access_token);
            items = Array.isArray(data) ? data : (data[typeParam] || []);
        }

        const metas = items
            .map(item => simklItemToMeta(item, type))
            .filter(Boolean)
            .filter((item, index, self) => index === self.findIndex(t => t.id === item.id));

        res.json({ metas });
    } catch (e) {
        console.error('Simkl catalog error:', e.message);
        res.json({ metas: [] });
    }
});

// ── Meta ──────────────────────────────────────────────────────────────────────
app.get('/:userKey/meta/:type/:id.json', (req, res) => {
    res.json({ meta: { id: req.params.id, type: req.params.type } });
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        simkl: SIMKL_CLIENT_ID ? 'set' : 'NOT SET',
        tmdb: TMDB_API_KEY ? 'set' : 'NOT SET',
        users: Object.keys(tokenStore).length
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Snakeeyes Simkl Addon running on port ${PORT}`);
    if (!SIMKL_CLIENT_ID) console.warn('WARNING: SIMKL_CLIENT_ID is not set');
    if (!SIMKL_CLIENT_SECRET) console.warn('WARNING: SIMKL_CLIENT_SECRET is not set');
    if (!TMDB_API_KEY) console.warn('WARNING: TMDB_API_KEY is not set');
});
