// Snakeeyes Movie Collections — With Full Meta Endpoint Support

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const TMDB_API_KEY = process.env.TMDB_API_KEY;

const CACHE_DURATION = 60 * 60 * 24 * 7;

function setCacheHeaders(res, duration = CACHE_DURATION) {
    res.setHeader('Cache-Control', `public, max-age=${duration}, stale-while-revalidate=${duration * 2}`);
    res.setHeader('Expires', new Date(Date.now() + duration * 1000).toUTCString());
}

const catalogCache = new Map();
const CACHE_FILE = path.join('/tmp', 'catalog_cache.json');

function loadCatalogCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            Object.entries(data).forEach(([key, value]) => {
                catalogCache.set(key, value);
            });
        }
    } catch (e) {}
}

function saveCatalogCache() {
    try {
        const data = Object.fromEntries(catalogCache);
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
    } catch (e) {}
}

loadCatalogCache();

const tmdbCatalogMap = {
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
    'tmdb-diehard':          { endpoint: 'collection', params: '1570',  type: 'collection' }
};

function buildManifest() {
    return {
        id: 'community.snakeeyes.collections',
        version: '3.0.1',
        name: 'Snakeeyes Movie Collections',
        description: 'Curated movie franchise and collection catalogs in Stremio.',
        logo: 'https://image.tmdb.org/t/p/w500/wwemzKWzjKYJFfCeiB57q3r4Bcm.png',
        resources: ['catalog', 'meta'],
        types: ['movie'],
        idPrefixes: ['tt', 'tmdb'],
        catalogs: [
            { type: 'movie', id: 'tmdb-starwars',           name: '⚔️ Star Wars Collection' },
            { type: 'movie', id: 'tmdb-marvel',             name: '🦸 Marvel Collection' },
            { type: 'movie', id: 'tmdb-dc',                 name: '🦇 DC Collection' },
            { type: 'movie', id: 'tmdb-lotr',               name: '💍 Lord of the Rings' },
            { type: 'movie', id: 'tmdb-harrypotter',        name: '🧙 Harry Potter Collection' },
            { type: 'movie', id: 'tmdb-jurassicpark',       name: '🦕 Jurassic Park Collection' },
            { type: 'movie', id: 'tmdb-godzilla',           name: '🦎 Godzilla Collection' },
            { type: 'movie', id: 'tmdb-predator',           name: '👽 Predator Collection' },
            { type: 'movie', id: 'tmdb-saw',               name: '🔪 Saw Franchise' },
            { type: 'movie', id: 'tmdb-finaldestination',   name: '💀 Final Destination Franchise' },
            { type: 'movie', id: 'tmdb-conjuring',         name: '👻 The Conjuring Universe' },
            { type: 'movie', id: 'tmdb-jamesbond',         name: '🕴️ James Bond Collection' },
            { type: 'movie', id: 'tmdb-missionimpossible', name: '🕶️ Mission: Impossible' },
            { type: 'movie', id: 'tmdb-fastfurious',       name: '🏎️ Fast & Furious' },
            { type: 'movie', id: 'tmdb-matrix',            name: '💊 The Matrix Collection' },
            { type: 'movie', id: 'tmdb-indianajones',      name: '🤠 Indiana Jones Collection' },
            { type: 'movie', id: 'tmdb-backtofuture',      name: '🚗 Back to the Future' },
            { type: 'movie', id: 'tmdb-pirates',          name: '🏴‍☠️ Pirates of the Caribbean' },
            { type: 'movie', id: 'tmdb-xmen',              name: '🧬 X-Men Collection' },
            { type: 'movie', id: 'tmdb-diehard',           name: '🔫 Die Hard Collection' }
        ]
    };
}

async function tmdbGet(endpoint, extra = '') {
    const url = `https://api.themoviedb.org/3/${endpoint}?api_key=${TMDB_API_KEY}${extra ? '&' + extra : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TMDB API ${res.status}`);
    return res.json();
}

async function enrichWithImdbId(tmdbId) {
    try {
        const data = await tmdbGet(`movie/${tmdbId}/external_ids`);
        if (data && data.imdb_id) return data.imdb_id;
    } catch (e) {}
    return null;
}

async function tmdbToMeta(item) {
    const imdbId = await enrichWithImdbId(item.id);
    const id = imdbId ? imdbId : `tmdb:${item.id}`;
    
    return {
        id,
        type: 'movie',
        name: item.title || item.original_title || 'Untitled',
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
        background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        description: item.overview || '',
        releaseInfo: (item.release_date || '').slice(0, 4) || null,
        imdbRating: item.vote_average ? item.vote_average.toString() : null,
    };
}

async function getTmdbCatalog(catalogId) {
    const def = tmdbCatalogMap[catalogId];
    if (!def) return [];
    if (catalogCache.has(catalogId)) return catalogCache.get(catalogId);

    let rawItems = [];
    try {
        if (def.type === 'collection') {
            const data = await tmdbGet(`collection/${def.params}`);
            rawItems = data.parts || [];
        } else if (def.type === 'keyword') {
            const kwRes = await tmdbGet(`search/keyword`, `query=${encodeURIComponent(def.params)}`);
            const kwId = kwRes.results && kwRes.results[0] ? kwRes.results[0].id : null;
            if (kwId) {
                const data = await tmdbGet(`discover/movie`, `with_keywords=${kwId}&sort_by=popularity.desc`);
                rawItems = data.results || [];
            }
        }
    } catch (e) {}

    const items = await Promise.all(rawItems.map(item => tmdbToMeta(item)));
    catalogCache.set(catalogId, items);
    saveCatalogCache();
    return items;
}

// Fetch detailed single movie metadata for Stremio detail pages
async function getTmdbMeta(id) {
    try {
        let tmdbId = id;
        if (id.startsWith('tt')) {
            const findRes = await tmdbGet(`find/${id}`, `external_source=imdb_id`);
            if (findRes.movie_results && findRes.movie_results.length > 0) {
                tmdbId = findRes.movie_results[0].id;
            } else {
                return null;
            }
        } else if (id.startsWith('tmdb:')) {
            tmdbId = id.replace('tmdb:', '');
        }

        const data = await tmdbGet(`movie/${tmdbId}`);
        if (!data || data.success === false) return null;

        return {
            id: id,
            type: 'movie',
            name: data.title || data.original_title || 'Untitled',
            genres: (data.genres || []).map(g => g.name),
            poster: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
            background: data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : null,
            description: data.overview || '',
            releaseInfo: (data.release_date || '').slice(0, 4) || null,
            imdbRating: data.vote_average ? data.vote_average.toString() : null,
            runtime: data.runtime ? `${data.runtime} mins` : null,
        };
    } catch (e) {
        return null;
    }
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Collections addon running on port ${PORT}`);
});

app.get('/manifest.json', (req, res) => {
    setCacheHeaders(res, 300);
    res.json(buildManifest());
});

app.get('/catalog/:type/:id.json', async (req, res) => {
    try {
        const { id } = req.params;
        setCacheHeaders(res);
        const metas = await getTmdbCatalog(id);
        res.json({ metas });
    } catch (e) {
        res.json({ metas: [] });
    }
});

app.get('/meta/:type/:id.json', async (req, res) => {
    try {
        const { id } = req.params;
        setCacheHeaders(res);
        const meta = await getTmdbMeta(id);
        if (meta) {
            res.json({ meta });
        } else {
            res.json({ meta: { id, type: 'movie', name: 'Unknown Title' } });
        }
    } catch (e) {
        res.json({ meta: { id: req.params.id, type: 'movie', name: 'Error' } });
    }
});

app.get('/configure', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Snakeeyes Movie Collections</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: sans-serif; background: #121212; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; text-align: center; }
                .card { background: #1e1e1e; padding: 30px; border-radius: 12px; max-width: 400px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
                h2 { color: #e50914; }
                p { color: #aaa; font-size: 14px; line-height: 1.5; }
            </style>
        </head>
        <body>
            <div class="card">
                <h2>Snakeeyes Movie Collections</h2>
                <p>This addon is fully configured and ready! Use your manifest URL in Stremio:</p>
                <p style="color:#ff9900; word-break:break-all;"><b>https://snakeeyes-trakt.onrender.com/manifest.json</b></p>
            </div>
        </body>
        </html>
    `);
});