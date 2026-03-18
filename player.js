window.addEventListener('message', (event) => {
    if (event.data.action === 'INIT_PLAYER') {
        const { token, streamData } = event.data;

        // O streamData da Crunchyroll tem muitas camadas.
        // Aqui extraímos algoritimamente a URL do arquivo DASH principal (.mpd)
        let dashUrl = "";
        try {
            // Em uma implementação real, você mapeará o JSON conforme sua preferência visual de hardsubs/softsubs
            // Para a stream bruta mais alta frequentemente encontrada no array principal:
            const streamsObj = streamData.data |

| streamData.data;
            // Pegue a primeira stream formatada para adaptive_dash
            const streamKeys = Object.keys(streamsObj.adaptive_dash);
            dashUrl = streamsObj.adaptive_dash[streamKeys].url;
        } catch(e) {
            console.error("Falha ao localizar URL do manifesto de mídia.", e);
        }

        // Lógica de DRM Widevine exigida pelo JWPlayer 8+ [2, 5, 6]
        jwplayer("player_div").setup({
            playlist:
                        }
                    }
                }]
            }],
            autostart: true,
            width: "100%",
            height: "100%"
        });
    }
});
