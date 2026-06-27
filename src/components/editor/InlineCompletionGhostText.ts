import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const LOG_PREFIX = "[InlineCompletionGhostText]";

interface InlineCompletionGhostTextState {
  text: string | null;
  pos: number | null;
  requestId: number | null;
}

type InlineCompletionGhostTextMeta =
  | {
      type: "show";
      text: string;
      pos: number;
      requestId: number;
    }
  | { type: "clear"; reason: string };

export const inlineCompletionGhostTextPluginKey =
  new PluginKey<InlineCompletionGhostTextState>("inlineCompletionGhostText");

function emptyState(): InlineCompletionGhostTextState {
  return {
    text: null,
    pos: null,
    requestId: null,
  };
}

export function getInlineCompletionGhostTextState(
  editor: Editor | null,
): InlineCompletionGhostTextState {
  if (!editor) return emptyState();
  return inlineCompletionGhostTextPluginKey.getState(editor.state) ?? emptyState();
}

export function hasInlineCompletionGhostText(editor: Editor | null): boolean {
  return Boolean(getInlineCompletionGhostTextState(editor).text);
}

export function showInlineCompletionGhostText(
  editor: Editor,
  text: string,
  requestId = Date.now(),
): boolean {
  if (!text.trim()) {
    console.info(`${LOG_PREFIX} skip empty suggestion`, { requestId });
    return false;
  }

  const { selection, doc } = editor.state;
  if (!selection.empty) {
    console.info(`${LOG_PREFIX} skip non-empty selection`, {
      requestId,
      from: selection.from,
      to: selection.to,
    });
    return false;
  }

  const pos = Math.min(selection.from, doc.content.size);
  console.info(`${LOG_PREFIX} show`, {
    requestId,
    pos,
    preview: text.slice(0, 80),
  });
  editor.view.dispatch(
    editor.state.tr.setMeta(inlineCompletionGhostTextPluginKey, {
      type: "show",
      text,
      pos,
      requestId,
    } satisfies InlineCompletionGhostTextMeta),
  );
  return true;
}

export function clearInlineCompletionGhostText(
  editor: Editor | null,
  reason: string,
): boolean {
  if (!editor || !hasInlineCompletionGhostText(editor)) return false;
  console.info(`${LOG_PREFIX} clear`, { reason });
  editor.view.dispatch(
    editor.state.tr.setMeta(inlineCompletionGhostTextPluginKey, {
      type: "clear",
      reason,
    } satisfies InlineCompletionGhostTextMeta),
  );
  return true;
}

export function acceptInlineCompletionGhostText(editor: Editor | null): boolean {
  if (!editor) return false;

  const state = getInlineCompletionGhostTextState(editor);
  if (!state.text || state.pos === null) return false;

  if (editor.state.selection.from !== state.pos) {
    console.info(`${LOG_PREFIX} reject accept after cursor moved`, {
      anchor: state.pos,
      cursor: editor.state.selection.from,
      requestId: state.requestId,
    });
    clearInlineCompletionGhostText(editor, "cursor-moved-before-accept");
    return false;
  }

  console.info(`${LOG_PREFIX} accept`, {
    requestId: state.requestId,
    pos: state.pos,
    length: state.text.length,
  });
  editor.view.dispatch(
    editor.state.tr
      .insertText(state.text, state.pos)
      .setMeta(inlineCompletionGhostTextPluginKey, {
        type: "clear",
        reason: "accepted",
      } satisfies InlineCompletionGhostTextMeta)
      .scrollIntoView(),
  );
  return true;
}

function nextWordBoundary(text: string): number {
  const leadingWhitespace = text.match(/^\s+/)?.[0].length ?? 0;
  const rest = text.slice(leadingWhitespace);
  const wordLength = rest.match(/^[^\s]+/)?.[0].length ?? rest.length;
  // TODO: Improve word splitting for CJK text; this currently treats a
  // contiguous non-whitespace Chinese segment as one word.
  return Math.min(text.length, leadingWhitespace + wordLength);
}

export function acceptInlineCompletionGhostTextWord(
  editor: Editor | null,
): boolean {
  if (!editor) return false;

  const state = getInlineCompletionGhostTextState(editor);
  if (!state.text || state.pos === null) return false;

  if (editor.state.selection.from !== state.pos) {
    console.info(`${LOG_PREFIX} reject word accept after cursor moved`, {
      anchor: state.pos,
      cursor: editor.state.selection.from,
      requestId: state.requestId,
    });
    clearInlineCompletionGhostText(editor, "cursor-moved-before-word-accept");
    return false;
  }

  const splitAt = nextWordBoundary(state.text);
  const accepted = state.text.slice(0, splitAt);
  const remaining = state.text.slice(splitAt);
  if (!accepted) return false;

  console.info(`${LOG_PREFIX} accept word`, {
    requestId: state.requestId,
    pos: state.pos,
    acceptedLength: accepted.length,
    remainingLength: remaining.length,
  });

  let tr = editor.state.tr.insertText(accepted, state.pos);
  if (remaining) {
    tr = tr.setMeta(inlineCompletionGhostTextPluginKey, {
      type: "show",
      text: remaining,
      pos: state.pos + accepted.length,
      requestId: state.requestId ?? Date.now(),
    } satisfies InlineCompletionGhostTextMeta);
  } else {
    tr = tr.setMeta(inlineCompletionGhostTextPluginKey, {
      type: "clear",
      reason: "word-accepted-final",
    } satisfies InlineCompletionGhostTextMeta);
  }

  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export const InlineCompletionGhostText = Extension.create({
  name: "inlineCompletionGhostText",

  addProseMirrorPlugins() {
    return [
      new Plugin<InlineCompletionGhostTextState>({
        key: inlineCompletionGhostTextPluginKey,
        state: {
          init: emptyState,
          apply: (tr, previous) => {
            const meta = tr.getMeta(
              inlineCompletionGhostTextPluginKey,
            ) as InlineCompletionGhostTextMeta | undefined;

            if (meta?.type === "show") {
              return {
                text: meta.text,
                pos: meta.pos,
                requestId: meta.requestId,
              };
            }

            if (meta?.type === "clear") {
              return emptyState();
            }

            if (!previous.text || previous.pos === null) {
              return previous;
            }

            // A document edit we didn't explicitly account for (paste, delete,
            // or a keystroke that doesn't continue the suggestion) invalidates
            // it. Type-through and accept edits carry a "show"/"clear" meta and
            // are handled above, so any docChange reaching here is stale.
            if (tr.docChanged) {
              console.info(`${LOG_PREFIX} auto-clear after document change`, {
                requestId: previous.requestId,
              });
              return emptyState();
            }

            // Selection moved away from the anchor (arrow keys, click, range
            // selection) — discard the suggestion.
            if (!tr.selection.empty || tr.selection.from !== previous.pos) {
              console.info(`${LOG_PREFIX} auto-clear after cursor moved`, {
                requestId: previous.requestId,
              });
              return emptyState();
            }

            return previous;
          },
        },
        props: {
          decorations: (state) => {
            const pluginState =
              inlineCompletionGhostTextPluginKey.getState(state) ?? emptyState();

            if (!pluginState.text || pluginState.pos === null) {
              return DecorationSet.empty;
            }

            const pos = Math.min(pluginState.pos, state.doc.content.size);
            const widget = Decoration.widget(
              pos,
              () => {
                const span = document.createElement("span");
                span.className = "inline-ai-ghost-text";
                span.textContent = pluginState.text ?? "";
                span.setAttribute("aria-hidden", "true");
                console.debug(`${LOG_PREFIX} render widget`, {
                  requestId: pluginState.requestId,
                  pos,
                  length: pluginState.text?.length ?? 0,
                });
                return span;
              },
              {
                // Include pos + text length in the key: ProseMirror reuses a
                // widget's DOM when the key is unchanged, which would otherwise
                // keep stale ghost text after a type-through / word accept
                // shortens the suggestion.
                key: `inline-ai-ghost-${pluginState.requestId ?? 0}-${pos}-${pluginState.text.length}`,
                side: 1,
              },
            );

            return DecorationSet.create(state.doc, [widget]);
          },
          // "Type through" the suggestion: when the user types the characters
          // they're being shown (or any matching prefix), keep the remainder as
          // ghost text instead of discarding it. This makes the suggestion
          // repeatable rather than one-shot. Non-matching edits fall through and
          // apply() discards the now-stale suggestion.
          handleTextInput: (view, from, to, text) => {
            const state =
              inlineCompletionGhostTextPluginKey.getState(view.state) ??
              emptyState();
            if (!state.text || state.pos === null) return false;

            // Only a plain caret insertion exactly at the anchor can continue
            // the suggestion.
            if (from !== to || from !== state.pos) return false;
            if (!state.text.startsWith(text)) return false;

            const remaining = state.text.slice(text.length);
            const nextPos = from + text.length;
            console.info(`${LOG_PREFIX} type-through`, {
              requestId: state.requestId,
              typed: text.length,
              remaining: remaining.length,
            });

            const tr = view.state.tr.insertText(text, from, to);
            tr.setMeta(
              inlineCompletionGhostTextPluginKey,
              remaining
                ? {
                    type: "show",
                    text: remaining,
                    pos: nextPos,
                    requestId: state.requestId ?? Date.now(),
                  }
                : { type: "clear", reason: "typed-through-final" },
            );
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});
