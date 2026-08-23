// index.js
// Snakeeyes Simkl Addon — Node.js/Express format for Render.com
// Combines Simkl personal data + TMDB curated catalogs

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
const TOKEN_FILE = path.join('/tmp', 'simkl_tokens.json');

// ── Persistent token store ────────────────────────────────────────────────────
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
    } catch (e) { console.error('Error saving tokens:', e.message); }
}

const tokenStore = loadTokens();

// ── TMDB catalog map - Using Collection IDs instead of Keywords ────────────
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
    // Franchises - Using COLLECTION endpoints for precise results with CORRECTED IDs
    'tmdb-marvel':           'collection/131295',
    'tmdb-dc':               'collection/86311',
    'tmdb-starwars':         'collection/9744',
    'tmdb-lotr':             'collection/119',
    'tmdb-harrypotter':      'collection/80960',
    'tmdb-jurassicpark':     'collection/328',
    // Directors - using person ID with credits endpoint
    'tmdb-nolan':            'person/525/movie_credits',
    'tmdb-tarantino':        'person/138/movie_credits',
    'tmdb-spielberg':        'person/488/movie_credits',
    'tmdb-scorsese':         'person/1032/movie_credits',
    // Actors - using person ID with credits endpoint  
    'tmdb-dicaprio':         'person/6193/movie_credits',
    'tmdb-denzel':           'person/5292/movie_credits',
    'tmdb-meryl':            'person/5064/movie_credits',
    'tmdb-will-smith':       'person/2888/movie_credits',
};

// ── Manifest builder ────────────────────────────────────────────────────────
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

// ── Simkl API helper ────────────────────────────────────────────────────────
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

// ── Get IMDb ID from TMDB ID ────────────────────────────────────
async function getImdbIdFromTmdb(tmdbId, type) {
    if (!TMDB_API_KEY) return null;
    try {
        const endpoint = type === 'movie' ? `movie/${tmdbId}` : `tv/${tmdbId}`;
        const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return data.imdb_id || null;
    } catch (e) {
        console.error('Error getting IMDb ID:', e.message);
        return null;
    }
}

// ── TMDB API helper - Handle both collection and discover endpoints ────────
async function tmdbFetch(endpoint, type) {
    if (!TMDB_API_KEY) return [];
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `https://api.themoviedb.org/3/${endpoint}${separator}api_key=${TMDB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
        console.error(`TMDB API error for ${endpoint}: ${res.status}`);
        return [];
    }
    const data = await res.json();

    // Handle collection endpoint (returns parts array)
    if (endpoint.includes('/collection/')) {
        const items = (data.parts || [])
            .filter(item => item.poster_path)
            .sort((a, b) => {
                const dateA = new Date(a.release_date || '0');
                const dateB = new Date(b.release_date || '0');
                return dateA - dateB;
            });
        return items.map(item => ({
            id: `tmdb:${item.id}`,
            tmdbId: item.id,
            type: 'movie',
            name: item.title,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
            background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
            description: item.overview
        }));
    }

    // Handle person credits endpoint (returns cast/crew arrays)
    if (endpoint.includes('/movie_credits')) {
        const items = [...(data.cast || []), ...(data.crew || [])]
            .filter(item => item.poster_path)
            .filter((item, index, self) => index === self.findIndex(t => t.id === item.id))
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, 50);
        return items.map(item => ({
            id: `tmdb:${item.id}`,
            tmdbId: item.id,
            type: 'movie',
            name: item.title,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
            background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
            description: item.overview
        }));
    }

    // Standard discover endpoint
    return (data.results || [])
        .filter(item => item.id)
        .map(item => ({
            id: `tmdb:${item.id}`,
            tmdbId: item.id,
            type: type,
            name: item.title || item.name,
            poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
            background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
            description: item.overview
        }));
}

// ── TMDB Detail fetcher ───────────────────────────────────────────────────────
async function getTmdbDetails(id, type) {
    if (!TMDB_API_KEY) return null;
    try {
        let tmdbId = id;
        
        // If it's a TMDB ID (starts with tmdb:)
        if (id.startsWith('tmdb:')) {
            tmdbId = id.replace('tmdb:', '');
        } else {
            // If it's an IMDb ID, we need to fetch the TMDB record first
            const cleanId = id.replace(/^tt/, '');
            tmdbId = cleanId;
        }

        const endpoint = type === 'movie' ? `movie/${tmdbId}` : `tv/${tmdbId}`;
        const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        
        return {
            id: id,
            type: type,
            name: data.title || data.name,
            poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            background: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
            description: data.overview,
            releaseInfo: data.release_date ? data.release_date.slice(0, 4) : (data.first_air_date ? data.first_air_date.slice(0, 4) : undefined),
            rating: data.vote_average ? Math.round(data.vote_average * 10) : undefined,
            genres: data.genres ? data.genres.map(g => g.name) : [],
            runtime: data.runtime || data.episode_run_time?.[0]
        };
    } catch (e) {
        console.error('Error fetching TMDB details:', e.message);
        return null;
    }
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

// ── Landing page ─────────────────────────────────────────────────────────────
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

// ── Auth callback ────────────────────────────────────────────────────────────
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

// ── User manifest ────────────────────────────────────────────────────────────
app.get('/:userKey/manifest.json', (req, res) => {
    const { userKey } = req.params;
    if (!tokenStore[userKey]) return res.status(404).json({ error: 'User not found. Please reconnect.' });
    res.json(buildManifest(userKey));
});

// ── Catalog ──────────────────────────────────────────────────────────────────
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

// ── Meta ────────────────────────────────────────────────────────────────────
app.get('/:userKey/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    try {
        const metaData = await getTmdbDetails(id, type);
        if (metaData) {
            return res.json({ meta: metaData });
        }
    } catch (e) {
        console.error('Error fetching meta:', e.message);
    }
    // Fallback
    res.json({ meta: { id, type } });
});

// ── Health ──────────────────────────────────────────────────────────────────
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
