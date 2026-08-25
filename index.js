// Snakeeyes Simkl Addon — Cleaned up version with only working franchises
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

// ── TMDB catalog map - CLEANED UP ──────────────────────────────────────────
const tmdbCatalogMap = {
    // Award Winning
    'tmdb-oscar-movies':     { endpoint: 'discover/movie', params: 'with_awards=true&sort_by=vote_count.desc', type: 'search' },
    'tmdb-award-series':     { endpoint: 'discover/tv', params: 'with_awards=true&sort_by=vote_count.desc', type: 'search' },
    // Drama
    'tmdb-drama-movies':     { endpoint: 'discover/movie', params: 'with_genres=18&sort_by=popularity.desc', type: 'search' },
    'tmdb-drama-series':     { endpoint: 'discover/tv', params: 'with_genres=18&sort_by=popularity.desc', type: 'search' },
    // Comedy
    'tmdb-comedy-movies':    { endpoint: 'discover/movie', params: 'with_genres=35&sort_by=popularity.desc', type: 'search' },
    'tmdb-comedy-series':    { endpoint: 'discover/tv', params: 'with_genres=35&sort_by=popularity.desc', type: 'search' },
    // Horror
    'tmdb-horror-movies':    { endpoint: 'discover/movie', params: 'with_genres=27&sort_by=popularity.desc', type: 'search' },
    'tmdb-horror-series':    { endpoint: 'discover/tv', params: 'with_genres=9648&sort_by=popularity.desc', type: 'search' },
    // Classic
    'tmdb-classic-comedies': { endpoint: 'discover/movie', params: 'with_genres=35&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc', type: 'search' },
    'tmdb-classic-drama':    { endpoint: 'discover/movie', params: 'with_genres=18&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc', type: 'search' },
    'tmdb-classic-cartoons': { endpoint: 'discover/tv', params: 'with_genres=16&first_air_date.lte=1990-12-31&sort_by=vote_count.desc', type: 'search' },
    
    // Franchises - EXISTING WORKING
    'tmdb-starwars':         { endpoint: 'collection', params: '10', type: 'collection' },
    'tmdb-marvel':           { endpoint: 'collection', params: '86311', type: 'collection' },
    'tmdb-dc':               { endpoint: 'collection', params: '8537', type: 'collection' },
    'tmdb-lotr':             { endpoint: 'collection', params: '119', type: 'collection' },
    'tmdb-harrypotter':      { endpoint: 'collection', params: '1241', type: 'collection' },
    'tmdb-jurassicpark':     { endpoint: 'collection', params: '328', type: 'collection' },
    
    // NEW FRANCHISES ADDED
    'tmdb-johnwick':         { endpoint: 'collection', params: '404609', type: 'collection' },
    'tmdb-finaldestination': { endpoint: 'collection', params: '8864', type: 'collection' },
    'tmdb-saw':              { endpoint: 'collection', params: '656', type: 'collection' },
    
    // Franchises - KEEPING ONLY WORKING ONES
    'tmdb-godzilla':         { endpoint: 'keyword', params: 'Godzilla', type: 'keyword' },
    'tmdb-predator':         { endpoint: 'keyword', params: 'Predator', type: 'keyword' },
    
    // Directors
    'tmdb-nolan':            { endpoint: 'person', params: '525/movie_credits', type: 'person' },
    'tmdb-tarantino':        { endpoint: 'person', params: '138/movie_credits', type: 'person' },
    'tmdb-spielberg':        { endpoint: 'person', params: '488/movie_credits', type: 'person' },
    'tmdb-scorsese':         { endpoint: 'person', params: '1032/movie_credits', type: 'person' },
    
    // Actors
    'tmdb-dicaprio':         { endpoint: 'person', params: '6193/movie_credits', type: 'person' },
    'tmdb-denzel':           { endpoint: 'person', params: '5292/movie_credits', type: 'person' },
    'tmdb-meryl':            { endpoint: 'person', params: '5064/movie_credits', type: 'person' },
    'tmdb-will-smith':       { endpoint: 'person', params: '2888/movie_credits', type: 'person' },
};

// ── Manifest builder ────────────────────────────────────────────────────────
function buildManifest(userKey) {
    return {
        id: 'community.snakeeyes.simkl',
        version: '2.0.9',
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
            
            // Franchises - EXISTING WORKING
            { type: 'movie',  id: 'tmdb-starwars',           name: '⚔️ Star Wars Collection' },
            { type: 'movie',  id: 'tmdb-marvel',             name: '🦸 Marvel Collection' },
            { type: 'movie',  id: 'tmdb-dc',                 name: '🦇 DC Collection' },
            { type: 'movie',  id: 'tmdb-lotr',               name: '💍 Lord of the Rings' },
            { type: 'movie',  id: 'tmdb-harrypotter',        name: '🧙 Harry Potter Collection' },
            { type: 'movie',  id: 'tmdb-jurassicpark',       name: '🦕 Jurassic Park Collection' },
            
            // NEW FRANCHISES ADDED
            { type: 'movie',  id: 'tmdb-johnwick',           name: '🔫 John Wick Collection' },
            { type: 'movie',  id: 'tmdb-finaldestination',   name: '💀 Final Destination Collection' },
            { type: 'movie',  id: 'tmdb-saw',                name: '🔪 Saw Collection' },
            
            // Franchises - KEEPING ONLY WORKING ONES
            { type: 'movie',  id: 'tmdb-godzilla',           name: '🦎 Godzilla Collection' },
            { type: 'movie',  id: 'tmdb-predator',           name: '👽 Predator Collection' },
            
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

// ── Search for keyword and get movies ──────────────────────────────────────
async function searchByKeyword(keyword) {
    console.log(`🔍 Searching for keyword: "${keyword}"`);
    
    const searchUrl = `https://api.themoviedb.org/3/search/keyword?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(keyword)}&page=1`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
        console.error(`❌ Keyword search failed: ${searchRes.status}`);
        return [];
    }
    const searchData = await searchRes.json();
    
    if (!searchData.results || searchData.results.length === 0) {
        console.warn(`⚠️ No keyword found for: "${keyword}"`);
        return [];
    }
    
    const keywordId = searchData.results[0].id;
    console.log(`✅ Found keyword ID: ${keywordId} for "${keyword}"`);
    
    const movieUrl = `https://api.themoviedb.org/3/keyword/${keywordId}/movies?api_key=${TMDB_API_KEY}&language=en-US&page=1&include_adult=false`;
    const movieRes = await fetch(movieUrl);
    if (!movieRes.ok) {
        console.error(`❌ Failed to get movies for keyword: ${movieRes.status}`);
        return [];
    }
    const movieData = await movieRes.json();
    
    const items = (movieData.results || [])
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
    
    console.log(`✅ Found ${items.length} movies for keyword "${keyword}"`);
    return items;
}

// ── TMDB API helper ──────────────────────────────────────────────────────────
async function tmdbFetch(endpoint, params, type, cacheKey) {
    if (!TMDB_API_KEY) {
        console.error('❌ TMDB_API_KEY is not set!');
        return [];
    }
    
    if (cacheKey && catalogCache.has(cacheKey)) {
        const cached = catalogCache.get(cacheKey);
        if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
            console.log(`📦 Using cached data for: ${cacheKey}`);
            return cached.data;
        }
    }
    
    let items = [];

    try {
        if (endpoint === 'keyword') {
            items = await searchByKeyword(params);
        } 
        else if (endpoint === 'collection') {
            const url = `https://api.themoviedb.org/3/collection/${params}?api_key=${TMDB_API_KEY}&language=en-US`;
            console.log(`🌐 Fetching collection: ${url}`);
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`❌ Collection error ${res.status}`);
                return [];
            }
            const data = await res.json();
            
            if (!data.parts || data.parts.length === 0) {
                console.warn(`⚠️ Collection ${params} has no parts`);
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
            
            console.log(`✅ Collection returned ${items.length} items`);
        }
        else if (endpoint === 'person') {
            const url = `https://api.themoviedb.org/3/person/${params}?api_key=${TMDB_API_KEY}&language=en-US`;
            console.log(`🌐 Fetching person: ${url}`);
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`❌ Person error ${res.status}`);
                return [];
            }
            const data = await res.json();
            
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
        }
        else {
            const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}&language=en-US&${params}`;
            console.log(`🌐 Fetching discover: ${url}`);
            const res = await fetch(url);
            if (!res.ok) {
                console.error(`❌ Discover error ${res.status}`);
                return [];
            }
            const data = await res.json();
            
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
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      background: #0b0e14;
      color: #e5e9f0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      margin: 0;
    }
    .container {
      max-width: 700px;
      width: 100%;
      background: #141a24;
      border-radius: 24px;
      padding: 40px 35px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.6);
      border: 1px solid #2a3440;
      transition: all 0.2s;
    }
    h1 {
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 6px;
      background: linear-gradient(135deg, #f5b042, #e8845a);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .subhead {
      color: #8e9aaf;
      font-size: 16px;
      margin-bottom: 30px;
      border-left: 3px solid #f5b042;
      padding-left: 14px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: #f5b042;
      color: #0b0e14;
      font-weight: 600;
      padding: 14px 28px;
      border-radius: 40px;
      text-decoration: none;
      font-size: 18px;
      transition: 0.2s;
      border: none;
      cursor: pointer;
    }
    .btn:hover {
      background: #fcc45e;
      transform: scale(1.02);
      box-shadow: 0 8px 25px rgba(245,176,66,0.25);
    }
    .features {
      margin: 30px 0 20px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .badge {
      background: #1f2a38;
      padding: 6px 16px;
      border-radius: 40px;
      font-size: 13px;
      color: #bcc9e0;
      border: 1px solid #2e3b4a;
    }
    .footer {
      margin-top: 25px;
      font-size: 13px;
      color: #5d6c82;
      border-top: 1px solid #1f2a38;
      padding-top: 18px;
      text-align: center;
    }
    .footer a {
      color: #8e9aaf;
    }
  </style>
</head>
<body>
<div class="container">
  <h1>🐍 Snakeeyes</h1>
  <div class="subhead">Simkl + TMDB · Stremio Addon</div>
  <p style="margin-bottom: 24px; line-height: 1.6; color: #c8d2e3;">
    Connect your Simkl account to see your <strong>watch history</strong>, 
    <strong>watchlist</strong>, and <strong>ratings</strong> directly in Stremio — 
    plus hand-picked TMDB catalogs.
  </p>
  <a class="btn" href="${authUrl}">🔑 Connect Simkl</a>
  <div class="features">
    <span class="badge">📺 History</span>
    <span class="badge">📋 Watchlist</span>
    <span class="badge">⭐ Ratings</span>
    <span class="badge">🎬 TMDB Curated</span>
  </div>
  <div class="footer">
    <a href="${authUrl}">Re-authenticate</a> · 
    <a href="https://github.com/ta9446955-cpu/https-stremiotrakt.addon" target="_blank">GitHub</a>
  </div>
</div>
</body>
</html>`);
});

// ── OAuth callback ────────────────────────────────────────────────────────────
app.get('/auth/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error || !code) {
        return res.status(400).send('❌ OAuth error: ' + (error || 'No code provided'));
    }

    try {
        const tokenRes = await fetch('https://api.simkl.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: code,
                client_id: SIMKL_CLIENT_ID,
                client_secret: SIMKL_CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            })
        });
        if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            throw new Error(`Token exchange failed: ${tokenRes.status} ${errText}`);
        }
        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        const refreshToken = tokenData.refresh_token;

        // Get user info to generate a stable key
        const userRes = await fetch('https://api.simkl.com/me', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'simkl-api-key': SIMKL_CLIENT_ID
            }
        });
        if (!userRes.ok) {
            throw new Error(`Failed to get user info: ${userRes.status}`);
        }
        const userData = await userRes.json();
        const userKey = `user_${userData.id || userData.username}`;

        // Store tokens
        tokenStore[userKey] = {
            accessToken,
            refreshToken,
            userId: userData.id,
            username: userData.username
        };
        saveTokens(tokenStore);

        const manifest = buildManifest(userKey);
        const manifestBase64 = Buffer.from(JSON.stringify(manifest)).toString('base64');

        res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>✅ Connected</title>
<style>body{background:#0b0e14;color:#e5e9f0;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;text-align:center}.box{background:#141a24;padding:40px;border-radius:24px;border:1px solid #2a3440;max-width:500px}.btn{display:inline-block;background:#f5b042;color:#0b0e14;padding:14px 28px;border-radius:40px;text-decoration:none;font-weight:600;margin-top:16px}</style>
</head>
<body>
<div class="box">
<h2>✅ Connected to Simkl</h2>
<p style="color:#8e9aaf;">User: <strong>${userData.username}</strong></p>
<p style="margin:20px 0;">Copy this manifest URL into Stremio:</p>
<code style="background:#1f2a38;padding:10px 16px;border-radius:10px;word-break:break-all;display:block;font-size:14px;">https://${req.get('host')}/manifest/${manifestBase64}</code>
<a class="btn" href="stremio://${req.get('host')}/manifest/${manifestBase64}">📲 Open in Stremio</a>
<p style="margin-top:20px;font-size:13px;color:#5d6c82;">Or install via URL in Stremio settings.</p>
</div>
</body>
</html>`);
    } catch (e) {
        console.error('❌ Auth error:', e.message);
        res.status(500).send(`<h2>❌ Error</h2><p>${e.message}</p>`);
    }
});

// ── Manifest endpoint ──────────────────────────────────────────────────────────
app.get('/manifest/:base64?', (req, res) => {
    setCacheHeaders(res, 60);
    let userKey = null;
    if (req.params.base64) {
        try {
            const decoded = JSON.parse(Buffer.from(req.params.base64, 'base64').toString());
            const foundKey = Object.keys(tokenStore).find(k => 
                tokenStore[k].userId === decoded.userId || 
                tokenStore[k].username === decoded.username
            );
            if (foundKey) userKey = foundKey;
        } catch (e) {}
    }
    const manifest = buildManifest(userKey);
    res.json(manifest);
});

// ── Catalog endpoint ──────────────────────────────────────────────────────────
app.get('/catalog/:type/:id/:extra?', async (req, res) => {
    const { type, id, extra } = req.params;
    
    // Get user key from query parameter or extra
    let userKey = req.query.userKey || null;
    if (extra) {
        try {
            const extraObj = JSON.parse(decodeURIComponent(extra));
            if (extraObj.userKey) userKey = extraObj.userKey;
        } catch (e) {}
    }

    console.log(`📊 Catalog request: type=${type}, id=${id}, userKey=${userKey ? 'present' : 'none'}`);

    try {
        let items = [];

        if (id.startsWith('simkl-')) {
            if (!userKey || !tokenStore[userKey]) {
                return res.status(401).json({ metas: [], error: 'Not authenticated' });
            }
            const { accessToken } = tokenStore[userKey];

            if (id === 'simkl-history-movies') {
                const data = await simklGet('/sync/history/movies', accessToken);
                items = data.map(item => simklItemToMeta(item, 'movie')).filter(Boolean).slice(0, 100);
            } else if (id === 'simkl-history-series') {
                const data = await simklGet('/sync/history/shows', accessToken);
                items = data.map(item => simklItemToMeta(item, 'series')).filter(Boolean).slice(0, 100);
            } else if (id === 'simkl-watchlist-movies') {
                const data = await simklGet('/sync/watchlist/movies', accessToken);
                items = data.map(item => simklItemToMeta(item, 'movie')).filter(Boolean).slice(0, 100);
            } else if (id === 'simkl-watchlist-series') {
                const data = await simklGet('/sync/watchlist/shows', accessToken);
                items = data.map(item => simklItemToMeta(item, 'series')).filter(Boolean).slice(0, 100);
            } else if (id === 'simkl-ratings-movies') {
                const data = await simklGet('/sync/ratings/movies', accessToken);
                items = data.map(item => simklItemToMeta(item, 'movie')).filter(Boolean).slice(0, 100);
            } else if (id === 'simkl-ratings-series') {
                const data = await simklGet('/sync/ratings/shows', accessToken);
                items = data.map(item => simklItemToMeta(item, 'series')).filter(Boolean).slice(0, 100);
            }
        } 
