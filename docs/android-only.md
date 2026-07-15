# Osler Anki Bridge — Fase 2 Android-only

A versão 0.4.0 captura cards da Osler, mantém uma fila persistente no navegador e exporta um lote `.tsv` compatível com o importador de texto do AnkiDroid.

## Fluxo

1. Abra uma sessão de flashcards na Osler.
2. Toque em **Mostrar resposta**.
3. **Errei** e **Difícil** adicionam o card à fila.
4. **Acertei** não adiciona nada.
5. Ao terminar, toque em **Enviar ao AnkiDroid**.
6. No compartilhamento do Android, selecione o AnkiDroid.
7. Confira a prévia de importação e conclua.

A fila é salva na chave `oslerAnkiBridge.queue.v1` do `localStorage`. Recarregar ou fechar a aba não apaga os cards. Depois de confirmar a importação no AnkiDroid, volte à Osler e use **Limpar fila**.

## Alternativa quando o compartilhamento de arquivos não funciona

O botão **Enviar ao AnkiDroid** tenta usar `navigator.share()` com um arquivo TSV. Quando o navegador não permite compartilhar arquivos, o userscript baixa o TSV automaticamente. Nesse caso:

1. abra o arquivo `osler-anki-AAAA-MM-DD-HHMM.tsv` no gerenciador de arquivos;
2. escolha **Abrir com** ou **Compartilhar**;
3. selecione o AnkiDroid.

O botão **Baixar TSV** força essa alternativa.

## Estrutura do arquivo

O arquivo começa com cabeçalhos reconhecidos pelo importador moderno do Anki:

```text
#separator:Tab
#html:true
#tags:osler
#columns:Frente    Verso    Tags    Baralho
#tags column:3
#deck column:4
```

Cada linha contém:

- **Frente:** pergunta com `[...]` e um ID invisível;
- **Verso:** resposta, explicação, assunto, ID e link para a Osler;
- **Tags:** `osler` e o assunto normalizado;
- **Baralho:** `Osler`.

A coluna de baralho permite ao importador criar `Osler` quando ele ainda não existe.

## Tipo de nota

A versão 0.4.0 não força um nome de tipo de nota, porque os nomes dos tipos padrão podem variar conforme idioma e coleção. No primeiro teste, selecione um tipo básico com pelo menos dois campos e mapeie:

- `Frente` → campo frontal;
- `Verso` → campo traseiro;
- `Tags` → tags;
- `Baralho` → baralho.

Os cabeçalhos especiais já identificam Tags e Baralho; normalmente restam apenas Frente e Verso para conferir.

## Imagens

As imagens da Osler usam URLs temporárias protegidas por token. Por segurança e para evitar imagens quebradas, esta versão remove o token e substitui a imagem por `[Imagem disponível na Osler]`. Importação real de mídia fica para uma etapa posterior.

## Privacidade e segurança

- nenhum card é enviado para servidor externo;
- não há `fetch`, backend ou conta adicional;
- scripts, atributos perigosos e parâmetros sensíveis são removidos;
- o TSV só sai do navegador quando o usuário toca em enviar ou baixar;
- a fila não é apagada automaticamente após compartilhar, pois o navegador não consegue confirmar se a importação terminou.
