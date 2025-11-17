// ==============================================================================
// ==  ADDON GHOST - v56.0 (BLACK OPS: TOTAL OBFUSCATION)                      ==
// == - STEALTH NÍVEL MÁXIMO: Sem endpoints, sem headers, sem nomes de API.    ==
// == - TOTALMENTE GENÉRICO: O código é apenas um motor de requisições.        ==
// == - REQUER CONFIGURAÇÃO PESADA: Você define a "alma" do addon no Koyeb.    ==
// ==============================================================================

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const path = require('path');

// --- 1. CONFIGURAÇÃO ESTRITA (CARREGADA DO AMBIENTE) ---
const PORT_ADDON = process.env.PORT || 7002;

// -- CREDENCIAIS --
const ENV_TOKEN = process.env.AUTH_TOKEN;   
const ENV_COOKIE = process.env.AUTH_COOKIE; 

// -- BASES DE API --
const API_MAIN = process.env.API_HOST_MAIN;     
const API_VISUAL = process.env.API_HOST_VISUAL; 
const API_META = process.env.API_HOST_META;     
const API_ALT = process.env.API_HOST_ALT;       

// -- ENDPOINTS (CAMINHOS DA URL) --
const EP_LIST_1 = process.env.PATH_LIST_POP;   
const EP_LIST_2 = process.env.PATH_LIST_NEW;    
const EP_LIST_3 = process.env.PATH_LIST_FAV;   
const EP_SEARCH = process.env.PATH_SEARCH;      
const EP_DETAIL = process.env.PATH_DETAIL;     
const EP_EPISODES = process.env.PATH_EPISODES;  
const EP_STREAM_A = process.env.PATH_STREAM_A;  
const EP_STREAM_B = process.env.PATH_STREAM_B; 

// -- HEADERS ESPECÍFICOS --
const HDR_UA_VAL = process.env.HEADER_UA_VAL;   
const HDR_APP_KEY = process.env.HEADER_APP_KEY; 
const HDR_APP_VAL = process.env.HEADER_APP_VAL; 

// Validação de Segurança
const REQUIRED_VARS = [ENV_TOKEN, API_MAIN, EP_LIST_1, EP_SEARCH, EP_DETAIL, EP_EPISODES];
if (REQUIRED_VARS.some(v => !v)) {
    console.error("❌ ERRO FATAL: Variáveis de ambiente críticas estão faltando. O código não pode rodar.");
    process.exit(1);
}

// --- 2. UTILITÁRIOS & CACHE ---
function getCacheDir() {
    const dir = path.join(os.tmpdir(), 'addon_cache');
    if (!fs.existsSync(dir)) try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    return dir;
}
const CACHE_DB = path.join(getCacheDir(), 'db.json');
const CACHE_VIS = path.join(getCacheDir(), 'vis.json');
const CACHE_MAP = path.join(getCacheDir(), 'map.json');

let db = { items: new Map(), groups: new Map(), lastBuild: 0, lastSearch: 0, busy: false };
let visCache = new Map(); 
let mapCache = new Map(); 

function loadCaches() {
    try {
        if (fs.existsSync(CACHE_DB)) {
            const d = JSON.parse(fs.readFileSync(CACHE_DB));
            db.items = new Map(d.items); db.groups = new Map(d.groups);
            db.lastBuild = d.lb || 0; db.lastSearch = d.ls || 0;
        }
        if (fs.existsSync(CACHE_VIS)) visCache = new Map(JSON.parse(fs.readFileSync(CACHE_VIS)));
        if (fs.existsSync(CACHE_MAP)) mapCache = new Map(JSON.parse(fs.readFileSync(CACHE_MAP)));
        console.log(`[INIT] DB: ${db.items.size} | VIS: ${visCache.size}`);
    } catch (e) {}
}

function saveCaches() {
    try {
        const d = { items: [...db.items], groups: [...db.groups], lb: db.lastBuild, ls: db.lastSearch };
        fs.writeFileSync(CACHE_DB, JSON.stringify(d));
        fs.writeFileSync(CACHE_VIS, JSON.stringify([...visCache]));
        fs.writeFileSync(CACHE_MAP, JSON.stringify([...mapCache]));
    } catch (e) {}
}

// --- 3. NETWORK ---
const getSafeToken = () => {
    let t = ENV_TOKEN.trim().replace(/^["']|["']$/g, '');
    return t.toLowerCase().startsWith('bearer ') ? t : `Bearer ${t}`;
};
const getSafeCookie = () => ENV_COOKIE.trim().replace(/^["']|["']$/g, '');

const getHeaders = () => {
    const h = {
        'Authorization': getSafeToken(),
        'User-Agent': HDR_UA_VAL || 'Mozilla/5.0',
        'Cookie': getSafeCookie()
    };
    if (HDR_APP_KEY && HDR_APP_VAL) {
        h[HDR_APP_KEY] = HDR_APP_VAL;
    }
    return h;
};

const delay = ms => new Promise(r => setTimeout(r, ms));
const req = async (url, opts = {}, r = 2) => {
    try { await delay(300); return await axios.get(url, opts); }
    catch (e) { if (r > 0) return req(url, opts, r - 1); throw e; }
};

// --- 4. LOGIC ---
function cleanTxt(t) { return t ? t.replace(/\s*[-–(]?\s*(Dublado|Legendado|Dub|Leg)\s*[)]?$/gi, '').replace(/\s*[-–]\s*$/, '').trim() : ""; }
function slug(s) { return s ? s.toLowerCase().replace(/[^a-z0-9]/g, '') : ""; }
const isMov = (t) => t ? (t.toLowerCase().includes('movie') || t.toLowerCase().includes('filme') || t.toLowerCase().includes('ova')) : false;

function parse(t) {
    const c = cleanTxt(t).toLowerCase();
    const m1 = c.match(/(.*?)\s*(?:season|temporada|s)\s*(\d+)/);
    if (m1) return { base: m1[1].trim(), seq: parseInt(m1[2]), orig: t };
    const m2 = c.match(/(.*?)\s+(\d+)$/);
    if (m2 && parseInt(m2[2]) < 1900) return { base: m2[1].trim(), seq: parseInt(m2[2]), orig: t };
    return { base: c, seq: 1, orig: t };
}

function upDB(list) {
    if (!Array.isArray(list)) return;
    list.forEach(i => {
        const id = `i-${i.id || i.posts_id}`; // Prefixo genérico 'i-' (item)
        const name = i.titulo || i.postTitle;
        if (!i.posts_id && !i.id) return;
        const p = parse(name);
        const data = {
            id: id, rid: i.id || i.posts_id, name: name,
            img: i.cover_url || i.thumbnail,
            base: p.base, seq: p.seq, orig: name
        };
        db.items.set(id, data);
        if (!db.groups.has(p.base)) db.groups.set(p.base, { e: [] });
        const grp = db.groups.get(p.base);
        if (!grp.e.some(x => x.id === id)) {
            grp.e.push(data);
            grp.e.sort((a, b) => (a.year - b.year) || (a.seq - b.seq));
        }
    });
}

async function bgTask() {
    if (db.busy) return;
    db.busy = true;
    try {
        const eps = [EP_LIST_1, EP_LIST_2];
        for (const e of eps) {
            const res = await req(`${API_MAIN}/${e}`, { headers: getHeaders() });
            upDB(res.data.data || res.data);
        }
        db.lastBuild = Date.now();
        saveCaches();
    } catch (e) {} finally { db.busy = false; }
}

async function bgScan() {
    if (db.busy) return;
    db.busy = true;
    const chars = 'abcdefghijklmnopqrstuvwxyz'.split('');
    try {
        for (const c of chars) {
            try {
                const res = await req(`${API_MAIN}/${EP_SEARCH}?name=${c}`, { headers: getHeaders() });
                upDB(res.data.data || res.data);
                await delay(1500);
            } catch(e) {}
        }
        db.lastSearch = Date.now();
        saveCaches();
    } catch (e) {} finally { db.busy = false; }
}

// --- 5. BRIDGE ---
async function getVis(raw, movie) {
    const p = parse(raw);
    const k = `${slug(p.base)}|${movie?'m':'t'}`;
    if (visCache.has(k)) return visCache.get(k);
    if (visCache.has(`F:${k}`)) return null;

    try {
        const { data } = await axios.get(`${API_VISUAL}/search?keyword=${encodeURIComponent(p.base)}&page=1`, { timeout: 3000 });
        if (!data?.data?.response) { visCache.set(`F:${k}`, true); return null; }

        const res = data.data.response.filter(r => (movie ? r.type === 'Movie' : r.type !== 'Movie'));
        if (res.length === 0) return null;

        const s = slug(p.base);
        let m = res.find(r => slug(r.title) === s || (r.alternativeTitle && slug(r.alternativeTitle) === s));
        
        if (!m) {
            const cands = res.filter(r => slug(r.title).includes(s) || (r.alternativeTitle && slug(r.alternativeTitle).includes(s)));
            if (cands.length > 0) {
                cands.sort((a, b) => a.title.length - b.title.length);
                m = cands[0];
            }
        }

        if (m) {
            const val = { poster: m.poster, title: m.title, id: m.id };
            visCache.set(k, val);
            saveCaches();
            return val;
        }
        visCache.set(`F:${k}`, true);
    } catch (e) {}
    return null;
}

async function resolveExt(extId) {
    if (mapCache.has(extId)) return mapCache.get(extId);
    let names = [];

    try {
        if (extId.startsWith('tt') && API_META) {
            const m = (await axios.get(`${API_META}/meta/series/${extId}.json`)).data.meta;
            if (m?.name) names.push(m.name);
        } 
        else if (extId.startsWith('kitsu') && API_ALT) {
            const kid = extId.split(':')[1];
            const r = (await axios.get(`${API_ALT}/anime/${kid}`)).data.data.attributes.titles;
            if (r.en_jp) names.push(r.en_jp); if (r.en) names.push(r.en);
        }

        for (const n of names) {
            if (!n) continue;
            const cn = cleanTxt(n);
            const res = await axios.get(`${API_MAIN}/${EP_SEARCH}?name=${encodeURIComponent(cn)}`, { headers: getHeaders() });
            const d = res.data.data || res.data;

            if (d && d.length > 0) {
                const ts = slug(cn);
                const valid = d.filter(r => {
                    const t = slug(r.titulo || r.postTitle);
                    return t.includes(ts) || ts.includes(t);
                });
                const best = valid.length > 0 ? valid[0] : d[0];
                const iId = `i-${best.id || best.posts_id}`;
                mapCache.set(extId, iId);
                saveCaches();
                upDB([best]);
                return iId;
            }
        }
    } catch (e) {}
    return null;
}

// --- 6. BUILDER ---
const builder = new addonBuilder({
    id: 'org.generic.anime', 
    version: '56.0.0', 
    name: 'Anime BR',
    resources: ['catalog', 'meta', 'stream'], 
    types: ['series', 'movie'], 
    catalogs: [
        { type: 'series', id: 'cat_pop', name: 'Populares' },
        { type: 'series', id: 'cat_new', name: 'Lançamentos' },
        { type: 'series', id: 'cat_fav', name: 'Favoritos' },
        { type: 'series', id: 'cat_find', name: 'Buscar...', extra: [{ name: 'search', isRequired: true }] }
    ],
    idPrefixes: ['i-', 'tt', 'kitsu'],
    config: [{ key: "userToken", type: "text", title: "Token" }]
});

builder.defineCatalogHandler(async ({ id, extra, config }) => {
    const headers = getHeaders();
    let items = [];
    try {
        let ep = '';
        if (extra?.search) ep = `${EP_SEARCH}?name=${encodeURIComponent(extra.search)}`;
        else if (id === 'cat_pop') ep = EP_LIST_1;
        else if (id === 'cat_new') ep = EP_LIST_2;
        else if (id === 'cat_fav') ep = EP_LIST_3;

        if (ep) {
            const res = await axios.get(`${API_MAIN}/${ep}`, { headers });
            items = res.data.data || res.data;
            if (id === 'cat_fav' && !Array.isArray(items)) items = Object.values(items);
            if (items) upDB(items);
        }
    } catch(e) {}

    if (!items || items.length === 0) return { metas: [] };

    const metas = [];
    const BATCH = 4;
    const T_OUT = 8000;
    const t0 = Date.now();

    for (let i = 0; i < items.length; i += BATCH) {
        const b = items.slice(i, i + BATCH);
        if (Date.now() - t0 > T_OUT) {
            metas.push(...b.map(x => ({
                id: `i-${x.id || x.posts_id}`, type: 'series', name: x.titulo || x.postTitle, poster: x.cover_url || x.thumbnail
            })));
            continue;
        }
        const rich = await Promise.all(b.map(async (x) => {
            const rt = x.name || x.titulo || x.postTitle;
            const im = isMov(rt);
            const v = await getVis(rt, im);
            return {
                id: `i-${x.id || x.posts_id}`, type: im ? 'movie' : 'series', name: rt,
                poster: v ? v.poster : (x.poster || x.cover_url || x.thumbnail),
                description: v ? `HD` : ''
            };
        }));
        metas.push(...rich);
        await delay(200);
    }
    return { metas };
});

builder.defineMetaHandler(async ({ id }) => {
    let iId = id;
    if (id.startsWith('tt') || id.startsWith('kitsu')) {
        const r = await resolveExt(id);
        if (r) iId = r; else return { meta: null };
    }

    const pid = iId.replace('i-', '');
    try {
        const det = (await axios.get(`${API_MAIN}/${EP_DETAIL}/${pid}`, { headers: getHeaders() })).data;
        const rt = det.titulo;
        const im = isMov(rt);
        const p = parse(rt);
        const v = await getVis(rt, im);

        const meta = {
            id: id, type: im ? 'movie' : 'series', name: rt,
            poster: v ? v.poster : det.cover_url, background: v ? v.poster : det.cover_url,
            description: det.descricao, genres: det.generos ? det.generos.map(g => g.nome) : [],
            videos: []
        };

        if (!im) {
            const eps = (await axios.get(`${API_MAIN}/${EP_EPISODES}?order=ASC&postID=${pid}`, { headers: getHeaders() })).data.data || [];
            meta.videos = eps.map((e, i) => ({
                id: `${iId}:${e.id}`, title: `Ep. ${i + 1}`, season: p.seq, episode: i + 1
            }));
            const grp = db.groups.get(p.base);
            if (grp) {
                const idx = grp.e.findIndex(e => e.id === iId);
                if (idx > 0) meta.links = [{ name: `Ant`, category: 'meta', url: `stremio:///detail/series/${grp.e[idx-1].id}` }];
                if (idx < grp.e.length - 1) {
                    if (!meta.links) meta.links = [];
                    meta.links.push({ name: `Prox`, category: 'meta', url: `stremio:///detail/series/${grp.e[idx+1].id}` });
                }
            }
        }
        return { meta };
    } catch (e) { return { meta: null }; }
});

builder.defineStreamHandler(async ({ id }) => {
    let iId = id, epNum = 1;
    if (id.startsWith('tt') || id.startsWith('kitsu')) {
        const p = id.split(':');
        let extId = id.startsWith('kitsu') ? `kitsu:${p[1]}` : p[0];
        epNum = parseInt(p[id.startsWith('kitsu') ? 2 : 2]);
        const baId = await resolveExt(extId);
        if (!baId) return { streams: [] };
        const pid = baId.replace('i-', '');
        try {
            const eps = (await axios.get(`${API_MAIN}/${EP_EPISODES}?order=ASC&postID=${pid}`, { headers: getHeaders() })).data.data || [];
            if (eps[epNum - 1]) iId = `${baId}:${eps[epNum - 1].id}`;
            else return { streams: [] };
        } catch(e) { return { streams: [] }; }
    }

    const p = iId.split(':');
    if (p.length < 2) return { streams: [] };
    const epid = p[1];
    const streams = [];
    
    for (const q of ['1080p', '720p', '480p']) {
        try {
            const url = `${API_MAIN}/${EP_STREAM_A}/${epid}/${EP_STREAM_B}/${q}?playerType=internal`;
            const res = await axios.get(url, { headers: getHeaders() });
            const l = res.data?.streamingLinkCDN || res.data?.streamingLink;
            if (l) streams.push({ name: 'Anime BR', title: `${q}`, url: l });
        } catch (e) {}
    }
    return { streams };
});

async function start() {
    loadCaches();
    if (db.items.size === 0) bgTask();
    serveHTTP(builder.getInterface(), { port: PORT_ADDON });
    console.log(`Addon Black Ops running.`);
    setInterval(bgTask, 6*60*60*1000);
}
start();
