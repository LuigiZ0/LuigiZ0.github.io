window.addEventListener('message', (event) => {
    if (event.data.action === 'INIT_PLAYER') {
        const { token, streamData } = event.data;

        // 1. Função infalível para vasculhar o JSON e encontrar a URL do DASH (.mpd)
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

        // Se a API da Crunchyroll não devolver o vídeo, avisa na tela
        if (!dashUrl) {
            const loadingText = document.getElementById("loading-text");
            if (loadingText) loadingText.innerHTML = "Erro Crítico: Link de vídeo não encontrado no servidor da Crunchyroll.";
            console.error("Manifesto DASH ausente: ", streamData);
            return;
        }

        // 2. A CORREÇÃO: Esconde a tela de loading infinita do HTML original
        const loadingContainer = document.querySelector(".loading_container");
        if (loadingContainer) {
            loadingContainer.style.display = "none";
        }

        // 3. Extração de legendas (Softsubs)
        let subtitleTracks =;
        try {
            // Vascula pelas legendas no objeto da API V3
            const subs = streamData.data?.subtitles |

| streamData.subtitles;
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
            console.log("Aviso: Nenhuma legenda processada.", e); 
        }

        // 4. Inicializa o JWPlayer e entrega a chave de Autenticação Premium
        jwplayer("player_div").setup({
            playlist:
                        }
                    }
                }],
                tracks: subtitleTracks
            }],
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
            playbackRateControls: [0.75, 1, 1.25, 1.5, 2],
            autostart: true,
            width: "100%",
            height: "100%"
        });
    }
});
