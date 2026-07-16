# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, mantém uma fila persistente e exporta tudo de uma vez para importação no AnkiDroid.

## Versão 0.4.8 — Fase 2

A 0.4.8 mantém o núcleo de captura e avanço confirmado da 0.4.7 e corrige a exportação após a migração para o ambiente isolado do Violentmonkey.

Correções principais:

- usa `GM_download` para baixar TSV e log pelo próprio Violentmonkey;
- mantém download por link da página como contingência;
- adiciona **Abrir TSV**, que abre o arquivo em uma nova aba para salvamento manual pelo Firefox;
- adiciona **Copiar log**, usando `GM_setClipboard`, para diagnóstico mesmo quando downloads estiverem bloqueados;
- mostra permanentemente a última falha, sua pergunta, seu motivo e se houve captura posterior confirmada;
- preserva a fila permanente do Violentmonkey e a migração do armazenamento antigo;
- continua salvando antes de avançar e confirmando que a Osler mudou de card;
- continua evitando duplicatas quando o primeiro avanço falha.

O problema que motivou a 0.4.8 apareceu no primeiro teste real da 0.4.7: a captura e a fila permanente funcionaram, mas os botões antigos de download deixaram de responder porque o script agora executava em um contexto isolado com permissões do userscript.

## Fluxo

1. Pressione **Espaço** para mostrar a resposta.
2. Pressione **1** para Errei ou **2** para Difícil.
3. O painel mostra `SALVO E AVANÇOU` quando a operação termina.
4. A última falha permanece visível no rodapé do painel.
5. Use **Baixar TSV** normalmente.
6. Se o Firefox bloquear o download, use **Abrir TSV** e salve pelo menu da nova aba.
7. Para diagnóstico, use **Baixar log** ou **Copiar log**.

## Desenvolvimento

```bash
npm test
npm run lint
```
