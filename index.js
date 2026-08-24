// Snakeeyes Simkl Addon — Full version with all movie franchises
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
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

const CACHE_DURATION = 60 * 60 * 24 * 7;

function setCacheHeaders(res, duration = CACHE_DURATION) {
    res.setHeader('Cache-Control', `public, max-age=${duration}, stale-while-revalidate=${duration * 2}`);
    res.setHeader('Expires', new Date(Date.now() + duration * 1000).toUTCString());
}

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
    'tmdb-oscar-movies': { endpoint: 'discover/movie', params: 'with_awards=true&sort_by=vote_count.desc', type: 'search' },
    'tmdb-award-series': { endpoint: 'discover/tv', params: 'with_awards=true&sort_by=vote_count.desc', type: 'search' },
    'tmdb-drama-movies': { endpoint: 'discover/movie', params: 'with_genres=18&sort_by=popularity.desc', type: 'search' },
    'tmdb-drama-series': { endpoint: 'discover/tv', params: 'with_genres=18&sort_by=popularity.desc', type: 'search' },
    'tmdb-comedy-movies': { endpoint: 'discover/movie', params: 'with_genres=35&sort_by=popularity.desc', type: 'search' },
    'tmdb-comedy-series': { endpoint: 'discover/tv', params: 'with_genres=35&sort_by=popularity.desc', type: 'search' },
    'tmdb-horror-movies': { endpoint: 'discover/movie', params: 'with_genres=27&sort_by=popularity.desc', type: 'search' },
    'tmdb-horror-series': { endpoint: 'discover/tv', params: 'with_genres=9648&sort_by=popularity.desc', type: 'search' },
    'tmdb-classic-comedies': { endpoint: 'discover/movie', params: 'with_genres=35&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc', type: 'search' },
    'tmdb-classic-drama': { endpoint: 'discover/movie', params: 'with_genres=18&primary_release_date.lte=1990-12-31&sort_by=vote_count.desc', type: 'search' },
    'tmdb-classic-cartoons': { endpoint: 'discover/tv', params: 'with_genres=16&first_air_date.lte=1990-12-31&sort_by=vote_count.desc', type: 'search' },
    'tmdb-marvel': { endpoint: 'collection', params: '86311', type: 'collection' },
    'tmdb-dc': { endpoint: 'collection', params: '8537', type: 'collection' },
    'tmdb-xmen': { endpoint: 'collection', params: '290150', type: 'collection' },
    'tmdb-spiderman': { endpoint: 'collection', params: '285096', type: 'collection' },
    'tmdb-starwars': { endpoint: 'collection', params: '10', type: 'collection' },
    'tmdb-lotr': { endpoint: 'collection', params: '119', type: 'collection' },
    'tmdb-harrypotter': { endpoint: 'collection', params: '1241', type: 'collection' },
    'tmdb-jurassicpark': { endpoint: 'collection', params: '328', type: 'collection' },
    'tmdb-backtothefuture': { endpoint: 'collection', params: '264', type: 'collection' },
    'tmdb-matrix': { endpoint: 'collection', params: '234', type: 'collection' },
    'tmdb-terminator': { endpoint: 'collection', params: '296', type: 'collection' },
    'tmdb-alien': { endpoint: 'collection', params: '104', type: 'collection' },
    'tmdb-predator': { endpoint: 'keyword', params: 'Predator', type: 'keyword' },
    'tmdb-godzilla': { endpoint: 'keyword', params: 'Godzilla', type: 'keyword' },
    'tmdb-kingkong': { endpoint: 'collection', params: '107227', type: 'collection' },
    'tmdb-transformers': { endpoint: 'collection', params: '14336', type: 'collection' },
    'tmdb-star-trek': { endpoint: 'collection', params: '441', type: 'collection' },
    'tmdb-conjuring': { endpoint: 'collection', params: '616129', type: 'collection' },
    'tmdb-saw': { endpoint: 'collection', params: '269722', type: 'collection' },
    'tmdb-finaldestination': { endpoint: 'collection', params: '636263', type: 'collection' },
    'tmdb-halloween': { endpoint: 'collection', params: '12993', type: 'collection' },
    'tmdb-friday13th': { endpoint: 'collection', params: '12877', type: 'collection' },
    'tmdb-nightmare': { endpoint: 'collection', params: '12738', type: 'collection' },
    'tmdb-scream': { endpoint: 'collection', params: '130947', type: 'collection' },
    'tmdb-childsplay': { endpoint: 'collection', params: '149873', type: 'collection' },
    'tmdb-texaschainsaw': { endpoint: 'collection', params: '264327', type: 'collection' },
    'tmdb-sinister': { endpoint: 'collection', params: '444390', type: 'collection' },
    'tmdb-insidious': { endpoint: 'collection', params: '277677', type: 'collection' },
    'tmdb-the-ring': { endpoint: 'collection', params: '282027', type: 'collection' },
    'tmdb-the-grudge': { endpoint: 'collection', params: '354396', type: 'collection' },
    'tmdb-jamesbond': { endpoint: 'collection', params: '105', type: 'collection' },
    'tmdb-missionimpossible': { endpoint: 'collection', params: '177990', type: 'collection' },
    'tmdb-indianajones': { endpoint: 'collection', params: '259', type: 'collection' },
    'tmdb-pirates': { endpoint: 'collection', params: '168169', type: 'collection' },
    'tmdb-hungergames': { endpoint: 'collection', params: '214761', type: 'collection' },
    'tmdb-johnwick': { endpoint: 'collection', params: '470871', type: 'collection' },
    'tmdb-madmax': { endpoint: 'collection', params: '132639', type: 'collection' },
    'tmdb-rambo': { endpoint: 'collection', params: '103741', type: 'collection' },
    'tmdb-diehard': { endpoint: 'collection', params: '78363', type: 'collection' },
    'tmdb-lethalweapon': { endpoint: 'collection', params: '104546', type: 'collection' },
    'tmdb-bourne': { endpoint: 'collection', params: '141526', type: 'collection' },
    'tmdb-expendables': { endpoint: 'collection', params: '205229', type: 'collection' },
    'tmdb-toy-story': { endpoint: 'collection', params: '49002', type: 'collection' },
    'tmdb-shrek': { endpoint: 'collection', params: '12241', type: 'collection' },
    'tmdb-iceage': { endpoint: 'collection', params: '11138', type: 'collection' },
    'tmdb-howtotrain': { endpoint: 'collection', params: '255409', type: 'collection' },
    'tmdb-despicableme': { endpoint: 'collection', params: '223170', type: 'collection' },
    'tmdb-frozen': { endpoint: 'collection', params: '287358', type: 'collection' },
    'tmdb-disney-renaissance': { endpoint: 'collection', params: '168773', type: 'collection' },
    'tmdb-americanpie': { endpoint: 'collection', params: '103633', type: 'collection' },
    'tmdb-hangover': { endpoint: 'collection', params: '156867', type: 'collection' },
    'tmdb-nakedgun': { endpoint: 'collection', params: '128625', type: 'collection' },
    'tmdb-airplane': { endpoint: 'collection', params: '127707', type: 'collection' },
    'tmdb-godfather': { endpoint: 'collection', params: '128783', type: 'collection' },
    'tmdb-ocean': { endpoint: 'collection', params: '29456', type: 'collection' },
    'tmdb-fastandfurious': { endpoint: 'collection', params: '269875', type: 'collection' },
    'tmdb-nolan': { endpoint: 'person', params: '525/movie_credits', type: 'person' },
    'tmdb-tarantino': { endpoint: 'person', params: '138/movie_credits', type: 'person' },
    'tmdb-spielberg': { endpoint: 'person', params: '488/movie_credits', type: 'person' },
    'tmdb-scorsese': { endpoint: 'person', params: '1032/movie_credits', type: 'person' },
    'tmdb-fincher': { endpoint: 'person', params: '746/movie_credits', type: 'person' },
    'tmdb-cameron': { endpoint: 'person', params: '2710/movie_credits', type: 'person' },
    'tmdb-ridleyscott': { endpoint: 'person', params: '578/movie_credits', type: 'person' },
    'tmdb-dicaprio': { endpoint: 'person', params: '6193/movie_credits', type: 'person' },
    'tmdb-denzel': { endpoint: 'person', params: '5292/movie_credits', type: 'person' },
    'tmdb-meryl': { endpoint: 'person', params: '5064/movie_credits', type: 'person' },
    'tmdb-will-smith': { endpoint: 'person', params: '2888/movie_credits', type: 'person' },
    'tmdb-tom-hanks': { endpoint: 'person', params: '31/movie_credits', type: 'person' },
    'tmdb-brad-pitt': { endpoint: 'person', params: '287/movie_credits', type: 'person' },
    'tmdb-johnny-depp': { endpoint: 'person', params: '85/movie_credits', type: 'person' },
};

function buildManifest() {
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
            { type: 'movie', id: 'simkl-history-movies', name: '📺 My Watch History (Movies)' },
            { type: 'series', id: 'simkl-history-series', name: '📺 My Watch History (Series)' },
            { type: 'movie', id: 'simkl-watchlist-movies', name: '📋 My Watchlist (Movies)' },
            { type: 'series', id: 'simkl-watchlist-series', name: '📋 My Watchlist (Series)' },
            { type: 'movie', id: 'simkl-ratings-movies', name: '⭐ My Ratings (Movies)' },
            { type: 'series', id: 'simkl-ratings-series', name: '⭐ My Ratings (Series)' },
            { type: 'movie', id: 'tmdb-oscar-movies', name: '🏆 Oscar Winning Films' },
            { type: 'series', id: 'tmdb-award-series', name: '🏆 Award Winning Series' },
            { type: 'movie', id: 'tmdb-drama-movies', name: '🎭 Drama Movies' },
            { type: 'series', id: 'tmdb-drama-series', name: '🎭 Drama Series' },
            { type: 'movie', id: 'tmdb-comedy-movies', name: '😂 Comedy Movies' },
            { type: 'series', id: 'tmdb-comedy-series', name: '😂 Comedy Series' },
            { type: 'movie', id: 'tmdb-horror-movies', name: '👻 Horror Movies' },
            { type: 'series', id: 'tmdb-horror-series', name: '👻 Horror Series' },
            { type: 'movie', id: 'tmdb-classic-comedies', name: '🎬 Classic Comedies' },
            { type: 'movie', id: 'tmdb-classic-drama', name: '🎬 Classic Drama' },
            { type: 'series', id: 'tmdb-classic-cartoons', name: '🎬 Classic Cartoons' },
            { type: 'movie', id: 'tmdb-marvel', name: '🦸 Marvel Cinematic Universe' },
            { type: 'movie', id: 'tmdb-dc', name: '🦇 DC Extended Universe' },
            { type: 'movie', id: 'tmdb-xmen', name: '💥 X-Men Collection' },
            { type: 'movie', id: 'tmdb-spiderman', name: '🕷️ Spider-Man Collection' },
            { type: 'movie', id: 'tmdb-starwars', name: '⚔️ Star Wars Collection' },
            { type: 'movie', id: 'tmdb-lotr', name: '💍 Lord of the Rings' },
            { type: 'movie', id: 'tmdb-harrypotter', name: '🧙 Harry Potter Collection' },
            { type: 'movie', id: 'tmdb-jurassicpark', name: '🦕 Jurassic Park Collection' },
            { type: 'movie', id: 'tmdb-backtothefuture', name: '🚗 Back to the Future' },
            { type: 'movie', id: 'tmdb-matrix', name: '💊 The Matrix Collection' },
            { type: 'movie', id: 'tmdb-terminator', name: '🤖 Terminator Collection' },
            { type: 'movie', id: 'tmdb-alien', name: '👽 Alien Collection' },
            { type: 'movie', id: 'tmdb-predator', name: '🎯 Predator Collection' },
            { type: 'movie', id: 'tmdb-godzilla', name: '🦎 Godzilla Collection' },
            { type: 'movie', id: 'tmdb-kingkong', name: '🦍 King Kong Collection' },
            { type: 'movie', id: 'tmdb-transformers', name: '🚗 Transformers Collection' },
            { type: 'movie', id: 'tmdb-star-trek', name: '🖖 Star Trek Collection' },
            { type: 'movie', id: 'tmdb-conjuring', name: '🙏 The Conjuring Universe' },
            { type: 'movie', id: 'tmdb-saw', name: '🔪 Saw Franchise' },
            { type: 'movie', id: 'tmdb-finaldestination', name: '💀 Final Destination Franchise' },
            { type: 'movie', id: 'tmdb-halloween', name: '🎃 Halloween Franchise' },
            { type: 'movie', id: 'tmdb-friday13th', name: '🔪 Friday the 13th' },
            { type: 'movie', id: 'tmdb-nightmare', name: '😈 A Nightmare on Elm Street' },
            { type: 'movie', id: 'tmdb-scream', name: '📞 Scream Franchise' },
            { type: 'movie', id: 'tmdb-childsplay', name: "🔪 Child's Play / Chucky" },
            { type: 'movie', id: 'tmdb-texaschainsaw', name: '⛓️ Texas Chainsaw Massacre' },
            { type: 'movie', id: 'tmdb-sinister', name: '📽️ Sinister Collection' },
            { type: 'movie', id: 'tmdb-insidious', name: '🚪 Insidious Franchise' },
            { type: 'movie', id: 'tmdb-the-ring', name: '📼 The Ring Collection' },
            { type: 'movie', id: 'tmdb-the-grudge', name: '🏚️ The Grudge Collection' },
            { type: 'movie', id: 'tmdb-jamesbond', name: '🔫 James Bond Collection' },
            { type: 'movie', id: 'tmdb-missionimpossible', name: '🎯 Mission: Impossible' },
            { type: 'movie', id: 'tmdb-indianajones', name: '🪓 Indiana Jones Collection' },
            { type: 'movie', id: 'tmdb-pirates', name: '🏴‍☠️ Pirates of the Caribbean' },
            { type: 'movie', id: 'tmdb-hungergames', name: '🏹 The Hunger Games' },
            { type: 'movie', id: 'tmdb-johnwick', name: '🐕 John Wick Collection' },
            { type: 'movie', id: 'tmdb-madmax', name: '🔥 Mad Max Collection' },
            { type: 'movie', id: 'tmdb-rambo', name: '💪 Rambo Collection' },
            { type: 'movie', id: 'tmdb-diehard', name: '💥 Die Hard Collection' },
            { type: 'movie', id: 'tmdb-lethalweapon', name: '🔫 Lethal Weapon Collection' },
            { type: 'movie', id: 'tmdb-bourne', name: '🔍 Bourne Collection' },
            { type: 'movie', id: 'tmdb-expendables', name: '🎯 The Expendables' },
            { type: 'movie', id: 'tmdb-toy-story', name: '🧸 Toy Story Collection' },
            { type: 'movie', id: 'tmdb-shrek', name: '💚 Shrek Collection' },
            { type: 'movie', id: 'tmdb-iceage', name: '❄️ Ice Age Collection' },
            { type: 'movie', id: 'tmdb-howtotrain', name: '🐉 How to Train Your Dragon' },
            { type: 'movie', id: 'tmdb-despicableme', name: '🍌 Despicable Me Collection' },
            { type: 'movie', id: 'tmdb-frozen', name: '❄️ Frozen Collection' },
            { type: 'movie', id: 'tmdb-disney-renaissance', name: '🏰 Disney Renaissance' },
            { type: 'movie', id: 'tmdb-americanpie', name: '🥧 American Pie Collection' },
            { type: 'movie', id: 'tmdb-hangover', name: '🍻 The Hangover Trilogy' },
            { type: 'movie', id: 'tmdb-nakedgun', name: '🔫 The Naked Gun Collection' },
            { type: 'movie', id: 'tmdb-airplane', name: '✈️ Airplane! Collection' },
            { type: 'movie', id: 'tmdb-godfather', name: '🎩 The Godfather Trilogy' },
            { type: 'movie', id: 'tmdb-ocean', name: "💰 Ocean's Collection" },
            { type: 'movie', id: 'tmdb-fastandfurious', name: '🏎️ Fast & Furious Collection' },
            { type: 'movie', id: 'tmdb-nolan', name: '🎬 Christopher Nolan' },
            { type: 'movie', id: 'tmdb-tarantino', name: '🎬 Quentin Tarantino' },
            { type: 'movie', id: 'tmdb-spielberg', name: '🎬 Steven Spielberg' },
            { type: 'movie', id: 'tmdb-scorsese', name: '🎬 Martin Scorsese' },
            { type: 'movie', id: 'tmdb-fincher', name: '🎬 David Fincher' },
            { type: 'movie', id: 'tmdb-cameron', name: '🎬 James Cameron' },
            { type: 'movie', id: 'tmdb-ridleyscott', name: '🎬 Ridley Scott' },
            { type: 'movie', id: 'tmdb-dicaprio', name: '🎭 Leonardo DiCaprio' },
            { type: 'movie', id: 'tmdb-denzel', name: '🎭 Denzel Washington' },
            { type: 'movie', id: 'tmdb-meryl', name: '🎭 Meryl Streep' },
            { type: 'movie', id: 'tmdb-will-smith', name: '🎭 Will Smith' },
            { type: 'movie', id: 'tmdb-tom-hanks', name: '🎭 Tom Hanks' },
            { type: 'movie', id: 'tmdb-brad-pitt', name: '🎭 Brad Pitt' },
            { type: 'movie', id: 'tmdb-johnny-depp', name: '🎭 Johnny Depp' },
        ]
    };
}

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
    return (movieData.results || [])
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
}

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
        } else if (endpoint === 'collection') {
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
        } else if (endpoint === 'person') {
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
        } else {
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
            catalogCache.set(cacheKey, { data: items, timestamp: Date.now() });
            saveCatalogCache();
            console.log(`💾 Cached ${items.length} items for: ${cacheKey}`);
        }
        return items;
    } catch (e) {
        console.error(`❌ TMDB fetch error: ${e.message}`);
        return [];
    }
}

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

app.get('/', (req, res) => {
    setCacheHeaders(res, 60);
    const authUrl = `https://simkl.com/oauth/authorize?response_type=code&client_id=${SIMKL_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Snakeeyes Simkl Addon</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);min-height:100vh;display:flex;justify-content:center;align-items:center;color:#fff;padding:20px}.container{background:rgba(255,255,255,0.05);backdrop-filter:blur(10px);border-radius:20px;padding:40px;max-width:600px;width:100%;border:1px solid rgba(255,255,255,0.1);text-align:center}h1{font-size:2.5rem;margin-bottom:10px;background:linear-gradient(135deg,#f093fb,#f5576c);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.subtitle{color:rgba(255,255,255,0.7);font-size:1.1rem;margin-bottom:30px}.btn{display:inline-block;background:linear-gradient(135deg,#f093fb,#f5576c);color:#fff;padding:16px 40px;border-radius:50px;text-decoration:none;font-weight:600;font-size:1.1rem;transition:all .3s ease;border:none;cursor:pointer;box-shadow:0 10px 30px rgba(245,87,108,0.3)}.btn:hover{transform:translateY(-2px);box-shadow:0 15px 40px rgba(245,87,108,0.5)}.features{margin-top:30px;text-align:left;background:rgba(255,255,255,0.
