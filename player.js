window.addEventListener('message', (event) => {
    if (event.data.action === 'INIT_PLAYER') {
        const { token, streamData } = event.data;

        // 1. Função infalível para vasculhar o JSON e encontrar a URL do manifesto DASH (.mpd)
        function findDashManifest(obj) {
            if (typeof obj === 'string' && obj.includes('.mpd')) return obj;
            if (typeof obj === 'object' && obj!== null) {
                for (let key in obj) {
                    const result = findDashManifest(obj[key]);
                    if (result) return result;
                }
            }
            return null;
        }

        const dashUrl = findDashManifest(streamData);

        if (!dashUrl) {
            console.error("Erro Crítico: Link DASH (.mpd) não encontrado no retorno da API.", streamData);
            return;
        }

        // 2. Extração de legendas (Softsubs) do JSON
        let subtitleTracks =;
        try {
            const subs = streamData.data.subtitles |

| streamData.data?.subtitles;
            if (subs) {
                for (let key in subs) {
                    subtitleTracks.push({
                        file: subs[key].url,
                        label: subs[key].locale |

| key,
                        kind: "captions"
                    });
                }
            }
        } catch(e) { 
            console.log("Aviso: Nenhuma legenda externa encontrada ou falha ao processar.", e); 
        }

        // 3. Inicialização e Mapeamento de Qualidade do JWPlayer 8+
        jwplayer("player_div").setup({
            playlist: [{
                sources: [{
                    file: dashUrl, // O arquivo único que contém todas as resoluções 
                    type: "application/dash+xml",
                    drm: {
                        widevine: {
                            url: "https://www.crunchyroll.com/license/v1/license/widevine",
                            headers:
                        }
                    }
                }],
                tracks: subtitleTracks
            }],
            // Mapeia a taxa de dados bruta da Crunchyroll para os nomes de resolução no menu da engrenagem
            qualityLabels: {
                "8000": "1080p",
                "6000": "1080p",
                "5000": "1080p",
                "4000": "720p",
                "2800": "720p",
                "1500": "480p",
                "1000": "360p",
                "500": "240p"
            },
            playbackRateControls: [0.75, 1, 1.25, 1.5, 2], // Velocidade do vídeo
            autostart: true,
            width: "100%",
            height: "100%"
        });
    }
});
