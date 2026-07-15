# Osler Anki Bridge — Fase 1 Android-only

A Fase 1 é um userscript de captura e diagnóstico para uso em navegador Android com gerenciador de userscripts. Ela não envia dados para a internet, não chama Android Intent, não integra com AnkiDroid e não inclui aplicativo Android nativo.

## Fluxo da Fase 1

1. Abra a página simulada ou uma página Osler real no navegador com o userscript instalado.
2. Use o painel **Osler Capture Diagnostics — Fase 1** para calibrar visualmente os elementos de pergunta, resposta, explicação, assunto/deck, botão **Errei** e botão **Difícil**.
3. Ao tocar em **Errei** ou **Difícil**, o userscript captura o card antes do avanço da página.
4. **Acertei** não captura por padrão.
5. Revise o painel JSON e use **Copiar JSON** ou **Copiar logs** para exportar localmente o diagnóstico.

## Segurança e limitações

- O HTML capturado é sanitizado para remover scripts e atributos perigosos.
- Capturas duplicadas são ignoradas usando um identificador estável do conteúdo do card.
- Nenhum dado é transmitido pela internet.
- Fase 2, backend, sincronização, AnkiDroid e aplicativo Android permanecem fora do escopo.
