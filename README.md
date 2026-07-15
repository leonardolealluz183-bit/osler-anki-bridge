# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, mantém uma fila persistente e exporta tudo de uma vez para importação no AnkiDroid.

## Versão 0.4.2 — Fase 2

Correções principais:

- captura perguntas e respostas que ficam em contêineres diferentes na página;
- escolhe a pergunta temática correta em vez de confundir um parágrafo-resposta em negrito com a pergunta;
- mantém um snapshot recente do card revelado para resistir à troca imediata de tela;
- reforça a detecção de Errei e Difícil com listeners delegados, listeners diretos, `MutationObserver` e varredura periódica;
- adiciona **Adicionar card atual** como fallback manual de segurança;
- preserva a fila em `localStorage` e exporta TSV para o AnkiDroid;
- remove highlights de calibração e tokens temporários.

O card real usado para validar esta correção foi:

- pergunta: `Angioedema. Em linhas gerais, qual a fisiopatologia?`
- resposta: `Perda da integridade vascular.`

## Fluxo

1. Estude normalmente na Osler.
2. Errei e Difícil adicionam o card à fila.
3. Acertei é ignorado.
4. O botão **Adicionar card atual** serve apenas quando o contador não aumenta após uma avaliação.
5. Baixe o TSV ao final da sessão e confira antes de importar no AnkiDroid.

## Desenvolvimento

```bash
npm test
npm run lint
```
