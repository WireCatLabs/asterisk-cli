# Reference CLIs

How a command reaches a service, signs in, writes and is tested, the agent learns from the template's sample (see
"The sample" in `AGENTS.md`). The domain, the store and its commands it learns from the WireCat CLI closest to it,
picked by the first question of the [design interview](skills/design-interview/SKILL.md):

| Category | Learn from |
| --- | --- |
| messenger | [whatsapp-cli](https://github.com/WireCatLabs/whatsapp-cli), then [tg-cli](https://github.com/WireCatLabs/tg-cli) and [max-cli](https://github.com/WireCatLabs/max-cli) |
| mail | [mail-cli](https://github.com/WireCatLabs/mail-cli) |
| files and documents | [drive-cli](https://github.com/WireCatLabs/drive-cli) |
| calendar | [gcal-cli](https://github.com/WireCatLabs/gcal-cli) |
| meetings | [zoom-cli](https://github.com/WireCatLabs/zoom-cli) |
| notes | [cli-memo](https://github.com/WireCatLabs/cli-memo) |
| CRM | [bitrix24-cli](https://github.com/WireCatLabs/bitrix24-cli) |
| other | none of its own yet: pick the nearest one with the owner |

The categories follow cli-core's
[kinds](https://github.com/WireCatLabs/cli-core/blob/9386f17657656b59911417ff39327f1e6a7fcede/src/domain/providers.ts#L6), what a search reads: a messenger's are `messages`, files and documents are
`documents`, a calendar's are `events`, and the others keep their names.

A messenger CLI sets `messenger: true` in `src/identity.ts`, and `new --category messenger` writes it. Every other
category keeps the template's `messenger: false`, so the shared help and `commands` do not speak of chats, messages
and senders, and `config` lists none of cli-core's messenger settings.

## What the store keeps

A CLI never writes SQL or creates tables in the shared store: cli-core owns its schema and its migrations. A CLI hands
its records to cli-core:

- **Messages, mail, notes, documents, meetings and events** are written by cli-core's code for their kind; the
  reference CLI shows how.
- **Deals, leads, contacts and companies** go through cli-core's CRM port, `@wirecat/cli-core/crm`: the CLI implements
  [`CrmSource`](https://github.com/WireCatLabs/cli-core/blob/9386f17657656b59911417ff39327f1e6a7fcede/src/crm/source.ts#L33) and
  [`syncCrm`](https://github.com/WireCatLabs/cli-core/blob/9386f17657656b59911417ff39327f1e6a7fcede/src/crm/sync.ts#L314) keeps the store in step, as bitrix24-cli does.
- **Other structured records**, such as invoices, payments or a service's own objects, go through the records
  envelope: [`ingest`](https://github.com/WireCatLabs/cli-core/blob/9386f17657656b59911417ff39327f1e6a7fcede/src/services/ingest.ts#L57) from `@wirecat/cli-core/services`, checked against
  `@wirecat/cli-core/schemas/records-envelope.v1.schema.json`. `invoice`, `payment`, `person`, `organization` and
  `project` have [tables of their own](https://github.com/WireCatLabs/cli-core/blob/9386f17657656b59911417ff39327f1e6a7fcede/src/domain/records.ts#L7); any other type is `custom:<name>` and stays
  a record.
- **A large export streams as JSONL**: the header line (`schema_version`, `source`), then one record per line.
  [`ingestLines`](https://github.com/WireCatLabs/cli-core/blob/ab65db1c89d0b3e065f12e57fc075c03da292aec/src/services/ingest.ts#L144)
  writes it per chunk of 1000 records as the lines arrive, and
  [`jsonlLines`](https://github.com/WireCatLabs/cli-core/blob/ab65db1c89d0b3e065f12e57fc075c03da292aec/src/services/ingest.ts#L136)
  reads a file or stdin one line at a time (cli-core 0.612.0). The sample's `src/sample/records.ts` writes its comments
  as such lines and takes a file of them into the store; `src/records.test.ts` runs it twice on a temporary store, and
  the second run changes nothing.

## The provider registry

cli-core keeps a provider registry (WC-ARCH-21). A CLI whose provider is not built into cli-core writes its entry on
every run that opens the shared store: `await store.accounts.registerProvider({ name, kind, aliases, command })`, on the
store that `openStore` from `@wirecat/cli-core/store` returns
([`AccountsStore`](https://github.com/WireCatLabs/cli-core/blob/185718d3212cda9bb026e09809760979fe31a1e6/src/store/accounts.ts#L40-L41),
cli-core 0.459.0). `@wirecat/cli-core/store` does not export a `registerProvider` function. `kind` is one of cli-core's
`KINDS`, linked above. Until the CLI has run once on a computer, `search` there leaves its accounts out and lists
them under `skipped`. Of the reference CLIs, gcal-cli, mail-cli and bitrix24-cli make this call: cli-core already knows
the others' providers, from its
[seed list](https://github.com/WireCatLabs/cli-core/blob/185718d3212cda9bb026e09809760979fe31a1e6/src/domain/providers.ts#L17-L29)
and, for Drive, its
[document providers](https://github.com/WireCatLabs/cli-core/blob/185718d3212cda9bb026e09809760979fe31a1e6/src/domain/providers.ts#L50).
[gcal-cli](https://github.com/WireCatLabs/gcal-cli/blob/14e27c45e6dc204cde8adcd9e4fa6aa069745335/src/store.ts) registers
its own. The skeleton's commands open no store, and its records sample is handed one, so it registers nothing; the
call comes with the CLI's first command that opens the store.
