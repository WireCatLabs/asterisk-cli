const SHARED_MCP =
  "cli-core's appMcpCommand; its app-mcp-command and mcp-server-command tests drive it, and src/mcp.test.ts runs " +
  "this CLI's own server, config, revoke and refusals"
const MEANING =
  "cli-core's addMeetingCombinedSearchCommand and addMeetingEmbeddingCommand pass this option to meetingMeaning, which its meeting-meaning-command tests drive"
const HIT_FILTERS = "cli-core's searchMeetingHits filters by this option; its meeting-hit-search tests drive it"
const LONG_RUNNING = `starts an HTTP server or a background process that runs until stopped; ${SHARED_MCP}`

export const UNTESTED: { command: string; option?: string; reason: string }[] = [
  ...["meetings list", "meetings show"].map((command) => ({
    command,
    option: "--backend",
    reason:
      "cli-core 0.660.0 src/store/meetings-read-through.test.ts drives archive, server and both on a shared source",
  })),
  {
    command: "",
    option: "--help-all",
    reason: "Commander answers before any command runs, so the trace never sees it; contracts/help.snap covers help",
  },
  {
    command: "",
    option: "--version",
    reason: "Commander answers before any command runs, so the trace never sees it; `pnpm version:check` checks it",
  },
  {
    command: "mcp server start",
    reason:
      "starts a detached `mcp serve --http` from the built entry; cli-core tests mcpServerCommand, and the background run was checked by hand against dist/",
  },
  {
    command: "mcp server start",
    option: "--port",
    reason:
      "starts a detached `mcp serve --http` from the built entry; cli-core tests mcpServerCommand, and the background run was checked by hand against dist/",
  },
  {
    command: "mcp server start",
    option: "--public-url",
    reason:
      "starts a detached `mcp serve --http` from the built entry; cli-core tests mcpServerCommand, and the background run was checked by hand against dist/",
  },
  {
    command: "mcp server stop",
    reason:
      "stops the detached server that `mcp server start` wrote a pid file for; cli-core tests mcpServerCommand, and no live scenario starts a server to stop",
  },
  ...["--http", "--port", "--public-url"].map((option) => ({ command: "mcp serve", option, reason: LONG_RUNNING })),
  { command: "mcp server status", reason: LONG_RUNNING },
  { command: "mcp server status", option: "--profiles", reason: LONG_RUNNING },
  { command: "mcp revoke", option: "--profiles", reason: SHARED_MCP },
  ...[undefined, "--allow-writes", "--permission"].map((option) => ({
    command: "mcp add",
    ...(option ? { option } : {}),
    reason: `writes Codex's or Claude Code's own MCP settings; ${SHARED_MCP}`,
  })),
  ...[undefined, "--permission"].map((option) => ({
    command: "mcp check",
    ...(option ? { option } : {}),
    reason: `starts the installed CLI as a child process, as the agent would; ${SHARED_MCP}`,
  })),
  ...[undefined, "--offline", "--accept-terms"].map((option) => ({
    command: "models download",
    ...(option ? { option } : {}),
    reason:
      "cli-core's shared model catalogue downloads hundreds of MB from the model's pinned address; cli-core tests it",
  })),
  ...[undefined, "--payload", "--offline"].map((option) => ({
    command: "models add",
    ...(option ? { option } : {}),
    reason: "cli-core's shared model catalogue pins and downloads a Hugging Face model; cli-core tests it",
  })),
  {
    command: "models set",
    reason: "cli-core's shared model catalogue writes the text model every WireCat CLI uses; cli-core tests it",
  },
  ...["--base-url", "--dims", "--max-chunks", "--max-rows", "--max-text-bytes"].map((option) => ({
    command: "search meetings",
    option,
    reason: `${MEANING}; src/calls-analytics.test.ts drives the search by meaning with a model of its own`,
  })),
  ...["--base-url", "--dims", "--limit", "--max-rows", "--max-text-bytes"].map((option) => ({
    command: "meetings embed",
    option,
    reason: `${MEANING}; src/calls-analytics.test.ts drives meetings embed --yes with a model of its own`,
  })),
  ...[
    "--meeting-id",
    "--identity-id",
    "--person-id",
    "--event-id",
    "--series-id",
    "--project",
    "--topic-name",
    "--max-read-bytes",
  ].map((option) => ({
    command: "search meetings",
    option,
    reason: `${HIT_FILTERS}; src/calls-analytics.test.ts drives the search over the calls with --tag, a window and paging`,
  })),
  {
    command: "stats calls show",
    option: "--person-id",
    reason:
      "cli-core's readCallStats filters by a stored person; its call-stats tests drive it, and src/calls-analytics.test.ts the window, --within and --limit",
  },
]
