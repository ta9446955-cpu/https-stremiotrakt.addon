// Snakeeyes Simkl Addon — franchises + persistent token store (Upstash Redis)
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

const CACHE_DURATION = 60 * 60 * 24 * 7;

function setCacheHeaders(res, duration = CACHE_DURATION) {
    res.setHeader('Cache-Control', `public, max-age=${duration}, stale-while-revalidate=${duration * 2}`);
    res.setHeader('Expires', new Date(Date.now() + duration * 1000).toUTCString());
}

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TOKEN_KEY = 'simkl_tokens';

async function loadTokens() {
    try {
        if (UPSTASH_URL && UPSTASH_TOKEN) {
            const res = await fetch(`${UPSTASH_URL}/get/${TOKEN_KEY}`, {
                headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
            });
            const data = await res.json();
            return data && data.result ? JSON.parse(data.result) : {};
        }
    } catch (e) { console.error('Error loading tokens:', e.message); }
    return {};
}

async function saveTokens(store) {
    try {
        if (UPSTASH_URL && UPSTASH_TOKEN) {
            await fetch(`${UPSTASH_URL}/set/${TOKEN_KEY}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify([JSON.stringify(store)])
            });
        }
    } catch (e) { console.error('Error saving tokens:', e.message); }
}

let tokenStore = {};

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

const tmdbCatalogMap = {
    'tmdb-oscar-movies':     { endpoint: 'discover/movie', params: 'with_awards=true&sort_by=vote_count.desc', type: 'search' },
    'tmdb-award-series':     { endpoint: 'discover/tv', params: 'with_awards=true&sort_by=vote_count.desc', type: 'search' },
    'tmdb-drama-movies':     { endpoint: 'discover/movie', params: 'with_genres=18&sort_by=popularity.desc', type: 'search' },
    'tmdb-drama-series':     { endpoint: 'discover/tv', params: 'with_genres=18&sort_by=popularity.desc', type: 'search' },
    'tmdb-comedy-movies':    { endpoint: 'discover/movie', params: 'with_genres=35&sort_by=popularity.desc', type: 'search' },
    'tmdb-comedy-series':    { endpoint: 'discover/tv', params: 'with_genres=35&sort_by=popularity.desc', type: 'search' },
    'tmdb-horror-movies':    { endpoint: 'discover/movie', params: 'with_genres=27&sort_by=popularity.desc', type: 'search' },
    'tmdb-horror-series':    { endpoint: 'discover/tv', params: 'with_genres=9648&sort_by=popularity.desc', type: 'search' },
    'tmdb-classic-comedies': { endpoint: 'discover/movie', params: 'with_genres=35&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc', type: 'search' },
    'tmdb-classic-drama':    { endpoint: 'discover/movie', params: 'with_genres=18&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc', type: 'search' },
    'tmdb-classic-cartoons': { endpoint: 'discover/tv', params: 'with_genres=16&first_air_date.lte=1990-12-31&sort_by=vote_count.desc', type: 'search' },
    'tmdb-starwars':         { endpoint: 'collection', params: '10', type: 'collection' },
    'tmdb-marvel':           { endpoint: 'collection', params: '86311', type: 'collection' },
    'tmdb-dc':               { endpoint: 'collection', params: '8537', type: 'collection' },
    'tmdb-lotr':             { endpoint: 'collection', params: '119', type: 'collection' },
    'tmdb-harrypotter':      { endpoint: 'collection', params: '1241', type: 'collection' },
    'tmdb-jurassicpark':     { endpoint: 'collection', params: '328', type: 'collection' },
    'tmdb-godzilla':         { endpoint: 'keyword', params: 'Godzilla', type: 'keyword' },
    'tmdb-predator':         { endpoint: 'keyword', params: 'Predator', type: 'keyword' },
    'tmdb-saw':              { endpoint: 'collection', params: '656',    type: 'collection' },
    'tmdb-finaldestination': { endpoint: 'collection', params: '8864',  type: 'collection' },
    'tmdb-conjuring':        { endpoint: 'collection', params: '313086',type: 'collection' },
    'tmdb-jamesbond':        { endpoint: 'collection', params: '645',   type: 'collection' },
    'tmdb-missionimpossible':{ endpoint: 'collection', params: '87359', type: 'collection' },
    'tmdb-fastfurious':      { endpoint: 'collection', params: '9485', type: 'collection' },
    'tmdb-matrix':           { endpoint: 'collection', params: '2344',  type: 'collection' },
    'tmdb-indianajones':     { endpoint: 'collection', params: '84',    type: 'collection' },
    'tmdb-backtofuture':     { endpoint: 'collection', params: '264',   type: 'collection' },
    'tmdb-pirates':          { endpoint: 'collection', params: '295',   type: 'collection' },
    'tmdb-xmen':             { endpoint: 'collection', params: '748',   type: 'collection' },
    'tmdb-diehard':          { endpoint: 'collection', params: '1570',  type: 'collection' },
    'tmdb-nolan':            { endpoint: 'person', params: '525/movie_credits', type: 'person' },
    'tmdb-tarantino':        { endpoint: 'person', params: '138/movie_credits', type: 'person' },
    'tmdb-spielberg':        { endpoint: 'person', params: '488/movie_credits', type: 'person' },
    'tmdb-scorsese':         { endpoint: 'person', params: '1032/movie_credits', type: 'person' },
    'tmdb-dicaprio':         { endpoint: 'person', params: '6193/movie_credits', type: 'person' },
    'tmdb-denzel':           { endpoint: 'person', params: '5292/movie_credits', type: 'person' },
    'tmdb-meryl':            { endpoint: 'person', params: '5064/movie_credits', type: 'person' },
    'tmdb-will-smith':       { endpoint: 'person', params: '2888/movie_credits', type: 'person' },
};

function buildManifest(userKey) {
    return {
        id: 'community.snakeeyes.simkl',
        version: '2.1.0',
        name: 'Snakeeyes Simkl',
        description: 'Your Simkl profile + curated TMDB catalogs in Stremio.',
        logo: 'https://simkl.com/favicon.ico',
        resources: ['catalog', 'meta'],
        types: ['movie', 'series'],
        idPrefixes: ['tt', 'tmdb'],
        catalogs: [
            { type: 'movie',  id: 'simkl-history-movies',    name: '📺 My Watch History (Movies)' },
            { type: 'series', id: 'simkl-history-series',    name: '📺 My Watch History (Series)' },
            { type: 'movie',  id: 'simkl-watchlist-movies',  name: '📋 My Watchlist (Movies)' },
            { type: 'series', id: 'simkl-watchlist-series',  name: '📋 My Watchlist (Series)' },
            { type: 'movie',  id: 'simkl-ratings-movies',    name: '⭐ My Ratings (Movies)' },
            { type: 'series', id: 'simkl-ratings-series',    name: '⭐ My Ratings (Series)' },
            { type: 'movie',  id: 'tmdb-oscar-movies',       name: '🏆 Oscar Winning Films' },
            { type: 'series', id: 'tmdb-award-series',       name: '🏆 Award Winning Series' },
            { type: 'movie',  id: 'tmdb-drama-movies',       name: '🎭 Drama Movies' },
            { type: 'series', id: 'tmdb-drama-series',       name: '🎭 Drama Series' },
            { type: 'movie',  id: 'tmdb-comedy-movies',      name: '😂 Comedy Movies' },
            { type: 'series', id: 'tmdb-comedy-series',      name: '😂 Comedy Series' },
            { type: 'movie',  id: 'tmdb-horror-movies',      name: '👻 Horror Movies' },
            { type: 'series', id: 'tmdb-horror-series',      name: '👻 Horror Series' },
            { type: 'movie',  id: 'tmdb-classic-comedies',   name: '🎬 Classic Comedies' },
            { type: 'movie',  id: 'tmdb-classic-drama',      name: '🎬 Classic Drama' },
            { type: 'series', id: 'tmdb-classic-cartoons',   name: '🎬 Classic Cartoons' },
            { type: 'movie',  id: 'tmdb-starwars',           name: '⚔️ Star Wars Collection' },
            { type: 'movie',  id: 'tmdb-marvel',             name: '🦸 Marvel Collection' },
            { type: 'movie',  id: 'tmdb-dc',                 name: '🦇 DC Collection' },
            { type: 'movie',  id: 'tmdb-lotr',               name: '💍 Lord of the Rings' },
            { type: 'movie',  id: 'tmdb-harrypotter',        name: '🧙 Harry Potter Collection' },
            { type: 'movie',  id: 'tmdb-jurassicpark',       name: '🦕 Jurassic Park Collection' },
            { type: 'movie',  id: 'tmdb-godzilla',           name: '🦎 Godzilla Collection' },
            { type: 'movie',  id: 'tmdb-predator',           name: '👽 Predator Collection' },
            { type: 'movie',  id: 'tmdb-saw',               name: '🔪 Saw Franchise' },
            { type: 'movie',  id: 'tmdb-finaldestination',   name: '💀 Final Destination Franchise' },
            { type: 'movie',  id: 'tmdb-conjuring',         name: '👻 The Conjuring Universe' },
            { type: 'movie',  id: 'tmdb-jamesbond',         name: '🕴️ James Bond Collection' },
            { type: 'movie',  id: 'tmdb-missionimpossible', name: '🕶️ Mission: Impossible' },
            { type: 'movie',  id: 'tmdb-fastfurious',       name: '🏎️ Fast & Furious' },
            { type: 'movie',  id: 'tmdb-matrix',            name: '💊 The Matrix Collection' },
            { type: 'movie',  id: 'tmdb-indianajones',      name: '🤠 Indiana Jones Collection' },
            { type: 'movie',  id: 'tmdb-backtofuture',      name: '🚗 Back to the Future' },
            { type: 'movie',  id: 'tmdb-pirates',          name: '🏴‍☠️ Pirates of the Caribbean' },
            { type: 'movie',  id: 'tmdb-xmen',              name: '🧬 X-Men Collection' },
            { type: 'movie',  id: 'tmdb-diehard',           name: '🔫 Die Hard Collection' },
            { type: 'movie',  id: 'tmdb-nolan',              name: '🎬 Christopher Nolan' },
            { type: 'movie',  id: 'tmdb-tarantino',          name: '🎬 Quentin Tarantino' },
            { type: 'movie',  id: 'tmdb-spielberg',          name: '🎬 Steven Spielberg' },
            { type: 'movie',  id: 'tmdb-scorsese',          name: '🎬 Martin Scorsese' },
            { type: 'movie',  id: 'tmdb-dicaprio',           name: '🎭 Leonardo DiCaprio' },
            { type: 'movie',  id: 'tmdb-denzel',             name: '🎭 Denzel Washington' },
            { type: 'movie',  id: 'tmdb-meryl',              name: '🎭 Meryl Streep' },
            { type: 'movie',  id: 'tmdb-will-smith',         name: '🎭 Will Smith' },
        ]
    };
}

async function simklGet(urlPath, accessToken) {
    const res = await fetch(`https://api.simkl.com${urlPath}`, {
        headers: {
            'Content-Type': 'application/json',
            'simkl-api-key': SIMKL_CLIENT_ID,
            Authorization: `Bearer ${accessToken}`
        }
    });
    if (!res.ok) throw new Error(`Simkl API ${res.status}`);
    return res.json();
}

async function tmdbGet(endpoint, extra = '') {
    const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}${extra ? '&' + extra : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB API ${res.status}`);
    return res.json();
}

function tmdbToMeta(item, type = 'movie') {
    const id = `tmdb:${item.id}`;
    return {
        id,
        type,
        name: item.title || item.name || item.original_title || item.original_name || 'Untitled',
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
        background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        description: item.overview || '',
        releaseInfo: (item.release_date || item.first_air_date || '').slice(0, 4) || null,
        imdbRating: item.vote_average ? item.vote_average.toString() : null,
    };
}

async function getTmdbCatalog(catalogId, type) {
    const def = tmdbCatalogMap[catalogId];
    if (!def) return [];

    if (catalogCache.has(catalogId)) return catalogCache.get(catalogId);

    let items = [];
    try {
        if (def.type === 'collection') {
            const data = await tmdbGet(`collection/${def.params}`);
            items = (data.parts || []).map(p => tmdbToMeta(p, 'movie'));
        } else if (def.type === 'keyword') {
            const kwRes = await tmdbGet(`search/keyword`, `query=${encodeURIComponent(def.params)}`);
            const kwId = kwRes.results && kwRes.results[0] ? kwRes.results[0].id : null;
            if (kwId) {
                const data = await tmdbGet(`discover/movie`, `with_keywords=${kwId}&sort_by=popularity.desc`);
                items = (data.results || []).map(p => tmdbToMeta(p, 'movie'));
            }
        } else if (def.type === 'person') {
            const data = await tmdbGet(`person/${def.params}`);
            items = (data.cast || []).map(p => tmdbToMeta(p, 'movie'));
        } else if (def.type === 'search') {
            const ep = def.endpoint;
            const data = await tmdbGet(`${ep}`, def.params);
            const t = ep.startsWith('discover/tv') ? 'series' : 'movie';
            items = (data.results || []).map(p => tmdbToMeta(p, t));
        }
    } catch (e) {
        console.error(`TMDB error for ${catalogId}:`, e.message);
    }

    catalogCache.set(catalogId, items);
    saveCatalogCache();
    return items;
}

async function getSimklCatalog(userKey, catalogId) {
    const session = tokenStore[userKey];
    if (!session || !session.access_token) return [];

    const map = {
        'simkl-history-movies':   { path: '/sync/history/movies',   type: 'movie' },
        'simkl-history-series':   { path: '/sync/history/shows',   type: 'series' },
        'simkl-watchlist-movies': { path: '/sync/watchlist/movies', type: 'movie' },
        'simkl-watchlist-series': { path: '/sync/watchlist/shows',  type: 'series' },
        'simkl-ratings-movies':   { path: '/sync/ratings/movies',   type: 'movie' },
        'simkl-ratings-series':   { path: '/sync/ratings/shows',    type: 'series' },
    };
    const def = map[catalogId];
    if (!def) return [];

    try {
        const data = await simklGet(def.path, session.access_token);
        const list = Array.isArray(data) ? data : (data.movies || data.shows || []);
        return list.map(item => {
            const ids = item.show_ids || item.movie_ids || item.ids || {};
            const id = ids.imdb ? `tt:${ids.imdb}` : (ids.tmdb ? `tmdb:${ids.tmdb}` : null);
            return id ? {
                id,
                type: def.type,
                name: item.title || item.show_title || item.movie_title || 'Untitled',
                poster: item.poster ? `https://simkl.in/posters/${item.poster}_m.jpg` : null,
                description: item.overview || '',
            } : null;
        }).filter(Boolean);
    } catch (e) {
        console.error(`Simkl error for ${catalogId}:`, e.message);
        return [];
    }
}

// Load tokens on startup before starting the server
loadTokens().then(store => {
    tokenStore = store || {};
    console.log(`🔑 Loaded tokens for ${Object.keys(tokenStore).length} user(s) from storage.`);
    
    const PORT = process.env.PORT || 10000;
    app.listen(PORT, () => {
        console.log(`Addon running on port ${PORT}`);
    });
});

// Configuration page route for linking Simkl
app.get('/configure', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Snakeeyes Simkl - Configuration</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #121212; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
                .card { background: #1e1e1e; padding: 30px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); text-align: center; max-width: 400px; width: 100%; }
                h2 { color: #e50914; margin-bottom: 10px; }
                p { color: #aaa; font-size: 14px; margin-bottom: 20px; }
                button { background: #e50914; color: white; border: none; padding: 12px 20px; font-size: 16px; border-radius: 6px; cursor: pointer; font-weight: bold; width: 100%; }
                button:hover { background: #f40612; }
                #status { margin-top: 15px; font-size: 14px; color: #46d369; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Snakeeyes Simkl</h2>
                <p>Link your Simkl account to sync your watch history, watchlist, and ratings alongside your TMDB franchises.</p>
                <button id="authBtn" onclick="startAuth()">Login with Simkl</button>
                <div id="status"></div>
            </div>
            <script>
                const userKey = 'user_' + Math.random().toString(36).substring(2, 9);
                async function startAuth() {
                    const btn = document.getElementById('authBtn');
                    const status = document.getElementById('status');
                    btn.disabled = true;
                    btn.innerText = 'Requesting Code...';
                    
                    try {
                        const res = await fetch('/auth/device');
                        const data = await res.json();
                        
                        if (data.user_code) {
                            btn.innerText = 'Approve on Simkl';
                            status.innerHTML = 'Please go to <a href="' + data.verification_url + '" target="_blank" style="color: #ff9900;">' + data.verification_url + '</a> and enter code: <b>' + data.user_code + '</b>';
                            pollToken(data.device_code);
                        } else {
                            status.style.color = '#ff4444';
                            status.innerText = 'Failed to get device code.';
                            btn.disabled = false;
                            btn.innerText = 'Login with Simkl';
                        }
                    } catch (e) {
                        status.style.color = '#ff4444';
                        status.innerText = 'Error: ' + e.message;
                        btn.disabled = false;
                        btn.innerText = 'Login with Simkl';
                    }
                }

                async function pollToken(deviceCode) {
                    const interval = setInterval(async () => {
                        try {
                            const res = await fetch('/auth/poll?device_code=' + deviceCode + '&userKey=' + userKey);
                            const data = await res.json();
                            if (data.success) {
                                clearInterval(interval);
                                status.style.color = '#46d369';
                                status.innerHTML = 'Successfully authenticated! Redirecting to Stremio...';
                                setTimeout(() => {
                                    window.location.href = 'stremio://' + window.location.host + '/' + userKey + '/manifest.json';
                                }, 1500);
                            }
                        } catch (e) {}
                    }, 5000);
                }
            </script>
        </body>
        </html>
    `);
});

app.get('/manifest.json', (req, res) => {
    const userKey = req.query.userKey || 'default';
    setCacheHeaders(res, 300);
    res.json(buildManifest(userKey));
});

app.get('/:userKey/manifest.json', (req, res) => {
    const userKey = req.params.userKey;
    setCacheHeaders(res, 300);
    res.json(buildManifest(userKey));
});

app.get('/:userKey/catalog/:type/:id.json', async (req, res) => {
    try {
        const { userKey, type, id } = req.params;
        setCacheHeaders(res);

        let metas = [];
        if (id.startsWith('simkl-')) {
            metas = await getSimklCatalog(userKey, id);
        } else if (id.startsWith('tmdb-')) {
            metas = await getTmdbCatalog(id, type);
        }
        res.json({ metas });
    } catch (e) {
        console.error('Catalog error:', e.message);
        res.json({ metas: [] });
    }
});

app.get('/catalog/:type/:id.json', async (req, res) => {
    try {
        const { type, id } = req.params;
        const userKey = req.query.userKey || 'default';
        setCacheHeaders(res);

        let metas = [];
        if (id.startsWith('simkl-')) {
            metas = await getSimklCatalog(userKey, id);
        } else if (id.startsWith('tmdb-')) {
            metas = await getTmdbCatalog(id, type);
        }
        res.json({ metas });
    } catch (e) {
        console.error('Catalog error:', e.message);
        res.json({ metas: [] });
    }
});

app.get('/meta/:type/:id.json', async (req, res) => {
    try {
        const { type, id } = req.params;
        setCacheHeaders(res);
        res.json({ meta: { id, type, name: 'Loading…' } });
    } catch (e) {
        res.json({ meta: null });
    }
});

app.get('/auth/device', async (req, res) => {
    try {
        const r = await fetch('https://api.simkl.com/oauth/pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'simkl-api-key': SIMKL_CLIENT_ID },
            body: JSON.stringify({ client_id: SIMKL_CLIENT_ID })
        });
        const data = await r.json();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/auth/poll', async (req, res) => {
    try {
        const { userKey, device_code } = req.query;
        const r = await fetch(`https://api.simkl.com/oauth/pin/${device_code}?client_id=${SIMKL_CLIENT_ID}`, {
            headers: { 'simkl-api-key': SIMKL_CLIENT_ID }
        });
        const data = await r.json();
        if (data.access_token) {
            tokenStore[userKey] = { access_token: data.access_token };
            await saveTokens(tokenStore);
            res.json({ success: true });
        } else {
            res.json({ success: false });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});