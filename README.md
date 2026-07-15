# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, mantém uma fila persistente e exporta tudo de uma vez para importação no AnkiDroid.

## Versão 0.4.3 — Fase 2

Correções principais:

- captura cards mesmo quando não existe `div.osler-card-explanation`;
- reconhece respostas em lista diretamente no corpo do card;
- ignora a citação bibliográfica ao montar a resposta;
- continua escolhendo a pergunta temática correta em vez de um parágrafo-resposta em negrito;
- mantém snapshot recente do card revelado para resistir à troca imediata de tela;
- reforça Errei e Difícil com listeners delegados, listeners diretos, `MutationObserver` e varredura periódica;
- mantém **Adicionar card atual** como fallback manual;
- preserva a fila em `localStorage` e exporta TSV para o AnkiDroid;
- remove highlights de calibração e tokens temporários.

O formato real que motivou a 0.4.3 foi:

- pergunta: `Obstrução Intestinal. Quanto à etiologia, é classificada como:`
- resposta em lista: `Mecânica, ou` / `Funcional.`
- sem bloco normal de explicação, apenas citação do UpToDate.

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
