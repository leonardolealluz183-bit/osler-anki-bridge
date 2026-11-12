# Osler Anki Exporter — teste Android

A versão atual exporta em lote os flashcards do modo **Consulta** para um arquivo TSV importável no AnkiDroid. Ela não captura mais os cliques em **Errei**, **Difícil** ou **Acertei** e não instala um aplicativo Android.

## Preparação

1. No Firefox Android, instale e habilite o Violentmonkey.
2. Instale somente `docs/osler-anki-consult.user.js`.
3. Desative `Osler Anki Bridge`, `Osler Anki Bridge — Sessões`, `Osler Capture Diagnostics` e `Osler Anki Bridge — Correção de perguntas`.

## Fluxo de teste

1. Entre na Osler e abra a tela **Flashcards**.
2. Escolha um tema e abra o modo **Consulta** pela navegação normal da Osler; não recarregue diretamente a rota `/consult`.
3. No painel **Osler → Anki · Consulta 1.2.2**, informe o nome do baralho.
4. Toque em **Carregar tudo e gerar TSV**.
5. Confirme que o indicador da Osler chegou a `X de X` e que o painel preparou exatamente `X` cards.
6. Baixe o TSV e importe-o no AnkiDroid como arquivo separado por tabulação, com HTML habilitado.
7. Verifique perguntas, respostas, explicações, lacunas, listas, tabelas, imagens, tags, baralho e duplicatas.

## Se a exportação for bloqueada

1. Abra **Diagnóstico** no painel.
2. Toque em **Copiar diagnóstico**.
3. Registre também o tema, o texto `Mostrando X de Y`, a versão do Firefox e a versão do Violentmonkey.
4. Não envie URLs completas que contenham credenciais, tokens ou dados pessoais.

O teste só estará concluído depois de importar o TSV no AnkiDroid e comparar a quantidade e o conteúdo dos cards com a Consulta original.
