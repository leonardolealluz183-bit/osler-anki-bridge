# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, mantém uma fila persistente e exporta tudo de uma vez para importação no AnkiDroid.

## Versão 0.4.5 — Fase 2

Correções principais:

- mantém os atalhos: **Espaço** mostra a resposta pela Osler, **1** captura Errei e **2** captura Difícil;
- distingue cards com o mesmo enunciado e respostas ocultas diferentes;
- mostra cada tentativa como adicionada, duplicada ou falhou e mantém log persistente;
- desliga completamente captura, varredura de DOM e `MutationObserver` na tela pesada `/test/report`;
- acompanha mudanças de rota da aplicação e ativa a captura somente em `/test`;
- mantém o painel em modo leve no relatório para exportar TSV e log sem travar a página;
- troca `File` por `Blob` no download e mantém a URL do arquivo por 60 segundos, reduzindo falhas de download no Firefox Android;
- preserva a fila existente em `localStorage` durante a atualização.

O problema que motivou a 0.4.5 ocorreu no relatório final de uma sessão com 203 cards: a varredura do script continuava ativa sobre uma página muito grande, tornando os botões da Osler e o download praticamente irresponsivos.

## Fluxo

1. Durante o teste, pressione **Espaço**, depois **1** ou **2**.
2. No relatório final, o painel muda para **Modo leve de exportação**.
3. Clique em **Baixar TSV**; a fila permanece salva mesmo antes do download.
4. **Baixar log** exporta o histórico de tentativas para diagnóstico.
5. Confira o TSV antes de importar no AnkiDroid.

## Desenvolvimento

```bash
npm test
npm run lint
```
