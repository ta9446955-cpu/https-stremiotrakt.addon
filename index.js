// Snakeeyes Simkl Addon — Full version with all working franchises
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

// ── TMDB catalog map - ALL FRANCHISES INCLUDED ─────────────────────────────
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
    
    // ============================================================
    // 🎬 MOVIE FRANCHISES - COMPLETE LIST
    // ============================================================
    
    // Superhero / Comic Book
    'tmdb-marvel':           { endpoint: 'collection', params: '86311', type: 'collection' }, // Marvel Cinematic Universe
    'tmdb-dc':               { endpoint: 'collection', params: '8537', type: 'collection' },  // DC Extended Universe
    'tmdb-xmen':             { endpoint: 'collection', params: '290150', type: 'collection' }, // X-Men
    'tmdb-spiderman':        { endpoint: 'collection', params: '285096', type: 'collection' }, // Spider-Man
    
    // Sci-Fi / Fantasy
    'tmdb-starwars':         { endpoint: 'collection', params: '10', type: 'collection' },    // Star Wars
    'tmdb-lotr':             { endpoint: 'collection', params: '119', type: 'collection' },    // Lord of the Rings
    'tmdb-harrypotter':      { endpoint: 'collection', params: '1241', type: 'collection' },  // Harry Potter
    'tmdb-jurassicpark':     { endpoint: 'collection', params: '328', type: 'collection' },   // Jurassic Park
    'tmdb-backtothefuture':  { endpoint: 'collection', params: '264', type: 'collection' },   // Back to the Future
    'tmdb-matrix':           { endpoint: 'collection', params: '234', type: 'collection' },   // The Matrix
    'tmdb-terminator':       { endpoint: 'collection', params: '296', type: 'collection' },   // Terminator
    'tmdb-alien':            { endpoint: 'collection', params: '104', type: 'collection' },   // Alien
    'tmdb-predator':         { endpoint: 'keyword', params: 'Predator', type: 'keyword' },    // Predator
    'tmdb-godzilla':         { endpoint: 'keyword', params: 'Godzilla', type: 'keyword' },    // Godzilla
    'tmdb-kingkong':         { endpoint: 'collection', params: '107227', type: 'collection' }, // King Kong
    'tmdb-transformers':     { endpoint: 'collection', params: '14336', type: 'collection' }, // Transformers
    'tmdb-star-trek':        { endpoint: 'collection', params: '441', type: 'collection' },   // Star Trek
    
    // Horror / Thriller
    'tmdb-conjuring':        { endpoint: 'collection', params: '616129', type: 'collection' }, // The Conjuring Universe
    'tmdb-saw':              { endpoint: 'collection', params: '269722', type: 'collection' }, // Saw Franchise
    'tmdb-finaldestination': { endpoint: 'collection', params: '636263', type: 'collection' }, // Final Destination
    'tmdb-halloween':        { endpoint: 'collection', params: '12993', type: 'collection' },  // Halloween
    'tmdb-friday13th':       { endpoint: 'collection', params: '12877', type: 'collection' },  // Friday the 13th
    'tmdb-nightmare':        { endpoint: 'collection', params: '12738', type: 'collection' },  // A Nightmare on Elm Street
    'tmdb-scream':           { endpoint: 'collection', params: '130947', type: 'collection' }, // Scream
    'tmdb-childsplay':       { endpoint: 'collection', params: '149873', type: 'collection' }, // Child's Play / Chucky
    'tmdb-texaschainsaw':    { endpoint: 'collection', params: '264327', type: 'collection' }, // Texas Chainsaw Massacre
    'tmdb-sinister':         { endpoint: 'collection', params: '444390', type: 'collection' }, // Sinister
    'tmdb-insidious':        { endpoint: 'collection', params: '277677', type: 'collection' }, // Insidious
    'tmdb-the-ring':         { endpoint: 'collection', params: '282027', type: 'collection' }, // The Ring
    'tmdb-the-grudge':       { endpoint: 'collection', params: '354396', type: 'collection' }, // The Grudge (Ju-on)
    
    // Action / Adventure
    'tmdb-jamesbond':        { endpoint: 'collection', params: '105', type: 'collection' },    // James Bond
    'tmdb-missionimpossible':{ endpoint: 'collection', params: '177990', type: 'collection' }, // Mission: Impossible
    'tmdb-indianajones':     { endpoint: 'collection', params: '259', type: 'collection' },    // Indiana Jones
    'tmdb-pirates':          { endpoint: 'collection', params: '168169', type: 'collection' }, // Pirates of the Caribbean
    'tmdb-hungergames':      { endpoint: 'collection', params: '214761', type: 'collection' }, // The Hunger Games
    'tmdb-johnwick':         { endpoint: 'collection', params: '470871', type: 'collection' }, // John Wick
    'tmdb-madmax':           { endpoint: 'collection', params: '132639', type: 'collection' }, // Mad Max
    'tmdb-rambo':            { endpoint: 'collection', params: '103741', type: 'collection' }, // Rambo
    'tmdb-diehard':          { endpoint: 'collection', params: '78363', type: 'collection' },  // Die Hard
    'tmdb-lethalweapon':     { endpoint: 'collection', params: '104546', type: 'collection' }, // Lethal Weapon
    'tmdb-bourne':           { endpoint: 'collection', params: '141526', type: 'collection' }, // Bourne
    'tmdb-expendables':      { endpoint: 'collection', params: '205229', type: 'collection' }, // The Expendables
    
    // Animation / Family
    'tmdb-toy-story':        { endpoint: 'collection', params: '49002', type: 'collection' },  // Toy Story
    'tmdb-shrek':            { endpoint: 'collection', params: '12241', type: 'collection' },   // Shrek
    'tmdb-iceage':           { endpoint: 'collection', params: '11138', type: 'collection' },   // Ice Age
    'tmdb-howtotrain':       { endpoint: 'collection', params: '255409', type: 'collection' }, // How to Train Your Dragon
    'tmdb-despicableme':     { endpoint: 'collection', params: '223170', type: 'collection' }, // Despicable Me
    'tmdb-frozen':           { endpoint: 'collection', params: '287358', type: 'collection' }, // Frozen
    'tmdb-disney-renaissance':{ endpoint: 'collection', params: '168773', type: 'collection' }, // Disney Renaissance
    
    // Comedy
    'tmdb-americanpie':      { endpoint: 'collection', params: '103633', type: 'collection' }, // American Pie
    'tmdb-hangover':         { endpoint: 'collection', params: '156867', type: 'collection' }, // The Hangover
    'tmdb-superbad':         { endpoint: 'collection', params: '548903', type: 'collection' }, // Superbad (limited)
    'tmdb-nakedgun':         { endpoint: 'collection', params: '128625', type: 'collection' }, // The Naked Gun
    'tmdb-airplane':         { endpoint: 'collection', params: '127707', type: 'collection' }, // Airplane!
    
    // Crime / Gangster
    'tmdb-godfather':        { endpoint: 'collection', params: '128783', type: 'collection' }, // The Godfather
    'tmdb-ocean':            { endpoint: 'collection', params: '29456', type: 'collection' },   // Ocean's Eleven
    'tmdb-fastandfurious':   { endpoint: 'collection', params: '269875', type: 'collection' }, // Fast & Furious
    'tmdb-scarface':         { endpoint: 'collection', params: '12876', type: 'collection' },   // Scarface (limited)
    
    // Directors
    'tmdb-nolan':            { endpoint: 'person', params: '525/movie_credits', type: 'person' },
    'tmdb-tarantino':        { endpoint: 'person', params: '138/movie_credits', type: 'person' },
    'tmdb-spielberg':        { endpoint: 'person', params: '488/movie_credits', type: 'person' },
    'tmdb-scorsese':         { endpoint: 'person', params: '1032/movie_credits', type: 'person' },
    'tmdb-fincher':          { endpoint: 'person', params: '746/movie_credits', type: 'person' },
    'tmdb-cameron':          { endpoint: 'person', params: '2710/movie_credits', type: 'person' },
    'tmdb-ridleyscott':      { endpoint: 'person', params: '578/movie_credits', type: 'person' },
    
    // Actors
    'tmdb-dicaprio':         { endpoint: 'person', params: '6193/movie_credits', type: 'person' },
    'tmdb-denzel':           { endpoint: 'person', params: '5292/movie_credits', type: 'person' },
    'tmdb-meryl':            { endpoint: 'person', params: '5064/movie_credits', type: 'person' },
    'tmdb-will-smith':       { endpoint: 'person', params: '2888/movie_credits', type: 'person' },
    'tmdb-tom-hanks':        { endpoint: 'person', params: '31/movie_credits', type: 'person' },
    'tmdb-brad-pitt':        { endpoint: 'person', params: '287/movie_credits', type: 'person' },
    'tmdb-johnny-depp':      { endpoint: 'person', params: '85/movie_credits', type: 'person' },
};

// ── Manifest builder ────────────────────────────────────────────────────────
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
            // ── Simkl personal ──
            { type: 'movie',  id: 'simkl-history-movies',    name: '📺 My Watch History (Movies)' },
            { type: 'series', id: 'simkl-history-series',    name: '📺 My Watch History (Series)' },
            { type: 'movie',  id: 'simkl-watchlist-movies',  name: '📋 My Watchlist (Movies)' },
            { type: 'series', id: 'simkl-watchlist-series',  name: '📋 My Watchlist (Series)' },
            { type: 'movie',  id: 'simkl-ratings-movies',    name: '⭐ My Ratings (Movies)' },
            { type: 'series', id: 'simkl-ratings-series',    name: '⭐ My Ratings (Series)' },
            
            // ── Award Winning ──
            { type: 'movie',  id: 'tmdb-oscar-movies',       name: '🏆 Oscar Winning Films' },
            { type: 'series', id: 'tmdb-award-series',       name: '🏆 Award Winning Series' },
            
            // ── Drama ──
            { type: 'movie',  id: 'tmdb-drama-movies',       name: '🎭 Drama Movies' },
            { type: 'series', id: 'tmdb-drama-series',       name: '🎭 Drama Series' },
            
            // ── Comedy ──
            { type: 'movie',  id: 'tmdb-comedy-movies',      name: '😂 Comedy Movies' },
            { type: 'series', id: 'tmdb-comedy-series',      name: '😂 Comedy Series' },
            
            // ── Horror ──
            { type: 'movie',  id: 'tmdb-horror-movies',      name: '👻 Horror Movies' },
            { type: 'series', id: 'tmdb-horror-series',      name: '👻 Horror Series' },
            
            // ── Classics ──
            { type: 'movie',  id: 'tmdb-classic-comedies',   name: '🎬 Classic Comedies' },
            { type: 'movie',  id: 'tmdb-classic-drama',      name: '🎬 Classic Drama' },
            { type: 'series', id: 'tmdb-classic-cartoons',   name: '🎬 Classic Cartoons' },
            
            // ════════════════════════════════════════════════════
            // 🎬 SUPERHERO / COMIC BOOK FRANCHISES
            // ════════════════════════════════════════════════════
            { type: 'movie',  id: 'tmdb-marvel',             name: '🦸 Marvel Cinematic Universe' },
            { type: 'movie',  id: 'tmdb-dc',                 name: '🦇 DC Extended Universe' },
            { type: 'movie',  id: 'tmdb-xmen',               name: '💥 X-Men Collection' },
            { type: 'movie',  id: 'tmdb-spiderman',          name: '🕷️ Spider-Man Collection' },
            
            // ════════════════════════════════════════════════════
            // 🚀 SCI-FI / FANTASY FRANCHISES
            // ════════════════════════════════════════════════════
            { type: 'movie',  id: 'tmdb-starwars',           name: '⚔️ Star Wars Collection' },
            { type: 'movie',  id: 'tmdb-lotr',               name: '💍 Lord of the Rings' },
            { type: 'movie',  id: 'tmdb-harrypotter',        name: '🧙 Harry Potter Collection' },
            { type: 'movie',  id: 'tmdb-jurassicpark',       name: '🦕 Jurassic Park Collection' },
            { type: 'movie',  id: 'tmdb-backtothefuture',    name: '🚗 Back to the Future' },
            { type: 'movie',  id: 'tmdb-matrix',             name: '💊 The Matrix Collection' },
            { type: 'movie',  id: 'tmdb-terminator',         name: '🤖 Terminator Collection' },
            { type: 'movie',  id: 'tmdb-alien',              name: '👽 Alien Collection' },
            { type: 'movie',  id: 'tmdb-predator',           name: '🎯 Predator Collection' },
            { type: 'movie',  id: 'tmdb-godzilla',           name: '🦎 Godzilla Collection' },
            { type: 'movie',  id: 'tmdb-kingkong',           name: '🦍 King Kong Collection' },
            { type: 'movie',  id: 'tmdb-transformers',       name: '🚗 Transformers Collection' },
            { type: 'movie',  id: 'tmdb-star-trek',          name: '🖖 Star Trek Collection' },
            
            // ════════════════════════════════════════════════════
            // 👻 HORROR / THRILLER FRANCHISES
            // ════════════════════════════════════════════════════
            { type: 'movie',  id: 'tmdb-conjuring',          name: '🙏 The Conjuring Universe' },
            { type: 'movie',  id: 'tmdb-saw',                name: '🔪 Saw Franchise' },
            { type: 'movie',  id: 'tmdb-finaldestination',   name: '💀 Final Destination Franchise' },
            { type: 'movie',  id: 'tmdb-halloween',          name: '🎃 Halloween Franchise' },
            { type: 'movie',  id: 'tmdb-friday13th',         name: '🔪 Friday the 13th' },
            { type: 'movie',  id: 'tmdb-nightmare',          name: '😈 A Nightmare on Elm Street' },
            { type: 'movie',  id: 'tmdb-scream',             name: '📞 Scream Franchise' },
            { type: 'movie',  id: 'tmdb-childsplay',         name: '🔪 Child\'s Play / Chucky' },
            { type: 'movie',  id: 'tmdb-texaschainsaw',      name: '⛓️ Texas Chainsaw Massacre' },
            { type: 'movie',  id: 'tmdb-sinister',           name: '📽️ Sinister Collection' },
            { type: 'movie',  id: 'tmdb-insidious',          name: '🚪 Insidious Franchise' },
            { type: 'movie',  id: 'tmdb-the-ring',           name: '📼 The Ring Collection' },
            { type: 'movie',  id: 'tmdb-the-grudge',         name: '🏚️ The Grudge Collection' },
            
            // ════════════════════════════════════════════════════
            // 💥 ACTION / ADVENTURE FRANCHISES
            // ════════════════════════════════════════════════════
            { type: 'movie',  id: 'tmdb-jamesbond',          name: '🔫 James Bond Collection' },
            { type: 'movie',  id: 'tmdb-missionimpossible',  name: '🎯 Mission: Impossible' },
            { type: 'movie',  id: 'tmdb-indianajones',       name: '🪓 Indiana Jones Collection' },
            { type: 'movie',  id: 'tmdb-pirates',            name: '🏴‍☠️ Pirates of the Caribbean' },
            { type: 'movie',  id: 'tmdb-hungergames',        name: '🏹 The Hunger Games' },
            { type: 'movie',  id: 'tmdb-johnwick',           name: '🐕 John Wick Collection' },
            { type: 'movie',  id: 'tmdb-madmax',             name: '🔥 Mad Max Collection' },
            { type: 'movie',  id: 'tmdb-rambo',              name: '💪 Rambo Collection' },
            { type: 'movie',  id: 'tmdb-diehard',            name: '💥 Die Hard Collection' },
            { type: 'movie',  id: 'tmdb-lethalweapon',       name: '🔫 Lethal Weapon Collection' },
            { type: 'movie',  id: 'tmdb-bourne',             name: '🔍 Bourne Collection' },
            { type: 'movie',  id: 'tmdb-expendables',        name: '🎯 The Expendables' },
            
            // ════════════════════════════════════════════════════
            // 🎨 ANIMATION / FAMILY FRANCHISES
            // ════════════════════════════════════════════════════
            { type: 'movie',  id: 'tmdb-toy-story',          name: '🧸 Toy Story Collection' },
            { type: 'movie',  id: 'tmdb-shrek',              name: '💚 Shrek Collection' },
            { type: 'movie',  id: 'tmdb-iceage',             name: '❄️ Ice Age Collection' },
            { type: 'movie',  id: 'tmdb-howtotrain',         name: '🐉 How to Train Your Dragon' },
            { type: 'movie',  id: 'tmdb-despicableme',       name: '🍌 Despicable Me Collection' },
            { type: 'movie',  id: 'tmdb-frozen',             name: '❄️ Frozen Collection' },
            { type: 'movie',  id: 'tmdb-disney-renaissance', name: '🏰 Disney Renaissance' },
            
            // ════════════════════════════════════════════════════
            // 😂 COMEDY FRANCHISES
            // ════════════════════════════════════════════════════
            { type: 'movie',  id: 'tmdb-americanpie',        name: '🥧 American Pie Collection' },
            { type: 'movie',  id: 'tmdb-hangover',           name: '🍻 The Hangover Trilogy' },
            { type: 'movie',  id: 'tmdb-nakedgun',           name: '🔫 The Naked Gun Collection' },
            { type: 'movie',  id: 'tmdb-airplane',           name: '✈️ Airplane! Collection' },
            
            // ════════════════════════════════════════════════════
            // 🎩 CRIME / GANGSTER FRANCHISES
            // ════════════════════════════════════════════════════
            { type: 'movie',  id: 'tmdb-godfather',          name: '🎩 The Godfather Trilogy' },
            { type: 'movie',  id: 'tmdb-ocean',              name: '💰 Ocean\'s Collection' },
            { type: 'movie',  id: 'tmdb-fastandfurious',     name: '🏎️ Fast & Furious Collection' },
            
            // ── Directors ──
            { type: 'movie',  id: 'tmdb-nolan',              name: '🎬 Christopher Nolan' },
            { type: 'movie',  id: 'tmdb-tarantino',          name: '🎬 Quentin Tarantino' },
            { type: 'movie',  id: 'tmdb-spielberg',          name: '🎬 Steven Spielberg' },
            { type: 'movie',  id: 'tmdb-scorsese',           name: '🎬 Martin Scorsese' },
            { type: 'movie',  id: 'tmdb-fincher',            name: '🎬 David Fincher' },
            { type: 'movie',  id: 'tmdb-cameron',            name: '🎬 James Cameron' },
            { type: 'movie',  id: 'tmdb-ridleyscott',        name: '🎬 Ridley Scott' },
            
            // ── Actors ──
            { type: 'movie',  id: 'tmdb-dicaprio',           name: '🎭 Leonardo DiCaprio' },
            { type: 'movie',  id: 'tmdb-denzel',             name: '🎭 Denzel Washington' },
            { type: 'movie',  id: 'tmdb-meryl',              name: '🎭 Meryl Streep' },
            { type: 'movie',  id: 'tmdb-will-smith',         name: '🎭 Will Smith' },
            { type: 'movie',  id: 'tmdb-tom-hanks',          name: '🎭 Tom Hanks' },
            { type: 'movie',  id: 'tmdb-brad-pitt',          name: '🎭 Brad Pitt' },
            { type: 'movie',  id: 'tmdb-johnny-depp',        name: '🎭 Johnny Depp' },
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
            
            console.log(`✅
