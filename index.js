// ==============================================================================
// ==  ADDON ANIME - v62.0 (PROXY FIX + DOTENV FIX)                      ==
// == - CORREÇÃO: Suporte a Proxy adicionado para burlar Erro 403 do Koyeb.    ==
// == - CORREÇÃO: Dotenv carregado com segurança.                              ==
// ==============================================================================

try { require('dotenv').config(); } catch (e) {} // Carrega .env se existir (Local), ignora se não (Koyeb)

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');

// --- 1. CONFIGURAÇÃO ---
const PORT_ADDON = process.env.PORT || 7002;

// Credenciais
const ENV_TOKEN = process.env.AUTH_TOKEN;
const ENV_COOKIE = process.env.AUTH_COOKIE;

// APIs
const API_MAIN = process.env.API_HOST_MAIN;     
const API_VISUAL = process.env.API_HOST_VISUAL; 
const API_META = process.env.API_HOST_META || 'https://v3-cinemeta.strem.io';
const API_ALT = process.env.API_HOST_ALT || 'https://kitsu.io/api/edge';

// Configuração de Proxy (PARA BURLAR 403 NO KOYEB)
const PROXY_HOST = process.env.PROXY_HOST; // IP do Proxy
const PROXY_PORT = process.env.PROXY_PORT; // Porta do Proxy
let axiosProxyConfig = null;

if (PROXY_HOST && PROXY_PORT) {
    console.log(`[INIT] 🛡️ Proxy Ativado: ${PROXY_HOST}:${PROXY_PORT}`);
    // Configura o agente de proxy para o Axios
    const proxyUrl = `http://${PROXY_HOST}:${PROXY_PORT}`;
    const httpsAgent = new HttpsProxyAgent(proxyUrl);
    axiosProxyConfig = { httpsAgent, proxy: false }; // proxy: false força o uso do agent
}

const DB_REFRESH_INTERVAL = 6 * 60 * 60 * 1000;
const SEARCH_AZ_INTERVAL = 24 * 60 * 60 * 1000;

// Validação Básica
if (!ENV_TOKEN || !ENV_COOKIE || !API_MAIN || !API_VISUAL) {
    console.error("❌ ERRO: Variáveis de ambiente obrigatórias não configuradas.");
    // Não damos exit para não crashar o container em loop, mas vai dar erro nas requisições
}

// --- 2. CACHE ---
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
            db.lastBuild = d.lastBuild || 0; db.lastSearch = d.lastSearch || 0;
        }
        if (fs.existsSync(CACHE_VIS)) visCache = new Map(JSON.parse(fs.readFileSync(CACHE_VIS)));
        if (fs.existsSync(CACHE_MAP)) mapCache = new Map(JSON.parse(fs.readFileSync(CACHE_MAP)));
        console.log(`[INIT] Cache: ${db.items.size} itens | ${mapCache.size} links.`);
    } catch (e) {}
}

function saveCaches() {
    try {
        const d = { items: [...db.items], groups: [...db.groups], lastBuild: db.lastBuild, lastSearch: db.lastSearch };
        fs.writeFileSync(CACHE_DB, JSON.stringify(d));
        fs.writeFileSync(CACHE_VIS, JSON.stringify([...visCache]));
        fs.writeFileSync(CACHE_MAP, JSON.stringify([...mapCache]));
    } catch (e) {}
}

// --- 3. NETWORK ---
const getSafeToken = () => {
    let t = (ENV_TOKEN || '').trim().replace(/^["']|["']$/g, '');
    return t.toLowerCase().startsWith('bearer ') ? t : `Bearer ${t}`;
};
const getSafeCookie = () => (ENV_COOKIE || '').trim().replace(/^["']|["']$/g, '');

const getHeaders = (config) => {
    const h = {
        'Authorization': config?.userToken || getSafeToken(),
        'User-Agent': process.env.HEADER_UA_VAL || 'okhttp/5.0.0-SNAPSHOT',
        'Cookie': getSafeCookie()
    };
    if (process.env.HEADER_APP_KEY) h[process.env.HEADER_APP_KEY] = process.env.HEADER_APP_VAL;
    return h;
};

const delay = ms => new Promise(r => setTimeout(r, ms));

// Fetch com Retry e Suporte a Proxy
const req = async (url, opts = {}, retries = 2) => {
    // Mescla as opções do axios com a configuração do proxy
    const finalOpts = { ...opts, ...axiosProxyConfig, timeout: 10000 };
    
    try { 
        await delay(300); 
        return await axios.get(url, finalOpts); 
    } catch (e) { 
        if (retries > 0) return req(url, opts, retries - 1); 
        throw e; 
    }
};

// --- 4. PARSERS ---
function sanitize(t) { return t ? t.replace(/\s*[-–(]?\s*(Dublado|Legendado|Dub|Leg)\s*[)]?$/gi, '').replace(/\s*[-–]\s*$/, '').trim() : ""; }
function slug(s) { return s ? s.toLowerCase().replace(/[^a-z0-9]/g, '') : ""; }
const isMov = (t) => t ? (t.toLowerCase().includes('movie') || t.toLowerCase().includes('filme') || t.toLowerCase().includes('ova')) : false;

function parse(t) {
    const c = sanitize(t).toLowerCase();
    const m1 = c.match(/(.*?)\s*(?:season|temporada|s)\s*(\d+)/);
    if (m1) return { base: m1[1].trim(), seq: parseInt(m1[2]), orig: t };
    const m2 = c.match(/(.*?)\s+(\d+)$/);
    if (m2 && parseInt(m2[2]) < 1900) return { base: m2[1].trim(), seq: parseInt(m2[2]), orig: t };
    return { base: c, seq: 1, orig: t };
}

// --- 5. UPDATE DB ---
function upDB(list) {
    if (!Array.isArray(list)) return;
    list.forEach(i => {
        const id = `ba-${i.id || i.posts_id}`;
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
            grp.e.sort((a, b) => (a.seq - b.seq));
        }
    });
}

// --- 6. TASKS ---
async function runBuild() {
    if (db.busy) return;
    db.busy = true;
    console.log('[DB] Atualizando...');
    try {
        const eps = [process.env.PATH_LIST_POP, process.env.PATH_LIST_NEW];
        for (const ep of eps) {
            if (!ep) continue;
            const res = await req(`${API_MAIN}/${ep}`, { headers: getHeaders() });
            upDB(res.data.data || res.data);
        }
        db.lastBuild = Date.now();
        saveCaches();
    } catch (e) { console.error(`[DB ERRO] ${e.message}`); } finally { db.busy = false; }
}

async function runSearch() {
    if (db.busy) return;
    db.busy = true;
    console.log('[A-Z] Indexando...');
    const abc = 'abcdefghijklmnopqrstuvwxyz'.split('');
    try {
        for (const l of abc) {
            try {
                const res = await req(`${API_MAIN}/${process.env.PATH_SEARCH}?name=${l}`, { headers: getHeaders() });
                upDB(res.data.data || res.data);
                await delay(1500);
            } catch(e) {}
        }
        db.lastSearch = Date.now();
        saveCaches();
        console.log('[A-Z] Concluído.');
    } catch (e) {} finally { db.busy = false; }
}

// --- 7. VISUAL BRIDGE ---
async function getVis(raw, movie, fetchDesc = false) {
    const p = parse(raw);
    const k = `${slug(p.base)}|${movie?'m':'t'}`;
    if (visCache.has(k)) {
        const c = visCache.get(k);
        if (!fetchDesc || (fetchDesc && c.desc)) return c;
    }
    if (visCache.has(`F:${k}`)) return null;

    try {
        // HiAnime geralmente não bloqueia Koyeb, tentamos sem proxy primeiro para ser rápido
        // Se falhar, o axios usa o proxy global se configurado, ou podemos forçar sem
        const { data } = await axios.get(`${API_VISUAL}/search?keyword=${encodeURIComponent(p.base)}&page=1`, { timeout: 3000 });
        if (!data?.data?.response) { visCache.set(`F:${k}`, true); return null; }

        const res = data.data.response.filter(r => (movie ? r.type === 'Movie' : r.type !== 'Movie'));
        if (res.length === 0) return null;

        const s = slug(p.base);
        let m = res.find(r => slug(r.title) === s || (r.alternativeTitle && slug(r.alternativeTitle) === s));
        
        if (!m) {
            const cands = res.filter(r => slug(r.title).includes(s) || (r.alternativeTitle && slug(r.alternativeTitle).includes(s)));
            if (cands.length > 0) { cands.sort((a, b) => a.title.length - b.title.length); m = cands[0]; }
        }

        if (m) {
            let desc = null;
            if (fetchDesc) {
                try {
                    const dRes = await axios.get(`${API_VISUAL}/anime/${m.id}`, { timeout: 3000 });
                    desc = dRes.data?.data?.anime?.info?.description || dRes.data?.data?.synopsis;
                } catch (e) {}
            }
            const val = { poster: m.poster, title: m.title, id: m.id, desc: desc };
            visCache.set(k, val);
            saveCaches();
            return val;
        }
        visCache.set(`F:${k}`, true);
    } catch (e) {}
    return null;
}

// --- 8. RESOLVER ---
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
            if (r.en_jp) names.push(r.en_jp); if (r.en) names.push(r.en); if (r.ja_jp) names.push(r.ja_jp);
        }

        for (const n of names) {
            if (!n) continue;
            const cn = sanitize(n);
            const res = await req(`${API_MAIN}/${process.env.PATH_SEARCH}?name=${encodeURIComponent(cn)}`, { headers: getHeaders() });
            const d = res.data.data || res.data;

            if (d && d.length > 0) {
                const ts = slug(cn);
                const valid = d.filter(r => {
                    const t = slug(r.titulo || r.postTitle);
                    return t.includes(ts) || ts.includes(t);
                });
                const best = valid.length > 0 ? valid[0] : d[0];
                const iId = `ba-${best.id || best.posts_id}`;
                
                mapCache.set(extId, iId);
                saveCaches();
                upDB([best]);
                return iId;
            }
        }
    } catch (e) {}
    return null;
}

// --- 9. MANIFESTO ---
const catalogs = [
    { type: 'series', id: 'cat_pop', name: 'Populares' },
    { type: 'series', id: 'cat_new', name: 'Lançamentos' },
    { type: 'series', id: 'cat_fav', name: 'Favoritos' },
    { type: 'series', id: 'cat_search', name: 'Buscar Animes...', extra: [{ name: 'search', isRequired: true }] }
];

const builder = new addonBuilder({
    id: 'anime.stremio.v62', 
    version: '62.0.0', 
    name: 'Anime (Proxy)',
    resources: ['catalog', 'meta', 'stream'], 
    types: ['series', 'movie'], 
    catalogs, 
    idPrefixes: ['ba-', 'tt', 'kitsu'],
    behaviorHints: { configurable: true, cacheMaxAge: 3600 },
    config: [
        { key: "userToken", type: "text", title: "Token" },
        { key: "descLang", type: "select", title: "Idioma", options: ["PT-BR", "Inglês"], default: "PT-BR" }
    ]
});

// --- 10. HANDLERS ---
builder.defineCatalogHandler(async ({ id, extra, config }) => {
    const headers = getHeaders(config);
    let items = [];

    try {
        let ep = '';
        if (extra?.search) ep = `${process.env.PATH_SEARCH}?name=${encodeURIComponent(extra.search)}`;
        else if (id === 'cat_pop') ep = process.env.PATH_LIST_POP;
        else if (id === 'cat_new') ep = process.env.PATH_LIST_NEW;
        else if (id === 'cat_fav') ep = process.env.PATH_LIST_FAV;

        if (ep) {
            const res = await req(`${API_MAIN}/${ep}`, { headers });
            items = res.data.data || res.data;
            if (id === 'cat_fav' && !Array.isArray(items)) items = Object.values(items);
            if (items) upDB(items);
        }
    } catch(e) {
        if (e.response && (e.response.status === 403 || e.response.status === 401)) {
            return { metas: [{ 
                id: 'err', type: 'series', name: `ERRO ${e.response.status}`, 
                description: `Bloqueio de API ou Token Inválido. Configure o Proxy no Koyeb.`,
                poster: 'https://placehold.co/400x600/red/white.png?text=BLOCK'
            }]};
        }
    }

    if (!items || items.length === 0) return { metas: [] };

    const metas = [];
    const BATCH = 4;
    const T_OUT = 9000;
    const t0 = Date.now();

    for (let i = 0; i < items.length; i += BATCH) {
        const b = items.slice(i, i + BATCH);
        if (Date.now() - t0 > T_OUT) {
            metas.push(...b.map(x => ({
                id: `ba-${x.id || x.posts_id}`, type: 'series', name: x.titulo || x.postTitle, 
                poster: x.cover_url || x.thumbnail, posterShape: id === 'cat_new' ? 'landscape' : 'poster'
            })));
            continue;
        }
        const rich = await Promise.all(b.map(async (x) => {
            const rt = x.name || x.titulo || x.postTitle;
            const im = isMov(rt);
            const v = await getVis(rt, im, false); 
            return {
                id: `ba-${x.id || x.posts_id}`, type: im ? 'movie' : 'series', name: rt,
                poster: v ? v.poster : (x.poster || x.cover_url || x.thumbnail),
                posterShape: (id === 'cat_new' && !v) ? 'landscape' : 'poster',
                description: v ? `HD` : ''
            };
        }));
        metas.push(...rich);
        await delay(200);
    }
    return { metas };
});

builder.defineMetaHandler(async ({ id, config }) => {
    let iId = id;
    if (id.startsWith('tt') || id.startsWith('kitsu')) {
        const r = await resolveExt(id);
        if (r) iId = r; else return { meta: null };
    }

    const pid = iId.replace('ba-', '');
    const headers = getHeaders(config);

    try {
        const det = (await req(`${API_MAIN}/${process.env.PATH_DETAIL}/${pid}`, { headers })).data;
        const rt = det.titulo;
        const im = isMov(rt);
        const p = parse(rt);
        const eng = config?.descLang === "Inglês";
        const v = await getVis(rt, im, eng);

        let desc = det.descricao; 
        if (eng && v && v.desc) desc = v.desc;

        const meta = {
            id: id, type: im ? 'movie' : 'series', name: rt,
            poster: v ? v.poster : det.cover_url, background: v ? v.poster : det.cover_url,
            description: desc, genres: det.generos ? det.generos.map(g => g.nome) : [],
            videos: []
        };
        
        if (v) meta.description = `✅ HD\n\n${meta.description}`;

        if (!im) {
            const eps = (await req(`${API_MAIN}/${process.env.PATH_EPISODES}?order=ASC&postID=${pid}`, { headers })).data.data || [];
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

builder.defineStreamHandler(async ({ id, config }) => {
    let iId = id, epNum = 1;
    if (id.startsWith('tt') || id.startsWith('kitsu')) {
        const p = id.split(':');
        let extId = id.startsWith('kitsu') ? `kitsu:${p[1]}` : p[0];
        epNum = parseInt(p[id.startsWith('kitsu') ? 2 : 2]);
        const baId = await resolveExt(extId);
        if (!baId) return { streams: [] };
        const pid = baId.replace('ba-', '');
        try {
            const eps = (await req(`${API_MAIN}/${process.env.PATH_EPISODES}?order=ASC&postID=${pid}`, { headers: getHeaders(config) })).data.data || [];
            const idx = epNum - 1;
            if (eps[idx]) iId = `${baId}:${eps[idx].id}`; else return { streams: [] };
        } catch(e) { return { streams: [] }; }
    }

    const p = iId.split(':');
    if (p.length < 2) return { streams: [] };
    const epid = p[1];
    const streams = [];
    
    for (const q of ['1080p', '720p', '480p']) {
        try {
            const url = `${API_MAIN}/${process.env.PATH_STREAM_A}/${epid}/${process.env.PATH_STREAM_B}/${q}?playerType=internal`;
            const res = await req(url, { headers: getHeaders(config) });
            const l = res.data?.streamingLinkCDN || res.data?.streamingLink;
            if (l) streams.push({ name: 'BR', title: `${q} (Ep ${episodeNum})`, url: l });
        } catch (e) {}
    }
    return { streams };
});

async function start() {
    loadCaches();
    if (db.items.size === 0) runBuild();
    serveHTTP(builder.getInterface(), { port: PORT_ADDON });
    console.log(`Addon running on ${PORT_ADDON}`);
    setInterval(runBuild, DB_REFRESH_INTERVAL);
}
start();
