import { useState, useEffect, useReducer } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button, Input, Select } from "../ui";
import {
  SpinnerIcon,
  CheckIcon,
  ClaudeIcon,
  CodexIcon,
  OpenCodeIcon,
  OllamaIcon,
} from "../icons";
import { AI_PROVIDER_ORDER, type AiProvider } from "../../services/ai";
import * as aiService from "../../services/ai";
import { mod } from "../../lib/platform";
import * as cliService from "../../services/cli";
import type { CliStatus } from "../../services/cli";
import type {
  InlineCompletionProviderId,
  InlineCompletionSettings,
  InlineCompletionTrigger,
  Settings,
} from "../../types/note";

type CliState = {
  status: CliStatus | null;
  loaded: boolean;
  error: boolean;
  operating: boolean;
};

type CliAction =
  | { type: "loaded"; status: CliStatus }
  | { type: "error" }
  | { type: "operating" }
  | { type: "operated"; status: CliStatus }
  | { type: "operate_failed" };

const cliInitialState: CliState = {
  status: null,
  loaded: false,
  error: false,
  operating: false,
};

function cliReducer(state: CliState, action: CliAction): CliState {
  switch (action.type) {
    case "loaded":
      return { ...state, status: action.status, loaded: true, error: false };
    case "error":
      return { ...state, error: true };
    case "operating":
      return { ...state, operating: true };
    case "operated":
      return { ...state, status: action.status, operating: false };
    case "operate_failed":
      return { ...state, operating: false };
  }
}

function CliUsageHint() {
  return (
    <p className="text-sm text-text-muted font-mono">
      scratch file.md # open note
      <br />
      scratch . # open folder
      <br />
      scratch # launch app
    </p>
  );
}

const AI_PROVIDER_INFO: Record<
  AiProvider,
  {
    name: string;
    icon: React.ComponentType<{ className?: string }>;
    installUrl: string;
  }
> = {
  claude: {
    name: "Claude Code",
    icon: ClaudeIcon,
    installUrl: "https://code.claude.com/docs/en/quickstart",
  },
  codex: {
    name: "OpenAI Codex",
    icon: CodexIcon,
    installUrl: "https://github.com/openai/codex",
  },
  opencode: {
    name: "OpenCode",
    icon: OpenCodeIcon,
    installUrl: "https://opencode.ai",
  },
  ollama: {
    name: "Ollama",
    icon: OllamaIcon,
    installUrl: "https://ollama.com",
  },
};

const INLINE_COMPLETION_PROVIDER_ORDER: InlineCompletionProviderId[] = [
  "ollama",
  "openai-compatible",
  "anthropic",
  "disabled",
];

const INLINE_COMPLETION_TRIGGER_OPTIONS: {
  value: InlineCompletionTrigger;
  label: string;
}[] = [
  { value: "manual", label: "Manual Only" },
  { value: "pause1s", label: "After 1s Pause" },
  { value: "pause5s", label: "After 5s Pause" },
  { value: "interval1s", label: "Every 1s" },
  { value: "interval5s", label: "Every 5s" },
];

const INLINE_COMPLETION_PROVIDER_INFO: Record<
  InlineCompletionProviderId,
  {
    name: string;
    description: string;
    endpointPlaceholder: string;
    modelPlaceholder: string;
    apiKeyPlaceholder: string;
  }
> = {
  disabled: {
    name: "Disabled",
    description: "",
    endpointPlaceholder: "",
    modelPlaceholder: "",
    apiKeyPlaceholder: "",
  },
  "openai-compatible": {
    name: "OpenAI-compatible",
    description: "Use any completions endpoint with an OpenAI-style API.",
    endpointPlaceholder: "https://api.openai.com/v1/chat/completions",
    modelPlaceholder: "gpt-4.1-mini",
    apiKeyPlaceholder: "sk-...",
  },
  anthropic: {
    name: "Anthropic",
    description: "Use Claude models through the Anthropic Messages API.",
    endpointPlaceholder: "https://api.anthropic.com/v1/messages",
    modelPlaceholder: "claude-3-5-haiku-latest",
    apiKeyPlaceholder: "sk-ant-...",
  },
  ollama: {
    name: "Ollama",
    description: "Use a local Ollama model for private inline completions.",
    endpointPlaceholder: "http://localhost:11434/api/generate",
    modelPlaceholder: "qwen3:8b",
    apiKeyPlaceholder: "Optional",
  },
};

function defaultInlineCompletionSettings(): InlineCompletionSettings {
  return {
    enabled: false,
    activeProvider: "disabled",
    trigger: "manual",
    providers: {
      "openai-compatible": {
        enabled: false,
        endpoint: "",
        apiKey: "",
        model: "",
      },
      anthropic: {
        enabled: false,
        endpoint: "",
        apiKey: "",
        model: "",
      },
      disabled: {
        enabled: false,
        endpoint: "",
        apiKey: "",
        model: "",
      },
      ollama: {
        enabled: true,
        endpoint: "http://localhost:11434/api/generate",
        apiKey: "",
        model: "qwen3:8b",
      },
    },
  };
}

function normalizeInlineCompletionSettings(
  settings?: InlineCompletionSettings,
): InlineCompletionSettings {
  const defaults = defaultInlineCompletionSettings();
  return {
    ...defaults,
    ...settings,
    providers: {
      ...defaults.providers,
      ...(settings?.providers ?? {}),
    },
  };
}

function redactInlineCompletionSettings(settings: InlineCompletionSettings) {
  return {
    ...settings,
    providers: Object.fromEntries(
      Object.entries(settings.providers ?? {}).map(([provider, config]) => [
        provider,
        {
          ...config,
          apiKey: config?.apiKey ? "<redacted>" : "",
        },
      ]),
    ),
  };
}

export function ToolsSettingsSection() {
  const [cli, dispatchCli] = useReducer(cliReducer, cliInitialState);
  const [aiProviders, setAiProviders] = useState<AiProvider[]>([]);
  const [aiProvidersLoading, setAiProvidersLoading] = useState(true);
  const [inlineCompletion, setInlineCompletion] =
    useState<InlineCompletionSettings>(defaultInlineCompletionSettings);
  const [inlineCompletionLoading, setInlineCompletionLoading] = useState(true);
  const [inlineCompletionSaving, setInlineCompletionSaving] = useState(false);

  useEffect(() => {
    cliService
      .getCliStatus()
      .then((status) => dispatchCli({ type: "loaded", status }))
      .catch((err) => {
        console.error("Failed to get CLI status:", err);
        dispatchCli({ type: "error" });
      });
  }, []);

  useEffect(() => {
    aiService
      .getAvailableAiProviders()
      .then(setAiProviders)
      .catch(() => setAiProviders([]))
      .finally(() => setAiProvidersLoading(false));
  }, []);

  useEffect(() => {
    invoke<Settings>("get_settings")
      .then((settings) => {
        const normalized = normalizeInlineCompletionSettings(
          settings.inlineCompletion,
        );
        console.info(
          "[InlineCompletionSettings] loaded",
          redactInlineCompletionSettings(normalized),
        );
        setInlineCompletion(normalized);
      })
      .catch((err) => {
        console.error("[InlineCompletionSettings] failed to load", err);
        toast.error("Failed to load inline completion settings");
      })
      .finally(() => setInlineCompletionLoading(false));
  }, []);

  const saveInlineCompletionSettings = async (
    next: InlineCompletionSettings,
  ) => {
    const normalized = normalizeInlineCompletionSettings(next);
    setInlineCompletion(normalized);
    setInlineCompletionSaving(true);
    console.info(
      "[InlineCompletionSettings] saving",
      redactInlineCompletionSettings(normalized),
    );
    try {
      const settings = await invoke<Settings>("get_settings");
      await invoke("update_settings", {
        newSettings: {
          ...settings,
          inlineCompletion: normalized,
        },
      });
      window.dispatchEvent(new CustomEvent("settings-updated"));
      console.info(
        "[InlineCompletionSettings] saved",
        redactInlineCompletionSettings(normalized),
      );
    } catch (err) {
      console.error("[InlineCompletionSettings] failed to save", err);
      toast.error("Failed to save inline completion settings");
    } finally {
      setInlineCompletionSaving(false);
    }
  };

  const updateInlineCompletionLocal = (
    provider: InlineCompletionProviderId,
    field: "endpoint" | "apiKey" | "model",
    value: string,
  ) => {
    setInlineCompletion((prev) => {
      const normalized = normalizeInlineCompletionSettings(prev);
      return {
        ...normalized,
        providers: {
          ...normalized.providers,
          [provider]: {
            ...normalized.providers?.[provider],
            [field]: value,
          },
        },
      };
    });
  };

  const persistInlineProviderField = (
    provider: InlineCompletionProviderId,
    field: "endpoint" | "apiKey" | "model",
  ) => {
    const normalized = normalizeInlineCompletionSettings(inlineCompletion);
    console.info("[InlineCompletionSettings] field blur", {
      provider,
      field,
      value:
        field === "apiKey"
          ? normalized.providers?.[provider]?.apiKey
            ? "<redacted>"
            : ""
          : normalized.providers?.[provider]?.[field],
    });
    void saveInlineCompletionSettings(normalized);
  };

  const handleInstallCli = async () => {
    dispatchCli({ type: "operating" });
    try {
      await cliService.installCli();
      const status = await cliService.getCliStatus();
      dispatchCli({ type: "operated", status });
      toast.success(
        "CLI tool installed. Open a new terminal to use `scratch`.",
      );
    } catch (err) {
      dispatchCli({ type: "operate_failed" });
      toast.error(
        err instanceof Error ? err.message : "Failed to install CLI tool",
      );
    }
  };

  const handleUninstallCli = async () => {
    dispatchCli({ type: "operating" });
    try {
      await cliService.uninstallCli();
      const status = await cliService.getCliStatus();
      dispatchCli({ type: "operated", status });
      toast.success("CLI tool uninstalled.");
    } catch (err) {
      dispatchCli({ type: "operate_failed" });
      toast.error(
        err instanceof Error ? err.message : "Failed to uninstall CLI tool",
      );
    }
  };

  return (
    <div className="space-y-8 py-8">
      {/* AI Providers */}
      <section className="pb-2">
        <h2 className="text-xl font-medium mb-0.5">AI Providers</h2>
        <p className="text-sm text-text-muted mb-4">
          Edit notes with AI from the command palette ({mod}P while editing a
          note)
        </p>

        {aiProvidersLoading ? (
          <div className="flex items-center gap-2 p-3">
            <SpinnerIcon className="w-4 h-4 animate-spin text-text-muted" />
            <span className="text-sm text-text-muted">
              Detecting installed providers...
            </span>
          </div>
        ) : (
          <div className="space-y-2">
            {AI_PROVIDER_ORDER.map((provider) => {
              const installed = aiProviders.includes(provider);
              const info = AI_PROVIDER_INFO[provider];
              return (
                <div
                  key={provider}
                  className="flex items-center justify-between p-3 rounded-[10px] border border-border"
                >
                  <div className="flex items-center gap-2.5">
                    <info.icon className="w-4.5 h-4.5 text-text-muted" />
                    <span className="text-sm font-medium">{info.name}</span>
                  </div>
                  {installed ? (
                    <span className="flex items-center gap-1.25 text-sm text-text-muted">
                      Installed
                      <span className="h-4.5 w-4.5 bg-bg-emphasis rounded-full flex items-center justify-center">
                        <CheckIcon className="w-3 h-3 stroke-[2.2]" />
                      </span>
                    </span>
                  ) : (
                    <a
                      href={info.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-text font-medium hover:text-text-muted transition-colors cursor-pointer"
                    >
                      Install
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="border-t border-border border-dashed" />

      {/* Inline Completion Providers */}
      <section className="pb-2">
        <div className="mb-4">
          <h2 className="text-xl font-medium mb-0.5">
            Inline Completion Providers
          </h2>
          <p className="text-sm text-text-muted">
            Configure providers for ghost text completions in the editor
          </p>
        </div>

        {inlineCompletionLoading ? (
          <div className="flex items-center gap-2 p-3">
            <SpinnerIcon className="w-4 h-4 animate-spin text-text-muted" />
            <span className="text-sm text-text-muted">
              Loading inline completion settings...
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[minmax(12rem,1fr)_minmax(16rem,20rem)] items-center gap-6">
              <label className="text-sm font-medium text-text">
                Active provider
              </label>
              <Select
                value={inlineCompletion.activeProvider ?? "disabled"}
                disabled={inlineCompletionSaving}
                onChange={(e) => {
                  const activeProvider = e.target
                    .value as InlineCompletionProviderId;
                  void saveInlineCompletionSettings({
                    ...normalizeInlineCompletionSettings(inlineCompletion),
                    enabled: activeProvider !== "disabled",
                    activeProvider,
                  });
                }}
              >
                {INLINE_COMPLETION_PROVIDER_ORDER.map((provider) => (
                  <option key={provider} value={provider}>
                    {INLINE_COMPLETION_PROVIDER_INFO[provider].name}
                  </option>
                ))}
              </Select>

              <label className="text-sm font-medium text-text">Trigger</label>
              <Select
                value={inlineCompletion.trigger ?? "manual"}
                disabled={
                  inlineCompletionSaving ||
                  inlineCompletion.activeProvider === "disabled"
                }
                onChange={(e) => {
                  const trigger = e.target.value as InlineCompletionTrigger;
                  void saveInlineCompletionSettings({
                    ...normalizeInlineCompletionSettings(inlineCompletion),
                    trigger,
                  });
                }}
              >
                {INLINE_COMPLETION_TRIGGER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>

            {inlineCompletion.activeProvider &&
              inlineCompletion.activeProvider !== "disabled" &&
              (() => {
                const provider = inlineCompletion.activeProvider;
                const info = INLINE_COMPLETION_PROVIDER_INFO[provider];
                const config = normalizeInlineCompletionSettings(
                  inlineCompletion,
                ).providers?.[provider];
                return (
                  <div className="mt-4 border-border border-dashed space-y-3">
                    <div className="grid grid-cols-[minmax(12rem,1fr)_minmax(16rem,20rem)] items-center gap-6">
                      <label className="text-sm font-medium text-text">
                        Endpoint
                      </label>
                      <Input
                        value={config?.endpoint ?? ""}
                        onChange={(e) =>
                          updateInlineCompletionLocal(
                            provider,
                            "endpoint",
                            e.target.value,
                          )
                        }
                        onBlur={() =>
                          persistInlineProviderField(provider, "endpoint")
                        }
                        placeholder={info.endpointPlaceholder}
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid grid-cols-[minmax(12rem,1fr)_minmax(16rem,20rem)] items-center gap-6">
                      <label className="text-sm font-medium text-text">
                        API key
                      </label>
                      <Input
                        type="password"
                        value={config?.apiKey ?? ""}
                        onChange={(e) =>
                          updateInlineCompletionLocal(
                            provider,
                            "apiKey",
                            e.target.value,
                          )
                        }
                        onBlur={() =>
                          persistInlineProviderField(provider, "apiKey")
                        }
                        placeholder={info.apiKeyPlaceholder}
                        autoComplete="off"
                      />
                    </div>
                    <div className="grid grid-cols-[minmax(12rem,1fr)_minmax(16rem,20rem)] items-center gap-6">
                      <label className="text-sm font-medium text-text">
                        Model ID
                      </label>
                      <Input
                        value={config?.model ?? ""}
                        onChange={(e) =>
                          updateInlineCompletionLocal(
                            provider,
                            "model",
                            e.target.value,
                          )
                        }
                        onBlur={() =>
                          persistInlineProviderField(provider, "model")
                        }
                        placeholder={info.modelPlaceholder}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                );
              })()}
          </>
        )}
      </section>

      {/* CLI Tool (macOS only) */}
      {(cli.loaded && cli.status?.supported) || cli.error ? (
        <>
          <div className="border-t border-border border-dashed" />

          <section className="pb-2">
            <h2 className="text-xl font-medium mb-0.5">CLI Tool</h2>
            <p className="text-sm text-text-muted mb-4">
              Open notes from the terminal with the{" "}
              <code className="font-mono text-xs bg-bg-muted px-1.5 py-0.5 rounded">
                scratch
              </code>{" "}
              command
            </p>

            {cli.error ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3">
                <p className="text-sm text-red-500">
                  Failed to check CLI status. Please restart the app.
                </p>
              </div>
            ) : cli.status === null ? (
              <div className="rounded-[10px] border border-border p-4 flex items-center justify-center">
                <SpinnerIcon className="w-4.5 h-4.5 stroke-[1.5] animate-spin text-text-muted" />
              </div>
            ) : cli.status.installed ? (
              <>
                <div className="rounded-[10px] border border-border p-4 space-y-3 mb-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-text font-medium">
                      Status
                    </span>
                    <span className="text-sm text-text-muted">Installed</span>
                  </div>
                  {cli.status.path && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text font-medium">
                        Path
                      </span>
                      <button
                        type="button"
                        className="text-xs font-mono text-text-muted bg-bg-muted px-2 py-0.5 rounded max-w-48 truncate cursor-pointer hover:bg-bg-hover transition-colors"
                        title="Click to copy path"
                        onClick={async () => {
                          try {
                            await invoke("copy_to_clipboard", { text: cli.status!.path! });
                            toast.success("Path copied to clipboard");
                          } catch {
                            toast.error("Failed to copy path");
                          }
                        }}
                      >
                        {cli.status.path}
                      </button>
                    </div>
                  )}
                  <div className="pt-3 border-t border-border border-dashed">
                    <CliUsageHint />
                  </div>
                </div>
                <Button
                  onClick={handleUninstallCli}
                  disabled={cli.operating}
                  variant="outline"
                  size="md"
                >
                  {cli.operating ? (
                    <>
                      <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
                      Uninstalling...
                    </>
                  ) : (
                    "Uninstall CLI Tool"
                  )}
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2.5 p-2.5 rounded-[10px] border border-border bg-bg-secondary mb-2.5">
                  <CliUsageHint />
                </div>
                <Button
                  onClick={handleInstallCli}
                  disabled={cli.operating}
                  variant="outline"
                  size="md"
                >
                  {cli.operating ? (
                    <>
                      <SpinnerIcon className="w-3.25 h-3.25 mr-2 animate-spin" />
                      Installing...
                    </>
                  ) : (
                    "Install CLI Tool"
                  )}
                </Button>
              </>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
