import { NamedError } from "@opencode-ai/core/util/error"
import { errorFormat } from "@/util/error"
import { isRecord } from "@/util/record"

type ConfigIssue = { message: string; path: string[] }

type ErrorFormatter = (input: unknown) => string | undefined

function isTaggedError(error: unknown, tag: string): error is Record<string, unknown> {
  return isRecord(error) && error._tag === tag
}

function configData(input: unknown, tag: string): Record<string, unknown> | undefined {
  if (!isRecord(input)) return undefined
  if (input.name === tag && isRecord(input.data)) return input.data
  if (input._tag === tag) return input
  return undefined
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" ? input[key] : undefined
}

function configIssues(input: Record<string, unknown>): ConfigIssue[] {
  return Array.isArray(input.issues)
    ? input.issues.filter((issue): issue is ConfigIssue => {
        if (!isRecord(issue)) return false
        return (
          typeof issue.message === "string" &&
          Array.isArray(issue.path) &&
          issue.path.every((x) => typeof x === "string")
        )
      })
    : []
}

// CliError: domain failure surfaced from an effectCmd handler via fail("...")
function formatCliError(input: unknown): string | undefined {
  if (!isTaggedError(input, "CliError")) return undefined
  if (typeof input.exitCode === "number") process.exitCode = input.exitCode
  return stringField(input, "message") ?? ""
}

// MCPFailed: { name: string }
function formatMcpFailed(input: unknown): string | undefined {
  if (!NamedError.hasName(input, "MCPFailed")) return undefined
  const data = isRecord(input) && isRecord(input.data) ? stringField(input.data, "name") : undefined
  return `MCP server "${data}" failed. Note, opencode does not support MCP authentication yet.`
}

// AccountServiceError, AccountTransportError: TaggedErrorClass
function formatAccountError(input: unknown): string | undefined {
  if (!isTaggedError(input, "AccountServiceError") && !isTaggedError(input, "AccountTransportError")) return undefined
  return stringField(input, "message") ?? ""
}

// ProviderModelNotFoundError: { providerID: string, modelID: string, suggestions?: string[] }
function formatProviderModelNotFound(input: unknown): string | undefined {
  const data = configData(input, "ProviderModelNotFoundError")
  if (!data) return undefined
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions.filter((x) => typeof x === "string") : []
  return [
    `Model not found: ${stringField(data, "providerID")}/${stringField(data, "modelID")}`,
    ...(suggestions.length ? ["Did you mean: " + suggestions.join(", ")] : []),
    `Try: \`opencode models\` to list available models`,
    `Or check your config (opencode.json) provider/model names`,
  ].join("\n")
}

// ProviderInitError: { providerID: string }
function formatProviderInit(input: unknown): string | undefined {
  const data = configData(input, "ProviderInitError")
  if (!data) return undefined
  return `Failed to initialize provider "${stringField(data, "providerID")}". Check credentials and configuration.`
}

// ConfigJsonError: { path: string, message?: string }
function formatConfigJson(input: unknown): string | undefined {
  const data = configData(input, "ConfigJsonError")
  if (!data) return undefined
  const message = stringField(data, "message")
  return `Config file at ${stringField(data, "path")} is not valid JSON(C)` + (message ? `: ${message}` : "")
}

// ConfigDirectoryTypoError: { dir: string, path: string, suggestion: string }
function formatConfigDirectoryTypo(input: unknown): string | undefined {
  const data = configData(input, "ConfigDirectoryTypoError")
  if (!data) return undefined
  return `Directory "${stringField(data, "dir")}" in ${stringField(data, "path")} is not valid. Rename the directory to "${stringField(data, "suggestion")}" or remove it. This is a common typo.`
}

// ConfigFrontmatterError: { message: string }
function formatConfigFrontmatter(input: unknown): string | undefined {
  const data = configData(input, "ConfigFrontmatterError")
  if (!data) return undefined
  return stringField(data, "message") ?? ""
}

// ConfigRemoteAuthError: { url: string, remote: string }
function formatConfigRemoteAuth(input: unknown): string | undefined {
  const data = configData(input, "ConfigRemoteAuthError")
  if (!data) return undefined
  const url = stringField(data, "url")
  const remote = stringField(data, "remote")
  return [
    `Failed to load remote config${remote ? ` from ${remote}` : ""}: the server returned a login page instead of JSON.`,
    `Authentication is missing or has expired (the endpoint is likely behind an SSO or identity-aware proxy).`,
    ...(url ? [`Run \`opencode auth login ${url}\` to re-authenticate.`] : []),
  ].join("\n")
}

// ConfigInvalidError: { path?: string, message?: string, issues?: Array<{ message: string, path: string[] }> }
function formatConfigInvalid(input: unknown): string | undefined {
  const data = configData(input, "ConfigInvalidError")
  if (!data) return undefined
  const path = stringField(data, "path")
  const message = stringField(data, "message")
  const issues = configIssues(data)
  return [
    `Configuration is invalid${path && path !== "config" ? ` at ${path}` : ""}` + (message ? `: ${message}` : ""),
    ...issues.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")),
  ].join("\n")
}

// UICancelledError: user cancelled an interactive CLI prompt
function formatUICancelled(input: unknown): string | undefined {
  if (!isTaggedError(input, "UICancelledError") && !NamedError.hasName(input, "UICancelledError")) return undefined
  return ""
}

// Order matters: the first formatter that recognizes the input wins.
const FORMATTERS: ErrorFormatter[] = [
  formatCliError,
  formatMcpFailed,
  formatAccountError,
  formatProviderModelNotFound,
  formatProviderInit,
  formatConfigJson,
  formatConfigDirectoryTypo,
  formatConfigFrontmatter,
  formatConfigRemoteAuth,
  formatConfigInvalid,
  formatUICancelled,
]

export function FormatError(input: unknown): string | undefined {
  if (input instanceof Error && isRecord(input.cause) && "body" in input.cause) {
    const formatted = FormatError(input.cause.body)
    if (formatted) return formatted
  }

  for (const format of FORMATTERS) {
    const result = format(input)
    if (result !== undefined) return result
  }

  return undefined
}

export function FormatUnknownError(input: unknown): string {
  return errorFormat(input)
}