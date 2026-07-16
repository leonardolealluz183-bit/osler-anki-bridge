# Osler Anki Bridge

Userscript Android-only que captura cards marcados como **Errei** ou **Difícil** na Osler, salva antes de avançar e exporta para o AnkiDroid.

## Versão 0.4.9 — Fase 2

A 0.4.9 substitui completamente a 0.4.8. É um único userscript, sem `@require` e sem patch separado.

Correções principais:

- une cards encontrados no armazenamento permanente do Violentmonkey, no backup permanente e no `localStorage` da Osler;
- grava a fila simultaneamente nesses locais após cada captura;
- separa no painel `carregados anteriormente` de `adicionados nesta sessão`;
- mantém a captura transacional e só avança depois de salvar;
- mantém o card na tela quando a resposta não pode ser capturada;
- exporta cada card para um baralho com o nome do assunto, usando `Osler` apenas como fallback;
- oferece links nativos de download para TSV e log;
- oferece download alternativo por `GM_download`;
- mantém TSV, log e backup completo visíveis em caixas de texto para recuperação manual;
- permite copiar TSV e log;
- permite importar novamente um backup JSON colado;
- mostra permanentemente a última falha e informa se ela foi capturada depois;
- prepara automaticamente a exportação ao entrar em `/test/report`, sem varrer a página pesada.

## Fluxo

1. Pressione **Espaço** para mostrar a resposta.
2. Pressione **1** para Errei ou **2** para Difícil.
3. O painel mostra `SALVO E AVANÇOU` quando a operação termina.
4. No relatório, confira quantos cards foram carregados antes e quantos foram adicionados na sessão.
5. Use **Baixar TSV (link)** como método principal.
6. Como contingência, use **Baixar TSV via Violentmonkey**, **Abrir TSV**, **Copiar TSV** ou copie a caixa `TSV bruto`.
7. O campo `Baralho` do TSV recebe o assunto de cada card.

## Desenvolvimento

```bash
npm test
npm run lint
```
