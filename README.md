# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, mantém uma fila persistente e exporta tudo de uma vez para importação no AnkiDroid.

## Versão 0.4.4 — Fase 2

Correções principais:

- adiciona atalhos de teclado: **Espaço** continua mostrando a resposta pela Osler, **1** captura Errei e **2** captura Difícil;
- distingue cards com o mesmo enunciado e respostas ocultas diferentes dentro de listas;
- inclui no identificador a posição da lacuna e a resposta revelada, evitando falsas duplicatas;
- prioriza somente a pergunta realmente visível na tela e não reutiliza snapshot antigo de outro card;
- mostra o resultado de cada tentativa com a pergunta correspondente: adicionado, duplicado ou falhou;
- mantém um log persistente de até 300 eventos e permite baixar o diagnóstico em JSON;
- continua capturando cards sem bloco de explicação e respostas em lista;
- preserva a fila em `localStorage`, remove tokens temporários e exporta TSV para o AnkiDroid.

O formato real que motivou a 0.4.4 foi uma sequência de cards com o mesmo enunciado sobre aferição da pressão arterial, mas com uma resposta oculta diferente em cada item da lista. Na 0.4.3, esses cards podiam receber o mesmo ID e aparecer incorretamente como duplicados.

## Fluxo

1. Pressione **Espaço** para mostrar a resposta.
2. Pressione **1** para Errei ou **2** para Difícil.
3. O painel informa exatamente qual pergunta foi adicionada, considerada duplicada ou rejeitada.
4. Acertei continua ignorado.
5. **Adicionar card atual** permanece como fallback manual.
6. **Baixar log** exporta o histórico de tentativas para diagnóstico.
7. Baixe o TSV ao final da sessão e confira antes de importar no AnkiDroid.

## Desenvolvimento

```bash
npm test
npm run lint
```
