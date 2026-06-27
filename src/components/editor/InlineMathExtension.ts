import { InputRule } from "@tiptap/core";
import { InlineMath } from "@tiptap/extension-mathematics";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

export const inlineMathPluginKey = new PluginKey("inlineMathEditing");

/**
 * Regex to find $...$ patterns in text content.
 * Matches single-$ delimited math (not $$), with non-empty content.
 */
const INLINE_MATH_TEXT_RE = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g;

export const ScratchInlineMath = InlineMath.extend({
  addInputRules() {
    return [
      new InputRule({
        // Match $content$ at end of input (single $ delimiters, not preceded by $)
        find: /(^|[^$])\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          const latex = (match[2] ?? "").trim();
          if (!latex) return;
          // The leading char (match[1]) is not part of the $...$, adjust start
          const dollarStart = range.from + match[1].length;
          state.tr.replaceWith(
            dollarStart,
            range.to,
            this.type.create({ latex }),
          );
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const nodeType = this.type;

    return [
      new Plugin({
        key: inlineMathPluginKey,
        props: {
          handleClick(view, pos) {
            // Check if click hit an inlineMath node
            const node = view.state.doc.nodeAt(pos);
            if (!node || node.type !== nodeType) return false;

            // Replace atom with text "$latex$" and position cursor before closing $
            const latex = node.attrs.latex || "";
            const text = `$${latex}$`;
            const tr = view.state.tr.replaceWith(
              pos,
              pos + node.nodeSize,
              view.state.schema.text(text),
            );
            // Position cursor before the closing $
            const cursorPos = pos + text.length - 1;
            tr.setSelection(TextSelection.create(tr.doc, cursorPos));
            view.dispatch(tr);
            return true;
          },

          handleKeyDown(view, event) {
            const { state } = view;
            const { selection } = state;
            if (!(selection instanceof TextSelection)) return false;

            const { from } = selection;

            // ESC: seal inline math by moving cursor out of $...$ region
            if (event.key === "Escape") {
              // Find if cursor is inside a $...$ text region
              const $pos = state.doc.resolve(from);
              const parent = $pos.parent;
              if (!parent.isTextblock) return false;

              const parentOffset = $pos.parentOffset;
              const parentText = parent.textContent;

              // Search for $...$ that contains the cursor
              INLINE_MATH_TEXT_RE.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = INLINE_MATH_TEXT_RE.exec(parentText)) !== null) {
                const matchStart = m.index;
                const matchEnd = matchStart + m[0].length;
                if (parentOffset > matchStart && parentOffset < matchEnd) {
                  // Cursor is inside this $...$, move cursor after it
                  const absoluteEnd = from - parentOffset + matchEnd;
                  const tr = state.tr.setSelection(
                    TextSelection.create(state.doc, absoluteEnd),
                  );
                  view.dispatch(tr);
                  return true;
                }
              }
              return false;
            }

            // Arrow keys: enter/skip inline math atoms
            const isLeft = event.key === "ArrowLeft";
            const isRight = event.key === "ArrowRight";
            if (!isLeft && !isRight) return false;

            const hasCtrl = event.ctrlKey || event.metaKey;

            if (hasCtrl) {
              // Ctrl+Arrow: skip over the entire inline math atom in one step.
              // ProseMirror's default would create an intermediate NodeSelection
              // requiring two keystrokes. We handle it directly.
              if (isRight) {
                const $pos = state.doc.resolve(from);
                const nodeAfter = $pos.nodeAfter;
                if (nodeAfter && nodeAfter.type === nodeType) {
                  const tr = state.tr.setSelection(
                    TextSelection.create(state.doc, from + nodeAfter.nodeSize),
                  );
                  view.dispatch(tr);
                  return true;
                }
              }
              if (isLeft) {
                const $pos = state.doc.resolve(from);
                const nodeBefore = $pos.nodeBefore;
                if (nodeBefore && nodeBefore.type === nodeType) {
                  const tr = state.tr.setSelection(
                    TextSelection.create(state.doc, from - nodeBefore.nodeSize),
                  );
                  view.dispatch(tr);
                  return true;
                }
              }
              return false;
            }

            // Plain arrow: enter the equation by expanding to raw text
            if (isRight) {
              // Check if there's an inlineMath node right after the cursor
              const $pos = state.doc.resolve(from);
              const nodeAfter = $pos.nodeAfter;
              if (nodeAfter && nodeAfter.type === nodeType) {
                // Expand to "$latex$" and place cursor after the opening $
                const latex = nodeAfter.attrs.latex || "";
                const text = `$${latex}$`;
                const nodeStart = from;
                const tr = state.tr.replaceWith(
                  nodeStart,
                  nodeStart + nodeAfter.nodeSize,
                  state.schema.text(text),
                );
                // Cursor after the opening $ (position: nodeStart + 1)
                tr.setSelection(TextSelection.create(tr.doc, nodeStart + 1));
                view.dispatch(tr);
                return true;
              }
            }

            if (isLeft) {
              // Check if there's an inlineMath node right before the cursor
              const $pos = state.doc.resolve(from);
              const nodeBefore = $pos.nodeBefore;
              if (nodeBefore && nodeBefore.type === nodeType) {
                // Expand to "$latex$" and place cursor before the closing $
                const latex = nodeBefore.attrs.latex || "";
                const text = `$${latex}$`;
                const nodeStart = from - nodeBefore.nodeSize;
                const tr = state.tr.replaceWith(
                  nodeStart,
                  from,
                  state.schema.text(text),
                );
                // Cursor before the closing $ (position: nodeStart + text.length - 1)
                const cursorPos = nodeStart + text.length - 1;
                tr.setSelection(TextSelection.create(tr.doc, cursorPos));
                view.dispatch(tr);
                return true;
              }
            }

            return false;
          },
        },
        appendTransaction(_transactions, _oldState, newState) {
          const { selection } = newState;
          // Only handle text cursor (not node selection etc.)
          if (!(selection instanceof TextSelection)) return null;

          const cursorPos = selection.from;
          let tr = newState.tr;
          let changed = false;

          // Scan all text nodes for $...$ patterns where cursor is NOT inside
          newState.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return;

            const text = node.text;
            INLINE_MATH_TEXT_RE.lastIndex = 0;
            let m: RegExpExecArray | null;

            // Collect matches in reverse order (to preserve positions when replacing)
            const matches: Array<{
              from: number;
              to: number;
              latex: string;
            }> = [];

            while ((m = INLINE_MATH_TEXT_RE.exec(text)) !== null) {
              const matchStart = pos + m.index;
              const matchEnd = matchStart + m[0].length;
              const latex = m[1].trim();

              // Skip if cursor is strictly inside this $...$ region (between delimiters).
              // Cursor AT the boundary (|$xxx$ or $xxx$|) should allow sealing.
              if (cursorPos > matchStart && cursorPos < matchEnd) continue;
              // Skip empty content
              if (!latex) continue;

              matches.push({ from: matchStart, to: matchEnd, latex });
            }

            // Apply replacements in reverse order to preserve positions
            for (let i = matches.length - 1; i >= 0; i--) {
              const { from, to, latex } = matches[i];
              const mappedFrom = tr.mapping.map(from);
              const mappedTo = tr.mapping.map(to);
              tr.replaceWith(mappedFrom, mappedTo, nodeType.create({ latex }));
              changed = true;
            }
          });

          return changed ? tr : null;
        },
      }),
    ];
  },
});
