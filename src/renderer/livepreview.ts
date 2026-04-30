import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';

const hrLineClass = Decoration.line({ class: 'cm-hr-rendered' });
const hideDecoration = Decoration.replace({});

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);

  // Line-based mask is used for line-scoped constructs (headings, horizontal rules)
  // where the relevant unit is the source line itself.
  const cursorLines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const startLine = view.state.doc.lineAt(range.from).number;
    const endLine = view.state.doc.lineAt(range.to).number;
    for (let i = startLine; i <= endLine; i++) cursorLines.add(i);
  }

  const queue: { from: number; to: number; deco: Decoration }[] = [];

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        // EmphasisMark / CodeMark do their own granular check; bail early only for
        // line-scoped constructs (headings, HR) when the cursor is on this line.
        const lineNum = view.state.doc.lineAt(node.from).number;
        const onCursorLine = cursorLines.has(lineNum);

        switch (node.name) {
          case 'HorizontalRule': {
            if (onCursorLine) return;
            const line = view.state.doc.lineAt(node.from);
            // Line decoration adds a CSS class to the whole line; the text gets hidden.
            queue.push({ from: line.from, to: line.from, deco: hrLineClass });
            if (line.to > line.from) {
              queue.push({ from: line.from, to: line.to, deco: hideDecoration });
            }
            return false;
          }
          case 'HeaderMark': {
            if (onCursorLine) return;
            // Hide the leading "#" or "##" plus the single space after it.
            let end = node.to;
            const next = view.state.doc.sliceString(end, end + 1);
            if (next === ' ') end += 1;
            queue.push({ from: node.from, to: end, deco: hideDecoration });
            return;
          }
          case 'EmphasisMark':
          case 'CodeMark': {
            // Granular: only show the marker if the selection is inside its parent
            // construct (Emphasis / StrongEmphasis / InlineCode). This prevents long
            // wrapping paragraphs from keeping every marker visible just because the
            // cursor is somewhere else in the same source line.
            const parent = node.node.parent;
            const range = parent ?? node.node;
            const inSpan = view.state.selection.ranges.some(
              (r) => r.from <= range.to && r.to >= range.from,
            );
            if (!inSpan) {
              queue.push({ from: node.from, to: node.to, deco: hideDecoration });
            }
            return;
          }
        }
      },
    });
  }

  // RangeSetBuilder requires sorted, non-overlapping additions.
  // Line decorations (from === to) at the line start sort before any mark decoration on that line.
  queue.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const item of queue) {
    builder.add(item.from, item.to, item.deco);
  }
  return builder.finish();
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);
