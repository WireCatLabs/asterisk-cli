import type { ManifestIdentity } from "@wirecat/cli-base/wcat/manifest"
import type { AppIdentity } from "@wirecat/cli-core/cli"
import { REASONS } from "./reasons.js"
import { VERSION } from "./version.js"

export const PACKAGE = "@wirecat/asterisk-cli"

export const IDENTITY: AppIdentity = {
  command: "pbx",
  appName: "asterisk-cli",
  envPrefix: "PBX",
  description: "Asterisk PBX calls and recordings as meetings: import the CDR, transcribe on this computer, search",
  version: VERSION,
  issues: "https://github.com/WireCatLabs/asterisk-cli/issues/new",
  messenger: false,
  contentLanguages: ["ru", "en"],
  errors: { reasons: REASONS },
}

// What `wcat` and WireCat Desktop show before the tool is installed. The bin passes it to wcatStart before anything
// else loads; src/wcat.ts adds the permission keys.
export const DESKTOP: ManifestIdentity = {
  ...IDENTITY,
  docs: "https://wirecat.dev/en/docs/pbx",
  // Reached only when a profile sets transcribe_engine openai, through cli-core's speech code.
  hosts: ["api.openai.com"],
  userHosts: "the Asterisk CDR database, its SSH server or the SFTP server you set up",
  tagline: "Asterisk calls and recordings, searchable",
  syncs: "call records and their recordings",
  mcpPort: 8763,
  meetingsProvider: "asterisk",
  signIn: {
    gives: "Lets your agent find your company's phone calls and read what was said in them.",
    asks: "The path of Master.csv, or the CDR database's address and a read-only user's password.",
    methods: [
      { id: "csv", label: "Master.csv file", words: ["{profile}", "session", "start", "--json"] },
      { id: "mysql", label: "MySQL", words: ["{profile}", "session", "start", "--json"], stdin: true },
      { id: "postgres", label: "PostgreSQL", words: ["{profile}", "session", "start", "--json"], stdin: true },
    ],
  },
}

export const SKILL = new URL("../skills/asterisk-cli/SKILL.md", import.meta.url)
