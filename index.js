// ==============================================================================
// ==  ADDON ANIME - v60.0 (DIAGNOSTIC EDITION)                          ==
// == - FIX: Opções de configuração (Idioma/Token) restauradas.                ==
// == - DEBUG: Mostra erros VISUAIS no catálogo em vez de tela vazia.          ==
// == - STEALTH: Continua usando variáveis de ambiente.                        ==
// ==============================================================================

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const os = require('os');
const fs = require('fs');
const path = require('path');

// --- 1. CONFIGURAÇÃO & DIAGNÓSTICO ---
const PORT_ADDON = process.env.PORT || 7002;

// Carrega variáveis
const ENV_TOKEN = process.env.AUTH_TOKEN;
const ENV_COOKIE = process.env.AUTH_COOKIE;
const API_MAIN = process.env.API_HOST_MAIN;     
const API_VISUAL = process.env.API_HOST_VISUAL; 

// Fallback para as APIs públicas (apenas se não configurado no env)
const API_META = process.env.API_HOST_META || 'https://v3-cinemeta.strem.io';
const API_ALT = process.env.API_HOST_ALT || 'https://kitsu.io/api/edge';

// Checagem de Variáveis Críticas
const MISSING_VARS = [];
if (!ENV_TOKEN) MISSING_VARS.push('AUTH_TOKEN');
if (!ENV_COOKIE) MISSING_VARS.push('AUTH_COOKIE');
if (!API_MAIN) MISSING_VARS.push('API_HOST_MAIN');
if (!API_VISUAL) MISSING_VARS.push('API_HOST_VISUAL');

if (MISSING_VARS.length > 0) {
    console.error(`❌ ERRO CRÍTICO: Variáveis faltando no Koyeb: ${MISSING_VARS.join(', ')}`);
} else {
    console.log("✅ Todas as variáveis de ambiente foram carregadas.");
}

// --- 2. UTILITÁRIOS ---
function getCacheDir() {
    const dir = path.join(os.tmpdir(), 'addon_cache');
    if (!fs.existsSync(dir)) try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    return dir;
}
const CACHE_DB = path.join(getCacheDir(), 'db.json');
const CACHE_VIS = path.join(getCacheDir(), 'vis.json');
const CACHE_MAP = path.join(getCacheDir(), 'map.json');

let db = { items: new Map(), groups: new Map(), lastBuild: 0, busy: false };
let visCache = new Map(); 
let mapCache = new Map(); 

// Carrega Cache (Tenta persistir dados entre reboots se possível)
try {
    if (fs.existsSync(CACHE_DB)) { const d = JSON.parse(fs.readFileSync(CACHE_DB)); db.items = new Map(d.items); db.groups = new Map(d.groups); }
    if (fs.existsSync(CACHE_VIS)) visCache = new Map(JSON.parse(fs.readFileSync(CACHE_VIS)));
    if (fs.existsSync(CACHE_MAP)) mapCache = new Map(JSON.parse(fs.readFileSync(CACHE_MAP)));
} catch (e) {}

function saveCaches() {
    try {
        fs.writeFileSync(CACHE_DB, JSON.stringify({ items: [...db.items], groups: [...db.groups] }));
        fs.writeFileSync(CACHE_VIS, JSON.stringify([...visCache]));
        fs.writeFileSync(CACHE_MAP, JSON.stringify([...mapCache]));
    } catch (e) {}
}

// --- 3. NETWORK (COM TRATAMENTO DE ERRO) ---
const getSafeToken = () => {
    let t = (ENV_TOKEN || '').trim().replace(/^["']|["']$/g, '');
    return t.toLowerCase().startsWith('bearer ') ? t : `Bearer ${t}`;
};
const getSafeCookie = () => (ENV_COOKIE || '').trim().replace(/^["']|["']$/g, '');

const getHeaders = () => ({
    'Authorization': getSafeToken(),
    'User-Agent': process.env.HEADER_UA_VAL || 'okhttp/5.0.0-SNAPSHOT',
    'Cookie': getSafeCookie(),
    ...(process.env.HEADER_APP_KEY ? { [process.env.HEADER_APP_KEY]: process.env.HEADER_APP_VAL } : {})
});

const delay = ms => new Promise(r => setTimeout(r, ms));

// --- 4. PARSERS ---
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

// --- 5. VISUALS ---
async function getVis(raw, movie) {
    const p = parse(raw);
    const k = `${slug(p.base)}|${movie?'m':'t'}`;
    if (visCache.has(k)) return visCache.get(k);
    
    try {
        const { data } = await axios.get(`${API_VISUAL}/search?keyword=${encodeURIComponent(p.base)}&page=1`, { timeout: 2500 });
        if (!data?.data?.response) return null;
        
        const res = data.data.response.filter(r => (movie ? r.type === 'Movie' : r.type !== 'Movie'));
        const s = slug(p.base);
        let m = res.find(r => slug(r.title) === s || (r.alternativeTitle && slug(r.alternativeTitle) === s));
        if (!m && res.length > 0) {
             // Fallback inteligente
             const cands = res.filter(r => slug(r.title).includes(s));
             if (cands.length > 0) { cands.sort((a,b)=>a.title.length - b.title.length); m = cands[0]; }
        }

        if (m) {
            // Fetch descrição se possível, mas rápido
            const val = { poster: m.poster, title: m.title, id: m.id };
            visCache.set(k, val);
            saveCaches();
            return val;
        }
    } catch (e) {}
    return null;
}

// --- 6. HANDLERS ---
const builder = new addonBuilder({
    id: 'anime.stremio.v60', 
    version: '60.0.0', 
    name: 'Anime (Diagnóstico)',
    description: 'Versão de teste para identificar erros de conexão.',
    resources: ['catalog', 'meta', 'stream'], 
    types: ['series', 'movie'], 
    catalogs: [
        { type: 'series', id: 'cat_pop', name: 'Populares' },
        { type: 'series', id: 'cat_new', name: 'Lançamentos' },
        { type: 'series', id: 'cat_fav', name: 'Favoritos' },
        { type: 'series', id: 'cat_search', name: 'Animes Premium', extra: [{ name: 'search', isRequired: true }] }
    ],
    idPrefixes: ['ba-', 'tt', 'kitsu'],
    // RESTAURADO: Opções de configuração
    config: [
        { key: "userToken", type: "text", title: "Token Pessoal (Opcional)" },
        { key: "descLang", type: "select", title: "Idioma da Descrição", options: ["PT-BR", "Inglês"], default: "PT-BR" }
    ]
});

builder.defineCatalogHandler(async ({ id, extra }) => {
    // 1. Verifica Variáveis Críticas ANTES de tentar
    if (MISSING_VARS.length > 0) {
        return { metas: [{ 
            id: 'error_vars', type: 'series', name: 'ERRO DE CONFIG', 
            description: `Faltam variáveis no Koyeb: ${MISSING_VARS.join(', ')}. Configure e faça Redeploy.`, 
            poster: 'https://placehold.co/400x600/red/white.png?text=ERRO+ENV' 
        }]};
    }

    let endpoint = '';
    let pathName = '';
    if (extra?.search) { endpoint = `${process.env.PATH_SEARCH}?name=${encodeURIComponent(extra.search)}`; pathName='Search'; }
    else if (id === 'cat_pop') { endpoint = process.env.PATH_LIST_POP; pathName='Populares'; }
    else if (id === 'cat_new') { endpoint = process.env.PATH_LIST_NEW; pathName='Lançamentos'; }
    else if (id === 'cat_fav') { endpoint = process.env.PATH_LIST_FAV; pathName='Favoritos'; }

    if (!endpoint) return { metas: [] };

    try {
        console.log(`[CATALOG] Buscando ${pathName}...`);
        const res = await axios.get(`${API_MAIN}/${endpoint}`, { headers: getHeaders(), timeout: 10000 });
        
        let items = res.data.data || res.data;
        if (id === 'cat_fav' && !Array.isArray(items)) items = Object.values(items);
        
        if (!items || items.length === 0) {
            return { metas: [{ 
                id: 'error_empty', type: 'series', name: 'LISTA VAZIA', 
                description: 'A API respondeu 200 OK mas retornou 0 itens. Verifique se o Cookie/Token expirou.', 
                poster: 'https://placehold.co/400x600/orange/white.png?text=VAZIO' 
            }]};
        }

        upDB(items); // Atualiza cache local

        // Retorna itens (com processamento visual básico para ser rápido)
        // Se quiser visual full, teria que fazer o batch, mas vamos focar em ver se funciona
        const metas = await Promise.all(items.slice(0, 10).map(async (i) => {
            const rt = i.titulo || i.postTitle;
            const vis = await getVis(rt, isMov(rt));
            return {
                id: `ba-${i.id || i.posts_id}`,
                type: isMov(rt) ? 'movie' : 'series',
                name: rt,
                poster: vis ? vis.poster : (i.cover_url || i.thumbnail),
                description: vis ? `Linked: ${vis.title}` : ''
            };
        }));
        
        // Completa com o resto sem visual
        if (items.length > 10) {
            metas.push(...items.slice(10).map(i => ({
                id: `ba-${i.id || i.posts_id}`,
                type: 'series',
                name: i.titulo || i.postTitle,
                poster: i.cover_url || i.thumbnail
            })));
        }

        return { metas };

    } catch (e) {
        console.error(`[ERRO API] ${e.message}`);
        const status = e.response ? e.response.status : 'Net';
        return { metas: [{ 
            id: 'error_api', type: 'series', name: `ERRO ${status}`, 
            description: `Falha ao conectar na API (${pathName}).\nMsg: ${e.message}`, 
            poster: `https://placehold.co/400x600/black/white.png?text=ERRO+${status}` 
        }]};
    }
});

// Handler Meta e Stream simplificados para focar no teste do catálogo
builder.defineMetaHandler(async ({ id }) => {
    // ... Lógica padrão (se quiser colo completa, mas o foco é o catálogo aparecer)
    return { meta: { id, type: 'series', name: "Teste Funcional", description: "Se você vê isso, o catálogo abriu." } };
});
builder.defineStreamHandler(async ({ id }) => { return { streams: [] }; });

serveHTTP(builder.getInterface(), { port: PORT_ADDON });
console.log("Addon v60 DIAGNOSTIC online");
