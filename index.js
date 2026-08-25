// index.js
// Snakeeyes Simkl Addon — Node.js/Express format for Render.com

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const SIMKL_CLIENT_ID = process.env.SIMKL_CLIENT_ID;
const SIMKL_CLIENT_SECRET = process.env.SIMKL_CLIENT_SECRET;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const REDIRECT_URI = 'https://snakeeyes-trakt.onrender.com/auth/callback';

// ── Persistent token store ────────────────────────────────────────────────────
// Try /opt/render/project/src first (persists on Render), fallback to /tmp
const TOKEN_FILE = fs.existsSync('/opt/render/project/src')
    ? '/opt/render/project/src/simkl_tokens.json'
    : path.join('/tmp', 'simkl_tokens.json');

function loadTokens() {
    try {
        if (fs.existsSync(TOKEN_FILE)) {
            return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        }
    } catch (e) { console.error('Error loading tokens:', e.message); }
    return {};
}

function saveTokens(store) {
    try {
        fs.writeFileSync(TOKEN_FILE, JSON.stringify(store), 'utf8');
        console.log(`Tokens saved to ${TOKEN_FILE}`);
    } catch (e) { console.error('Error saving tokens:', e.message); }
}

const tokenStore = loadTokens();
console.log(`Loaded ${Object.keys(tokenStore).length} existing user tokens`);

// ── TMDB catalog map ──────────────────────────────────────────────────────────
const tmdbCatalogMap = {
    'tmdb-oscar-movies':     'movie/top_rated',
    'tmdb-award-series':     'tv/top_rated',
    'tmdb-drama-movies':     'discover/movie?with_genres=18&sort_by=popularity.desc',
    'tmdb-drama-series':     'discover/tv?with_genres=18&sort_by=popularity.desc',
    'tmdb-comedy-movies':    'discover/movie?with_genres=35&sort_by=popularity.desc',
    'tmdb-comedy-series':    'discover/tv?with_genres=35&sort_by=popularity.desc',
    'tmdb-horror-movies':    'discover/movie?with_genres=27&sort_by=popularity.desc',
    'tmdb-horror-series':    'discover/tv?with_genres=9648&sort_by=popularity.desc',
    'tmdb-classic-comedies': 'discover/movie?with_genres=35&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc',
    'tmdb-classic-drama':    'discover/movie?with_genres=18&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc',
    'tmdb-classic-cartoons': 'discover/tv?with_genres=16&first_air_date.lte=1990-12-31&sort_by=vote_count.desc',
    'tmdb-nolan':            'person/525/movie_credits',
    'tmdb-tarantino':        'person/138/movie_credits',
    'tmdb-spielberg':        'person/488/movie_credits',
    'tmdb-scorsese':         'person/1032/movie_credits',
    'tmdb-dicaprio':         'person/6193/movie_credits',
    'tmdb-denzel':           'person/5292/movie_credits',
    'tmdb-meryl':            'person/5064/movie_credits',
    'tmdb-will-smith':       'person/2888/movie_credits',
};

// ── Simkl public list map ─────────────────────────────────────────────────────
const simklListMap = {
    'simkl-mcu':          { userId: '5',       listId: '2707' },
    'simkl-dc':           { userId: '5',       listId: '2909' },
    'simkl-starwars':     { userId: '5',       listId: '2709' },
    'simkl-lotr':         { userId: '5',       listId: '2708' },
    'simkl-harrypotter':  { userId: '5',       listId: '2710' },
    'simkl-jurassicpark': { userId: '5',       listId: '2712' },
    'simkl-fast-furious': { userId: '5',       listId: '2889' },
    'simkl-godzilla':     { userId: '5',       listId: '3053' },
    'simkl-halloween':    { userId: '5',       listId: '2981' },
    'simkl-best-picture': { userId: '8694788', listId: '200476' },
};

// ── Manifest builder ──────────────────────────────────────────────────────────
function buildManifest(userKey) {
    return {
        id: 'community.snakeeyes.simkl',
        version: '3.0.0',
        name: 'Snakeeyes Simkl',
        description: 'Your Simkl profile + curated catalogs in Stremio.',
        logo: 'https://simkl.com/favicon.ico',
        resources: ['catalog', 'meta'],
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
        catalogs: [
            // Simkl personal
            { type: 'movie',  id: 'simkl-history-movies',   name: '📺 My Watch History (Movies)' },
            { type: 'series', id: 'simkl-history-series',   name: '📺 My Watch History (Series)' },
            { type: 'movie',  id: 'simkl-watchlist-movies', name: '📋 My Watchlist (Movies)' },
            { type: 'series', id: 'simkl-watchlist-series', name: '📋 My Watchlist (Series)' },
            { type: 'movie',  id: 'simkl-ratings-movies',   name: '⭐ My Ratings (Movies)' },
            { type: 'series', id: 'simkl-ratings-series',   name: '⭐ My Ratings (Series)' },
            // Simkl franchise lists
            { type: 'movie',  id: 'simkl-mcu',              name: '🦸 Marvel Cinematic Universe' },
            { type: 'movie',  id: 'simkl-dc',               name: '🦇 DC Extended Universe' },
            { type: 'movie',  id: 'simkl-starwars',         name: '⚔️ Star Wars' },
            { type: 'movie',  id: 'simkl-lotr',             name: '💍 Lord of the Rings' },
            { type: 'movie',  id: 'simkl-harrypotter',      name: '🧙 Harry Potter' },
            { type: 'movie',  id: 'simkl-jurassicpark',     name: '🦕 Jurassic Park' },
            { type: 'movie',  id: 'simkl-fast-furious',     name: '🚗 Fast & Furious' },
            { type: 'movie',  id: 'simkl-godzilla',         name: '🦖 Godzilla' },
            { type: 'movie',  id: 'simkl-halloween',        name: '🎃 Halloween' },
            { type: 'movie',  id: 'simkl-best-picture',     name: '🏆 Best Picture Winners' },
            // TMDB catalogs
            { type: 'movie',  id: 'tmdb-oscar-movies',      name: '🏆 Top Rated Films' },
            { type: 'series', id: 'tmdb-award-series',      name: '🏆 Top Rated Series' },
            { type: 'movie',  id: 'tmdb-drama-movies',      name: '🎭 Drama Movies' },
            { type: 'series', id: 'tmdb-drama-series',      name: '🎭 Drama Series' },
            { type: 'movie',  id: 'tmdb-comedy-movies',     name: '😂 Comedy Movies' },
            { type: 'series', id: 'tmdb-comedy-series',     name: '😂 Comedy Series' },
            { type: 'movie',  id: 'tmdb-horror-movies',     name: '👻 Horror Movies' },
            { type: 'series', id: 'tmdb-horror-series',     name: '👻 Horror Series' },
            { type: 'movie',  id: 'tmdb-classic-comedies',  name: '🎬 Classic Comedies' },
            { type: 'movie',  id: 'tmdb-classic-drama',     name: '🎬 Classic Drama' },
            { type: 'series', id: 'tmdb-classic-cartoons',  name: '🎬 Classic Cartoons' },
            { type: 'movie',  id: 'tmdb-nolan',             name: '🎬 Christopher Nolan' },
            { type: 'movie',  id: 'tmdb-tarantino',         name: '🎬 Quentin Tarantino' },
            { type: 'movie',  id: 'tmdb-spielberg',         name: '🎬 Steven Spielberg' },
            { type: 'movie',  id: 'tmdb-scorsese',          name: '🎬 Martin Scorsese' },
            { type: 'movie',  id: 'tmdb-dicaprio',          name: '🎭 Leonardo DiCaprio' },
            { type: 'movie',  id: 'tmdb-denzel',            name: '🎭 Denzel Washington' },
            { type: 'movie',  id: 'tmdb-meryl',             name: '🎭 Meryl Streep' },
            { type: 'movie',  id: 'tmdb-will-smith',        name: '🎭 Will Smith' },
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
    if (!res.ok) throw new Error(`Simkl API ${res.status}`);
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

    // Person credits
    if (endpoint.includes('/movie_credits')) {
        const items = [...(data.cast || []), ...(data.crew || [])]
            .filter(item => item.poster_path)
            .filter((item, index, self) => index === self.findIndex(t => t.id === item.id))
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, 50);
        return items.map(item => ({
            id: `tt${item.id}`,
            type: 'movie',
            name: item.title,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
            background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
            description: item.overview
        }));
    }

    return (data.results || [])
        .filter(item => item.id)
        .map(item => ({
            id: `tt${item.id}`,
            type: type,
            name: item.title || item.name,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
            background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
            description: item.overview
        }));
}

// ── Convert Simkl item to meta ────────────────────────────────────────────────
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
        saveTokens(tokenStore);
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

    // Simkl public list
    if (simklListMap[catalogId]) {
        try {
            const { userId, listId } = simklListMap[catalogId];
            // Try with user token first, fallback to client_id only
            const url = `https://api.simkl.com/users/${userId}/list/${listId}/items?extended=full`;
            const response = await fetch(url, {
                headers: {
                    'simkl-api-key': SIMKL_CLIENT_ID,
                    'Authorization': `Bearer ${userData.access_token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) throw new Error(`Simkl list ${response.status}`);
            const data = await response.json();
            const items = Array.isArray(data) ? data : (data.items || []);
            const metas = items
                .map(item => {
                    const obj = item.movie || item.show;
                    if (!obj) return null;
                    const imdbId = obj.ids?.imdb;
                    if (!imdbId) return null;
                    return {
                        id: imdbId,
                        type: item.movie ? 'movie' : 'series',
                        name: obj.title,
                        releaseInfo: obj.year ? String(obj.year) : undefined,
                        poster: obj.poster ? `https://simkl.in/posters/${obj.poster}_m.jpg` : null
                    };
                })
                .filter(Boolean);
            return res.json({ metas });
        } catch (e) {
            console.error('Simkl list error:', e.message);
            return res.json({ metas: [] });
        }
    }

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
app.get('/:userKey/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    if (!TMDB_API_KEY) return res.json({ meta: { id, type } });
    try {
        let detail = null;
        if (/^tt\d{7,}$/.test(id)) {
            const findUrl = `https://api.themoviedb.org/3/find/${id}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
            const findRes = await fetch(findUrl);
            const findData = await findRes.json();
            const results = type === 'movie' ? findData.movie_results : findData.tv_results;
            if (results && results.length > 0) {
                const tmdbId = results[0].id;
                const detailUrl = `https://api.themoviedb.org/3/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
                const detailRes = await fetch(detailUrl);
                detail = await detailRes.json();
            }
        } else {
            const tmdbId = id.replace(/^tt/, '');
            const detailUrl = `https://api.themoviedb.org/3/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
            const detailRes = await fetch(detailUrl);
            detail = await detailRes.json();
        }
        if (!detail || detail.success === false) return res.json({ meta: { id, type } });
        res.json({
            meta: {
                id,
                type,
                name: detail.title || detail.name,
                poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null,
                background: detail.backdrop_path ? `https://image.tmdb.org/t/p/w1280${detail.backdrop_path}` : null,
                description: detail.overview,
                releaseInfo: (detail.release_date || detail.first_air_date || '').split('-')[0],
                runtime: type === 'movie' && detail.runtime ? `${detail.runtime} min` : null,
                imdbRating: detail.vote_average ? detail.vote_average.toFixed(1) : null
            }
        });
    } catch (e) {
        console.error('Meta error:', e.message);
        res.json({ meta: { id, type } });
    }
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        simkl: SIMKL_CLIENT_ID ? 'set' : 'NOT SET',
        tmdb: TMDB_API_KEY ? 'set' : 'NOT SET',
        users: Object.keys(tokenStore).length,
        tokenFile: TOKEN_FILE
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Snakeeyes Simkl Addon running on port ${PORT}`);
    console.log(`Token file: ${TOKEN_FILE}`);
    if (!SIMKL_CLIENT_ID) console.warn('WARNING: SIMKL_CLIENT_ID is not set');
    if (!SIMKL_CLIENT_SECRET) console.warn('WARNING: SIMKL_CLIENT_SECRET is not set');
    if (!TMDB_API_KEY) console.warn('WARNING: TMDB_API_KEY is not set');
});
