# Osler Anki Exporter

Userscript Android-first para exportar em lote os flashcards do modo **Consulta** da Osler para o AnkiDroid.

## Versão 1.2.0 — Consulta

O fluxo antigo de captura durante a revisão foi abandonado. A versão atual não intercepta **Errei**, **Difícil**, teclado, avanço de card ou sessões persistentes.

A 1.2.0:

- é carregada antes da navegação interna e aparece automaticamente ao entrar na **Consulta**;
- reconhece os blocos tanto pela moldura laranja quanto pelo botão de opções de cada card;
- aciona **Carregar mais** até encerrar a paginação;
- lê o indicador `Mostrando X de Y` da própria Osler;
- transforma cada lacuna laranja em um card individual do Anki;
- lê também respostas laranjas separadas e cards comuns de pergunta e resposta;
- preserva contexto, explicação e assunto original;
- remove referências bibliográficas finais de forma conservadora;
- deduplica pelo conteúdo;
- exporta tudo para um único baralho escolhido pelo usuário;
- bloqueia o download quando a quantidade de cards gerados não coincide com a quantidade exibida pela Osler.

A Consulta pode agrupar vários flashcards originais dentro de um único bloco visual. Por isso, a validação usa o número de **cards gerados**, e não exige um bloco DOM para cada flashcard.

## Instalação

Instale apenas `docs/osler-anki-consult.user.js` e mantenha ativo somente **Osler Anki Exporter — Consulta 1.2.0**.

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
6. O download só será liberado quando o total gerado coincidir com `Mostrando X de Y`.
7. Baixe o TSV e importe-o no AnkiDroid.

## Validação

A extração foi validada em Chromium headless nos seguintes cenários:

- 41 contêineres visuais, produzindo 41 cards;
- um bloco agrupado com três lacunas, produzindo três cards, mais um bloco pergunta-resposta, totalizando quatro cards a partir de dois blocos;
- bloqueio de exportação quando o total gerado é inferior ao indicador da Osler.

A suíte completa e a verificação de sintaxe passam no GitHub Actions.

## Desenvolvimento

```bash
npm test
npm run lint
```
