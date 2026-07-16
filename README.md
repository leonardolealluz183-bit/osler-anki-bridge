# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, mantém uma fila redundante e exporta os cards para o AnkiDroid em baralhos definidos pelo assunto.

## Versão 0.4.10 — Fase 2

A 0.4.10 corrige o painel que bloqueava a seleção e o início dos flashcards na tela da Osler.

Correções principais:

- o painel inicia **minimizado** por padrão;
- a barra superior pode ser arrastada com toque, mouse ou trackpad;
- a posição e o estado minimizado são preservados entre páginas e sessões;
- o botão `+` abre o painel e o botão `−` o minimiza;
- o botão `↗` devolve o painel ao canto superior direito;
- o painel é limitado ao tamanho da tela e não pode ficar perdido fora da área visível;
- preserva a fila redundante da 0.4.9, a recuperação de cards antigos, o avanço confirmado, os downloads e as caixas de recuperação;
- continua usando o assunto de cada card como nome do baralho no AnkiDroid.

## Fluxo

1. O painel aparece como uma barra pequena: `Osler Anki Bridge 0.4.10 · N cards`.
2. Arraste essa barra para qualquer canto livre da tela.
3. Use `+` somente quando precisar consultar contadores, exportar ou recuperar dados.
4. Minimize novamente com `−` antes de iniciar os flashcards.
5. Durante o teste: **Espaço** mostra a resposta, **1** registra Errei e **2** registra Difícil.
6. Ao terminar, abra o painel, prepare a exportação e baixe TSV e log.

## Desenvolvimento

```bash
npm test
npm run lint
```
