import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "../ui";
import {
  defaultInlineCompletionShortcuts,
  formatShortcutKeys,
  normalizeInlineCompletionShortcuts,
  parseShortcutInput,
  shortcutCategories,
} from "../../lib/shortcuts";
import * as notesService from "../../services/notes";
import type { InlineCompletionShortcutSettings } from "../../types/note";

// Render individual key as keyboard button
function KeyboardKey({ keyLabel }: { keyLabel: string }) {
  return (
    <kbd className="text-xs px-1.5 py-0.5 rounded-md bg-bg-muted text-text min-w-6.5 inline-flex items-center justify-center">
      {keyLabel}
    </kbd>
  );
}

// Render shortcut keys
function ShortcutKeys({ keys }: { keys: string[] }) {
  return (
    <div className="flex items-center gap-1.5">
      {keys.map((key) => (
        <KeyboardKey key={key} keyLabel={key} />
      ))}
    </div>
  );
}

// Categories to show in settings (exclude Markdown Syntax)
const settingsCategories = ["Navigation", "Notes", "Editor", "Settings"];

const inlineCompletionShortcutRows: {
  key: keyof Required<InlineCompletionShortcutSettings>;
  label: string;
}[] = [
  { key: "trigger", label: "Trigger inline completion" },
  { key: "accept", label: "Accept inline completion" },
  { key: "acceptWord", label: "Accept next word" },
  { key: "dismiss", label: "Dismiss inline completion" },
];

export function ShortcutsSettingsSection() {
  const [inlineShortcuts, setInlineShortcuts] = useState<
    Required<InlineCompletionShortcutSettings>
  >(defaultInlineCompletionShortcuts);
  const [inlineShortcutDrafts, setInlineShortcutDrafts] = useState<
    Record<keyof Required<InlineCompletionShortcutSettings>, string>
  >({
    trigger: formatShortcutKeys(defaultInlineCompletionShortcuts.trigger),
    accept: formatShortcutKeys(defaultInlineCompletionShortcuts.accept),
    acceptWord: formatShortcutKeys(defaultInlineCompletionShortcuts.acceptWord),
    dismiss: formatShortcutKeys(defaultInlineCompletionShortcuts.dismiss),
  });

  useEffect(() => {
    notesService
      .getSettings()
      .then((settings) => {
        const normalized = normalizeInlineCompletionShortcuts(
          settings.inlineCompletionShortcuts,
        );
        console.info("[InlineCompletionShortcuts] loaded", normalized);
        setInlineShortcuts(normalized);
        setInlineShortcutDrafts({
          trigger: formatShortcutKeys(normalized.trigger),
          accept: formatShortcutKeys(normalized.accept),
          acceptWord: formatShortcutKeys(normalized.acceptWord),
          dismiss: formatShortcutKeys(normalized.dismiss),
        });
      })
      .catch((err) => {
        console.error("[InlineCompletionShortcuts] failed to load", err);
        toast.error("Failed to load inline completion shortcuts");
      });
  }, []);

  const saveInlineShortcut = async (
    key: keyof Required<InlineCompletionShortcutSettings>,
    value: string,
  ) => {
    const parsed = parseShortcutInput(value);
    if (parsed.length === 0) {
      toast.error("Shortcut cannot be empty");
      return;
    }

    const next = {
      ...inlineShortcuts,
      [key]: parsed,
    };
    setInlineShortcuts(next);
    setInlineShortcutDrafts((prev) => ({
      ...prev,
      [key]: formatShortcutKeys(parsed),
    }));
    console.info("[InlineCompletionShortcuts] saving", next);

    try {
      const settings = await notesService.getSettings();
      await notesService.updateSettings({
        ...settings,
        inlineCompletionShortcuts: next,
      });
      window.dispatchEvent(new CustomEvent("settings-updated"));
      console.info("[InlineCompletionShortcuts] saved", next);
    } catch (err) {
      console.error("[InlineCompletionShortcuts] failed to save", err);
      toast.error("Failed to save shortcut");
    }
  };

  return (
    <div className="space-y-8 pb-8">
      {settingsCategories.map((categoryName, idx) => {
        const category = shortcutCategories.find(
          (c) => c.title === categoryName,
        );
        if (!category) return null;

        return (
          <div key={categoryName}>
            {idx > 0 && (
              <div className="border-t border-border border-dashed" />
            )}
            <section>
              <h2 className="text-xl font-medium pt-8 mb-4">
                {categoryName}
              </h2>
              <div className="space-y-3">
                {category.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="text-sm text-text font-medium">
                      {shortcut.description}
                    </span>
                    <ShortcutKeys keys={shortcut.keys} />
                  </div>
                ))}
              </div>
            </section>
          </div>
        );
      })}

      <div className="border-t border-border border-dashed" />
      <section>
        <h2 className="text-xl font-medium pt-8 mb-4">Inline Completion</h2>
        <div className="space-y-3">
          {inlineCompletionShortcutRows.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-[minmax(12rem,1fr)_minmax(12rem,18rem)] items-center gap-6"
            >
              <span className="text-sm text-text font-medium">
                {row.label}
              </span>
              <Input
                value={inlineShortcutDrafts[row.key]}
                onChange={(e) => {
                  setInlineShortcutDrafts((prev) => ({
                    ...prev,
                    [row.key]: e.target.value,
                  }));
                }}
                onBlur={(e) => void saveInlineShortcut(row.key, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className="font-mono text-right"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Separate keys with +, for example Ctrl+→ or ⌘+J.
        </p>
      </section>
    </div>
  );
}
