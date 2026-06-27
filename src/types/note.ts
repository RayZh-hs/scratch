export interface NoteMetadata {
  id: string;
  title: string;
  preview: string;
  modified: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  path: string;
  modified: number;
}

export interface ThemeSettings {
  mode: "light" | "dark" | "system";
}

export type FontFamily = "system-sans" | "serif" | "monospace";
export type TextDirection = "auto" | "ltr" | "rtl";
export type EditorWidth = "narrow" | "normal" | "wide" | "full" | "custom";
export type InlineCompletionProviderId =
  | "disabled"
  | "openai-compatible"
  | "anthropic"
  | "ollama";

// When to automatically request inline completions.
// "manual" only fires on the trigger shortcut; "pause*" debounce after the user
// stops editing; "interval*" fire on a fixed cadence.
export type InlineCompletionTrigger =
  | "manual"
  | "pause1s"
  | "pause5s"
  | "interval1s"
  | "interval5s";

export interface EditorFontSettings {
  baseFontFamily?: FontFamily;
  baseFontSize?: number; // in px, default 16
  boldWeight?: number; // 600, 700, 800 for headings and bold text
  lineHeight?: number; // default 1.6
}

// Customizable theme color keys (maps to CSS --color-* variables)
export type ThemeColorKey =
  | "bg"
  | "bg-secondary"
  | "bg-muted"
  | "bg-emphasis"
  | "text"
  | "text-muted"
  | "border"
  | "accent"
  | "selection";

// Partial map of color overrides (hex strings)
export type CustomColors = Partial<Record<ThemeColorKey, string>>;

export interface InlineCompletionProviderSettings {
  enabled?: boolean;
  endpoint?: string;
  apiKey?: string;
  model?: string;
}

export interface InlineCompletionSettings {
  enabled?: boolean;
  activeProvider?: InlineCompletionProviderId;
  trigger?: InlineCompletionTrigger;
  providers?: Partial<
    Record<InlineCompletionProviderId, InlineCompletionProviderSettings>
  >;
}

export interface InlineCompletionShortcutSettings {
  trigger?: string[];
  accept?: string[];
  acceptWord?: string[];
  dismiss?: string[];
}

// Per-folder settings (stored in .scratch/settings.json)
export interface Settings {
  theme: ThemeSettings;
  editorFont?: EditorFontSettings;
  gitEnabled?: boolean;
  foldersEnabled?: boolean;
  pinnedNoteIds?: string[];
  textDirection?: TextDirection;
  editorWidth?: EditorWidth;
  customEditorWidthPx?: number;
  defaultNoteName?: string;
  interfaceZoom?: number;
  ollamaModel?: string;
  inlineCompletion?: InlineCompletionSettings;
  inlineCompletionShortcuts?: InlineCompletionShortcutSettings;
  ignoredPatterns?: string[];
  customColorsLight?: CustomColors;
  customColorsDark?: CustomColors;
}

export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  notes: NoteMetadata[];
}
