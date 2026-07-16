# Osler Anki Exporter

Userscript Android-first para exportar em lote os flashcards já renderizados na tela **Ver todos os flashcards** da Osler para o AnkiDroid.

## Versão 1.0.0 — exportação pela tela `/consult`

A versão 1.0.0 abandona a captura durante a sessão de revisão. Ela não intercepta **Errei**, **Difícil**, teclado, avanço de card ou sessões persistentes.

O novo fluxo usa apenas o conteúdo já aberto pela própria Osler:

- encontra os contêineres individuais dos flashcards;
- aciona **Carregar mais** até não haver novos cards;
- reconhece como resposta das lacunas o texto destacado em laranja;
- substitui a resposta por `[...]` na frente do card;
- preserva resposta, explicação e assunto original no verso e nas tags;
- ignora a referência bibliográfica em itálico no final do card;
- deduplica os cards pelo conteúdo;
- exporta todos para um único baralho com o nome escolhido pelo usuário;
- oferece link de download, `GM_download`, cópia e diagnóstico;
- não grava fila ou sessão: cada exportação corresponde ao conjunto exibido na página.

## Instalação

Instale apenas `docs/osler-anki-consult.user.js`.

Desative os scripts antigos de captura durante a revisão:

- `Osler Anki Bridge 0.4.10`;
- `Osler Anki Bridge — Sessões`;
- a correção separada de pergunta;
- `Osler Anki Bridge 0.5.0`.

Eles não são necessários para o novo fluxo.

## Fluxo

1. Na Osler, abra o tema desejado e escolha **Ver todos os flashcards**.
2. No painel, confira ou edite o nome do baralho.
3. Toque em **Carregar tudo e preparar TSV**.
4. Aguarde o painel informar quantos cards válidos foram encontrados.
5. Baixe o TSV pelo link ou pelo Violentmonkey.
6. Importe o arquivo no AnkiDroid.

## Desenvolvimento

```bash
npm test
npm run lint
```
