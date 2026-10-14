# Banco de Horas do Marketing · Sapion

Sistema para o setor de marketing da Sapion controlar o banco de horas de cada colaborador, com aprovação do administrador.

Construído com o **Sapion Design System**: cores, tipografia Sora e Open Sans, raios e sombras da marca, logos oficiais.

## Como funciona

- **Entrada:** a pessoa escolhe o próprio nome na lista e digita a senha.
- **Colaborador:** vê o saldo do banco de horas (positivo ou negativo), faz lançamentos de horas a mais ou a menos, sempre com uma explicação obrigatória, e acompanha o histórico com a resposta do administrador. Pode editar ou excluir um lançamento enquanto ele estiver pendente.
- **Todo lançamento nasce PENDENTE.** Só depois de aprovado pelo administrador ele conta no saldo e nas métricas.
- **Administrador:** aprova ou recusa lançamentos (um a um ou vários de uma vez), com observação opcional; cria, edita, suspende e exclui colaboradores; cria, edita e exclui qualquer lançamento; ajusta o banco de horas de qualquer pessoa; baixa uma planilha Excel com saldos e lançamentos.

### Como o colaborador lança as horas

Ele lança **só o que foi diferente da jornada normal**, não o ponto de todo dia:

1. **O que aconteceu?** "Trabalhei a mais" (crédito) ou "Trabalhei a menos" (débito).
2. **Dia.**
3. **Como informar**, do jeito que for mais fácil lembrar:
   - **Por horário:** das 18:00 às 20:30. O sistema calcula 2h30 (e entende quando passa da meia-noite).
   - **Por quantidade:** 1h30, com atalhos de 30 min, 1h, 2h e 4h.
   - **Dia inteiro:** vale a jornada diária da pessoa (ex.: folga, falta ou sábado trabalhado).
4. **Explicação** (obrigatória).

Antes de enviar, o sistema mostra o saldo atual e como ele fica depois da aprovação.

## Onde os dados ficam

No **Supabase**. As tabelas ficam fechadas para o site: ele só conversa com o banco por funções que conferem a sessão e as permissões de quem está logado. As senhas são guardadas com bcrypt. Depois de 5 senhas erradas seguidas, o acesso daquela pessoa fica bloqueado por 5 minutos. A sessão expira em 12 horas ou ao fechar o navegador.

Enquanto `js/config.js` estiver sem os dados do Supabase, o sistema abre em **modo demonstração**, com dados de exemplo salvos só no navegador.

O passo a passo completo de configuração está no arquivo `TUTORIAL.md`, entregue junto com o sistema (ele não precisa ir para o GitHub).

## Estrutura dos arquivos

```
index.html          página do sistema
css/tokens.css      tokens do Sapion Design System (cores, tipografia, espaçamentos)
css/styles.css      componentes e telas
js/config.js        endereço e chave pública do Supabase
js/api.js           comunicação com o banco (e o modo demonstração)
js/app.js           telas, lançamentos, aprovações, cadastros e planilha
assets/logos/       logos oficiais da Sapion
assets/fonts/       fonte Sora (marca)
```

Bibliotecas carregadas por CDN: [Supabase JS](https://supabase.com/docs/reference/javascript) (MIT), [Lucide](https://lucide.dev) (ícones, MIT) e [SheetJS](https://sheetjs.com) (planilhas Excel, Apache-2.0). O sistema precisa de internet para funcionar.
