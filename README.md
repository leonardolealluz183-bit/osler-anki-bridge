# Osler Anki Exporter

Userscript Android-first para exportar em lote os flashcards do modo **Consulta** da Osler para o AnkiDroid.

## Versão 1.1.0 — Consulta

O fluxo de captura durante a revisão foi abandonado. A versão atual não intercepta **Errei**, **Difícil**, teclado, avanço de card ou sessões persistentes.

A 1.1.0:

- é carregada na tela de Flashcards e acompanha a navegação interna até a **Consulta**, sem exigir recarregar `/consult`;
- reconhece os contêineres genéricos da Consulta pela borda laranja e pela estrutura interna;
- aciona **Carregar mais** até encerrar a paginação;
- reconhece as respostas das lacunas pelo destaque laranja;
- transforma cada lacuna agrupada pela Consulta em um card individual do Anki;
- lê também cards comuns de pergunta e resposta;
- preserva contexto, explicação e assunto original;
- remove referências bibliográficas finais de forma conservadora;
- deduplica pelo conteúdo;
- exporta tudo para um único baralho escolhido pelo usuário;
- oferece link de download, download via Violentmonkey, cópia, conteúdo bruto e diagnóstico.

A Consulta pode exibir menos blocos do que o total original porque agrupa várias lacunas do mesmo flashcard. O diagnóstico informa separadamente **blocos da Consulta** e **cards gerados para o Anki**.

## Instalação

Instale apenas `docs/osler-anki-consult.user.js` e mantenha ativo somente **Osler Anki Exporter — Consulta 1.1.0**.

Desative os scripts antigos:

- `Osler Anki Bridge`;
- `Osler Anki Bridge — Sessões`;
- `Osler Capture Diagnostics`;
- `Osler Anki Bridge — Correção de perguntas`.

## Fluxo

1. Abra normalmente a tela **Flashcards** da Osler.
2. Selecione o tema, escolha o modo **Consulta** e inicie pelos botões da própria Osler.
3. Não recarregue a rota `/consult`; a Osler depende do estado criado pela navegação interna.
4. No painel **Osler → Anki · Consulta**, informe o nome do baralho.
5. Toque em **Carregar tudo e gerar TSV**.
6. Confira o total de blocos, cards gerados e erros no diagnóstico.
7. Baixe o TSV e importe-o no AnkiDroid.

## Validação

Além dos testes unitários, a extração foi validada em navegador headless com uma página de Consulta sintética contendo:

- um card com três lacunas laranjas agrupadas, convertido em três cards distintos;
- um card comum de pergunta e resposta;
- breadcrumb de tema;
- explicação e referência bibliográfica.

O cenário produziu quatro cards válidos a partir de dois blocos, sem erros.

O arquivo canônico e instalável é `docs/osler-anki-consult.user.js`. A cópia antiga em `userscript/` foi removida para não manter duas versões divergentes.

## Desenvolvimento

```bash
npm test
npm run lint
```
