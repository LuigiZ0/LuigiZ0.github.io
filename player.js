window.addEventListener('message', function(event) {
    if (event.data.action!== 'INIT_PLAYER') return;

    var token = event.data.token;
    var streamData = event.data.streamData;

    // 1. Função para encontrar o manifesto de vídeo
    function findDash(obj) {
        if (typeof obj === 'string' && obj.indexOf('.mpd') > -1) return obj;
        if (typeof obj === 'object' && obj!== null) {
            for (var key in obj) {
                var res = findDash(obj[key]);
                if (res) return res;
            }
        }
        return null;
    }

    var dashUrl = findDash(streamData);

    if (!dashUrl) {
        var loadingText = document.getElementById("loading-text");
        if (loadingText) loadingText.innerHTML = "Erro: Link de vídeo protegido não encontrado.";
        console.error("Falha ao encontrar vídeo no JSON:", streamData);
        return;
    }

    // 2. Remove a tela de loading
    var loadingContainer = document.querySelector(".loading_container");
    if (loadingContainer) {
        loadingContainer.style.display = "none";
    }

    // 3. Organiza as legendas dinamicamente
    var subtitleTracks = new Array();
    try {
        var subs = null;
        if (streamData.data && streamData.data.subtitles) {
            subs = streamData.data.subtitles;
        } else if (streamData.subtitles) {
            subs = streamData.subtitles;
        }

        if (subs) {
            for (var key in subs) {
                var subUrl = subs[key].url;
                var subLabel = subs[key].locale;
                if (!subLabel) subLabel = key;

                subtitleTracks.push({
                    "file": subUrl,
                    "label": subLabel,
                    "kind": "captions"
                });
            }
        }
    } catch(e) {
        console.log("Nenhuma legenda externa processada.", e);
    }

    // 4. Configura as chaves do JWPlayer (Sem aninhamento para evitar erros)
    var authHeader = {
        "name": "Authorization",
        "value": "Bearer " + token
    };

    var widevineConfig = {
        "url": "https://www.crunchyroll.com/license/v1/license/widevine",
        "headers": new Array(authHeader)
    };

    var drmConfig = {
        "widevine": widevineConfig
    };

    var videoSource = {
        "file": dashUrl,
        "type": "application/dash+xml",
        "drm": drmConfig
    };

    var mediaItem = {
        "sources": new Array(videoSource),
        "tracks": subtitleTracks
    };

    var playlistData = new Array(mediaItem);

    var qualityMap = {
        "8000": "1080p",
        "6000": "1080p",
        "5000": "1080p",
        "4000": "720p",
        "2800": "720p",
        "1500": "480p",
        "1000": "360p",
        "500": "240p"
    };

    // 5. Inicia o reprodutor com a licença do Widevine
    jwplayer("player_div").setup({
        "playlist": playlistData,
        "qualityLabels": qualityMap,
        "playbackRateControls": new Array(0.75, 1, 1.25, 1.5, 2),
        "autostart": true,
        "width": "100%",
        "height": "100%"
    });
});
