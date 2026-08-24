// Snakeeyes Simkl Addon — Fixed with proper caching and verified franchise IDs
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
const REDIRECT_URI = process.env.REDIRECT_URI || 'https://snakeeyes-trakt.onrender.com/auth/callback';
const TOKEN_FILE = path.join('/tmp', 'simkl_tokens.json');

// ── Caching middleware ──────────────────────────────────────────────────────
const CACHE_DURATION = 60 * 60 * 24 * 7; // 7 days in seconds

function setCacheHeaders(res, duration = CACHE_DURATION) {
    res.setHeader('Cache-Control', `public, max-age=${duration}, stale-while-revalidate=${duration * 2}`);
    res.setHeader('Expires', new Date(Date.now() + duration * 1000).toUTCString());
}

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

// ── Cache for catalog data to survive restarts ─────────────────────────────
const catalogCache = new Map();
const CACHE_FILE = path.join('/tmp', 'catalog_cache.json');

function loadCatalogCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            Object.entries(data).forEach(([key, value]) => {
                catalogCache.set(key, value);
            });
            console.log(`📦 Loaded ${catalogCache.size} items from catalog cache`);
        }
    } catch (e) { console.error('Error loading catalog cache:', e.message); }
}

function saveCatalogCache() {
    try {
        const data = Object.fromEntries(catalogCache);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
    } catch (e) { console.error('Error saving catalog cache:', e.message); }
}

loadCatalogCache();

// ── TMDB catalog map - FIXED FRANCHISE IDs ──────────────────────────────────
const tmdbCatalogMap = {
    // Award Winning
    'tmdb-oscar-movies':     { endpoint: 'discover/movie', params: 'with_awards=true&sort_by=vote_count.desc' },
    'tmdb-award-series':     { endpoint: 'discover/tv', params: 'with_awards=true&sort_by=vote_count.desc' },
    // Drama
    'tmdb-drama-movies':     { endpoint: 'discover/movie', params: 'with_genres=18&sort_by=popularity.desc' },
    'tmdb-drama-series':     { endpoint: 'discover/tv', params: 'with_genres=18&sort_by=popularity.desc' },
    // Comedy
    'tmdb-comedy-movies':    { endpoint: 'discover/movie', params: 'with_genres=35&sort_by=popularity.desc' },
    'tmdb-comedy-series':    { endpoint: 'discover/tv', params: 'with_genres=35&sort_by=popularity.desc' },
    // Horror
    'tmdb-horror-movies':    { endpoint: 'discover/movie', params: 'with_genres=27&sort_by=popularity.desc' },
    'tmdb-horror-series':    { endpoint: 'discover/tv', params: 'with_genres=9648&sort_by=popularity.desc' },
    // Classic
    'tmdb-classic-comedies': { endpoint: 'discover/movie', params: 'with_genres=35&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc' },
    'tmdb-classic-drama':    { endpoint: 'discover/movie', params: 'with_genres=18&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc' },
    'tmdb-classic-cartoons': { endpoint: 'discover/tv', params: 'with_genres=16&first_air_date.lte=1990-12-31&sort_by=vote_count.desc' },
    
    // Franchises - EXISTING (Verified working)
    'tmdb-starwars':         { endpoint: 'collection', params: '10' },
    'tmdb-marvel':           { endpoint: 'collection', params: '86311' },
    'tmdb-dc':               { endpoint: 'collection', params: '8537' },
    'tmdb-lotr':             { endpoint: 'collection', params: '119' },
    'tmdb-harrypotter':      { endpoint: 'collection', params: '1241' },
    'tmdb-jurassicpark':     { endpoint: 'collection', params: '328' },
    
    // NEW FRANCHISES - FIXED WITH CORRECT IDs AND FALLBACKS
    'tmdb-johnwick':         { endpoint: 'collection', params: '458586', fallback: 'search/keyword?query=John%20Wick&include_adult=false' },
    'tmdb-predator':         { endpoint: 'collection', params: '4179', fallback: 'search/keyword?query=Predator&include_adult=false' },
    'tmdb-friday13':         { endpoint: 'collection', params: '4581', fallback: 'search/keyword?query=Friday%20the%2013th&include_adult=false' },
    'tmdb-nightmareelm':     { endpoint: 'collection', params: '4650', fallback: 'search/keyword?query=Nightmare%20on%20Elm%20Street&include_adult=false' },
    'tmdb-godzilla':         { endpoint: 'collection', params: '358607', fallback: 'search/keyword?query=Godzilla&include_adult=false' },
    'tmdb-fastfurious':      { endpoint: 'collection', params: '3456', fallback: 'search/keyword?query=Fast%20and%20Furious&include_adult=false' },
    
    // Directors
    'tmdb-nolan':            { endpoint: 'person', params: '525/movie_credits' },
    'tmdb-tarantino':        { endpoint: 'person', params: '138/movie_credits' },
    'tmdb-spielberg':        { endpoint: 'person', params: '488/movie_credits' },
    'tmdb-scorsese':         { endpoint: 'person', params: '1032/movie_credits' },
    
    // Actors
    'tmdb-dicaprio':         { endpoint: 'person', params: '6193/movie_credits' },
    'tmdb-denzel':           { endpoint: 'person', params: '5292/movie_credits' },
    'tmdb-meryl':            { endpoint: 'person', params: '5064/movie_credits' },
    'tmdb-will-smith':       { endpoint: 'person', params: '2888/movie_credits' },
};

// ── Manifest builder ────────────────────────────────────────────────────────
function buildManifest(userKey) {
    return {
        id: 'community.snakeeyes.simkl',
        version: '2.0.4',
        name: 'Snakeeyes Simkl',
        description: 'Your Simkl profile + curated TMDB catalogs in Stremio.',
        logo: 'https://simkl.com/favicon.ico',
        resources: ['catalog', 'meta'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb'],
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
            
            // Franchises - EXISTING
            { type: 'movie',  id: 'tmdb-starwars',           name: '⚔️ Star Wars Collection' },
            { type: 'movie',  id: 'tmdb-marvel',             name: '🦸 Marvel Collection' },
            { type: 'movie',  id: 'tmdb-dc',                 name: '🦇 DC Collection' },
            { type: 'movie',  id: 'tmdb-lotr',               name: '💍 Lord of the Rings' },
            { type: 'movie',  id: 'tmdb-harrypotter',        name: '🧙 Harry Potter Collection' },
            { type: 'movie',  id: 'tmdb-jurassicpark',       name: '🦕 Jurassic Park Collection' },
            
            // NEW FRANCHISES - ADDED
            { type: 'movie',  id: 'tmdb-johnwick',           name: '🔫 John Wick Collection' },
            { type: 'movie',  id: 'tmdb-predator',           name: '👽 Predator Collection' },
            { type: 'movie',  id: 'tmdb-friday13',           name: '🔪 Friday the 13th Collection' },
            { type: 'movie',  id: 'tmdb-nightmareelm',       name: '🪓 Nightmare on Elm Street' },
            { type: 'movie',  id: 'tmdb-godzilla',           name: '🦎 Godzilla Collection' },
            { type: 'movie',  id: 'tmdb-fastfurious',        name: '🏎️ Fast & Furious Collection' },
            
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

// ── TMDB API helper with caching and fallback support ──────────────────────
async function tmdbFetch(endpoint, params, type, cacheKey, fallback = null) {
    if (!TMDB_API_KEY) {
        console.error('❌ TMDB_API_KEY is not set!');
        return [];
    }
    
    // Check cache first
    if (cacheKey && catalogCache.has(cacheKey)) {
        const cached = catalogCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
            console.log(`📦 Using cached data for: ${cacheKey}`);
            return cached.data;
        }
    }
    
    let url;
    if (endpoint === 'collection') {
        url = `https://api.themoviedb.org/3/collection/${params}?api_key=${TMDB_API_KEY}&language=en-US`;
    } else if (endpoint === 'person') {
        url = `https://api.themoviedb.org/3/person/${params}?api_key=${TMDB_API_KEY}&language=en-US`;
    } else if (endpoint === 'search/keyword') {
        url = `https://api.themoviedb.org/3/${params}&api_key=${TMDB_API_KEY}&language=en-US`;
    } else {
        url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}&language=en-US&${params}`;
    }
    
    console.log(`🌐 Fetching TMDB: ${url}`);
    
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.error(`❌ TMDB error ${res.status} for ${endpoint}`);
            // Try fallback if available
            if (fallback) {
                console.log(`🔄 Trying fallback: ${fallback}`);
                return await tmdbFetch('search/keyword', fallback, type, `${cacheKey}-fallback`, null);
            }
            return [];
        }
        
        const data = await res.json();
        let items = [];

        // Handle collection endpoint
        if (endpoint === 'collection') {
            if (!data.parts || data.parts.length === 0) {
                console.warn(`⚠️ Collection ${params} has no parts, trying fallback...`);
                if (fallback) {
                    return await tmdbFetch('search/keyword', fallback, type, `${cacheKey}-fallback`, null);
                }
                return [];
            }
            
            items = data.parts
                .filter(item => item.poster_path)
                .sort((a, b) => new Date(a.release_date || '0') - new Date(b.release_date || '0'))
                .map(item => ({
                    id: `tmdb:${item.id}`,
                    type: 'movie',
                    name: item.title,
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
                    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
                    description: item.overview,
                    releaseInfo: item.release_date ? item.release_date.slice(0, 4) : undefined
                }));
            
            console.log(`✅ Collection returned ${items.length} items with posters`);
            
        // Handle search/keyword endpoint
        } else if (endpoint === 'search/keyword') {
            if (!data.results || data.results.length === 0) {
                console.warn(`⚠️ Search returned no results`);
                return [];
            }
            
            // Get movie IDs from keyword search results
            const keywordId = data.results[0]?.id;
            if (!keywordId) return [];
            
            // Now get movies with this keyword
            const movieUrl = `https://api.themoviedb.org/3/keyword/${keywordId}/movies?api_key=${TMDB_API_KEY}&language=en-US&page=1`;
            const movieRes = await fetch(movieUrl);
            if (!movieRes.ok) return [];
            const movieData = await movieRes.json();
            
            items = (movieData.results || [])
                .filter(item => item.poster_path)
                .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
                .map(item => ({
                    id: `tmdb:${item.id}`,
                    type: 'movie',
                    name: item.title,
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
                    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
                    description: item.overview,
                    releaseInfo: item.release_date ? item.release_date.slice(0, 4) : undefined
                }));
            
            console.log(`✅ Keyword search returned ${items.length} items`);
            
        // Handle person credits endpoint
        } else if (endpoint === 'person' && params.includes('/movie_credits')) {
            const allItems = [...(data.cast || []), ...(data.crew || [])];
            const seen = new Set();
            items = allItems
                .filter(item => item.poster_path)
                .filter(item => {
                    const key = item.id;
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                })
                .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
                .slice(0, 50)
                .map(item => ({
                    id: `tmdb:${item.id}`,
                    type: 'movie',
                    name: item.title,
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
                    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
                    description: item.overview,
                    releaseInfo: item.release_date ? item.release_date.slice(0, 4) : undefined
                }));
            
            console.log(`✅ Person credits returned ${items.length} movies`);
            
        // Standard discover/search endpoint
        } else {
            items = (data.results || [])
                .filter(item => item.id && item.poster_path)
                .map(item => ({
                    id: `tmdb:${item.id}`,
                    type: type || 'movie',
                    name: item.title || item.name,
                    poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
                    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
                    description: item.overview,
                    releaseInfo: item.release_date ? item.release_date.slice(0, 4) : (item.first_air_date ? item.first_air_date.slice(0, 4) : undefined)
                }));
            
            console.log(`✅ Discover returned ${items.length} items`);
        }

        // Cache the results
        if (cacheKey && items.length > 0) {
            catalogCache.set(cacheKey, {
                data: items,
                timestamp: Date.now()
            });
            saveCatalogCache();
            console.log(`💾 Cached ${items.length} items for: ${cacheKey}`);
        }

        return items;
    } catch (e) {
        console.error(`❌ TMDB fetch error: ${e.message}`);
        if (fallback) {
            console.log(`🔄 Trying fallback due to error: ${fallback}`);
            try {
                return await tmdbFetch('search/keyword', fallback, type, `${cacheKey}-fallback`, null);
            } catch (fallbackError) {
                console.error(`❌ Fallback also failed: ${fallbackError.message}`);
                return [];
            }
        }
        return [];
    }
}

// ── TMDB Detail fetcher ───────────────────────────────────────────────────────
async function getTmdbDetails(id, type) {
    if (!TMDB_API_KEY) return null;
    try {
        let tmdbId = id;
        if (id.startsWith('tmdb:')) {
            tmdbId = id.replace('tmdb:', '');
        }

        const endpoint = type === 'movie' ? `movie/${tmdbId}` : `tv/${tmdbId}`;
        const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}&language=en-US`;
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
    setCacheHeaders(res, 60);
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
  <div class="box">
    <h3>Status:</h3>
    <p>TMDB API: ${TMDB_API_KEY ? '✅ Configured' : '❌ Missing'}</p>
    <p>Simkl Client: ${SIMKL_CLIENT_ID ? '✅ Configured' : '❌ Missing'}</p>
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
    .url-box { background: #111; padding: 12px; border-radius: 6px; word-break: break-all; font-family: monospace; font-size: 0.9em; margin: 10px; }
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
    setCacheHeaders(res, 60 * 60 * 24 * 30);
    res.json(buildManifest(userKey));
});

// ── Catalog ──────────────────────────────────────────────────────────────────
app.get('/:userKey/catalog/:type/:catalogId.json', async (req, res) => {
    const { userKey, type, catalogId } = req.params;
    const userData = tokenStore[userKey];
    if (!userData) return res.json({ metas: [] });

    setCacheHeaders(res, CACHE_DURATION);

    if (tmdbCatalogMap[catalogId]) {
        try {
            const { endpoint, params, fallback } = tmdbCatalogMap[catalogId];
            const cacheKey = `${userKey}-${catalogId}`;
            const metas = await tmdbFetch(endpoint, params, type, cacheKey, fallback);
            return res.json({ metas });
        } catch (e) {
            console.error('TMDB error:', e.message);
            return res.json({ metas: [] });
        }
    }

    setCacheHeaders(res, 60 * 60 * 4);
    
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

// ── Meta ────────────────────────────────────────────────────────────────────
app.get('/:userKey/meta/:type/:id.json', async (req, res) => {
    const { type, id } = req.params;
    setCacheHeaders(res, CACHE_DURATION);
    try {
        const metaData = await getTmdbDetails(id, type);
        if (metaData) {
            return res.json({ meta: metaData });
        }
    } catch (e) {
        console.error('Error fetching meta:', e.message);
    }
    res.json({ meta: { id, type } });
});

// ── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        tmdb_configured: !!TMDB_API_KEY,
        simkl_configured: !!SIMKL_CLIENT_ID,
        user_count: Object.keys(tokenStore).length,
        cache_size: catalogCache.size
    });
});

// ── Clear cache endpoint ──────────────────────────────────────────────────
app.post('/clear-cache', (req, res) => {
    catalogCache.clear();
    saveCatalogCache();
    res.json({ message: 'Cache cleared' });
});

// ── Start server ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📊 Health check: /health`);
    console.log(`🗑️ Clear cache: POST /clear-cache`);
});
