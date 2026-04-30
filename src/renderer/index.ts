import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { EditorView, keymap, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap, search, openSearchPanel } from '@codemirror/search';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { livePreviewPlugin } from './livepreview';

declare global {
  interface Window {
    api: {
      openFile: () => Promise<{ path: string; content: string } | null>;
      openFolder: () => Promise<{ path: string; files: { name: string; path: string; mtimeMs: number }[] } | null>;
      listFolder: (path: string) => Promise<{ name: string; path: string; mtimeMs: number }[]>;
      readFile: (path: string) => Promise<string>;
      writeFile: (path: string, content: string) => Promise<{ path: string }>;
      writeNextVersion: (path: string, content: string) => Promise<{ path: string }>;
      snapshot: (path: string, content: string) => Promise<{ path: string }>;
      getRecent: () => Promise<{ recentFiles: string[]; recentFolders: string[]; lastFolder: string | null }>;
      selftestRoundtrip: (path: string) => Promise<{ identical: boolean; originalBytes: number; reEncodedBytes: number }>;
      onMenu: (channel: string, handler: (...args: unknown[]) => void) => () => void;
    };
  }
}

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'tok-heading1' },
  { tag: t.heading2, class: 'tok-heading2' },
  { tag: t.heading3, class: 'tok-heading3' },
  { tag: t.heading4, class: 'tok-heading4' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: '#5b6a3a', textDecoration: 'underline' },
  { tag: t.url, color: '#5b6a3a' },
  { tag: t.monospace, fontFamily: 'SF Mono, Menlo, monospace', fontSize: '0.92em' },
  { tag: t.quote, color: '#6a6a66', fontStyle: 'italic' },
  { tag: t.list, color: '#1a1a1a' },
  { tag: t.meta, color: '#a0a09a' },
  { tag: t.processingInstruction, color: '#a0a09a' },
]);

interface DocState {
  path: string | null;
  content: string;
  pristine: string;
  folder: string | null;
  files: { name: string; path: string; mtimeMs: number }[];
}

const state: DocState = {
  path: null,
  content: '',
  pristine: '',
  folder: null,
  files: [],
};

const editorRoot = document.getElementById('editor')!;
const fileNameLabel = document.getElementById('file-name-label')!;
const folderNameBtn = document.getElementById('folder-name')!;
const folderNameLabel = document.getElementById('folder-name-label')!;
const fileListEl = document.getElementById('file-list')! as HTMLUListElement;
const wordCountEl = document.getElementById('word-count')!;
const charCountEl = document.getElementById('char-count')!;
const lineInfoEl = document.getElementById('line-info')!;
const dirtyEl = document.getElementById('dirty-indicator')!;
const sourceToggleBtn = document.getElementById('source-toggle')!;

type FontKind = 'mono' | 'serif' | 'sans';
const FONT_KEY = 'goatpad.font';
const MODE_KEY = 'goatpad.mode'; // 'live' | 'source'

const fontStacks: Record<FontKind, string> = {
  mono: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
  serif: '"Iowan Old Style", Palatino, Georgia, serif',
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
};

const fontTheme = (kind: FontKind) =>
  EditorView.theme({
    '.cm-content': { fontFamily: fontStacks[kind] },
    '.cm-scroller': { fontFamily: fontStacks[kind] },
  });

const livePreviewCompartment = new Compartment();
const fontCompartment = new Compartment();

let currentFont: FontKind = (localStorage.getItem(FONT_KEY) as FontKind) || 'mono';
let currentMode: 'live' | 'source' = (localStorage.getItem(MODE_KEY) as 'live' | 'source') || 'live';

const view = new EditorView({
  parent: editorRoot,
  state: EditorState.create({
    doc: '',
    extensions: [
      history(),
      drawSelection(),
      markdown(),
      syntaxHighlighting(mdHighlight),
      search({ top: true }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        { key: 'Mod-/', run: () => { toggleSourceMode(); return true; } },
      ]),
      EditorState.lineSeparator.of('\n'),
      EditorView.lineWrapping,
      livePreviewCompartment.of(currentMode === 'live' ? livePreviewPlugin : []),
      fontCompartment.of(fontTheme(currentFont)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.selectionSet) updateStatus();
      }),
    ],
  }),
});

function updateStatus(): void {
  const doc = view.state.doc;
  const text = doc.toString();
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  wordCountEl.textContent = `${words.toLocaleString()} words`;
  charCountEl.textContent = `${text.length.toLocaleString()} chars`;
  const head = view.state.selection.main.head;
  const line = doc.lineAt(head);
  lineInfoEl.textContent = `Ln ${line.number}, Col ${head - line.from + 1}`;
  const dirty = text !== state.pristine;
  dirtyEl.classList.toggle('dirty', dirty);
}

function setDoc(content: string, path: string | null): void {
  state.path = path;
  state.pristine = content;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    selection: EditorSelection.cursor(0),
  });
  fileNameLabel.textContent = path ? path.split('/').pop()! : 'No file open';
  renderFileList();
  updateChromeState();
  updateStatus();
}

function updateChromeState(): void {
  document.body.classList.toggle('no-folder', state.folder === null);
  document.body.classList.toggle('no-file-open', state.path === null);
  if (state.folder === null) {
    folderNameLabel.textContent = 'No folder open';
  } else {
    folderNameLabel.textContent = state.folder.split('/').pop() || state.folder;
    folderNameBtn.title = state.folder;
  }
}

function renderFileList(): void {
  fileListEl.innerHTML = '';
  for (const f of state.files) {
    const li = document.createElement('li');
    li.textContent = f.name;
    li.title = f.path;
    if (f.path === state.path) li.classList.add('active');
    li.addEventListener('click', () => openFileFromPath(f.path));
    fileListEl.appendChild(li);
  }
}

async function openFileFromPath(path: string): Promise<void> {
  if (await maybeWarnUnsaved() === 'cancel') return;
  const content = await window.api.readFile(path);
  setDoc(content, path);
}

async function maybeWarnUnsaved(): Promise<'continue' | 'cancel'> {
  const dirty = view.state.doc.toString() !== state.pristine;
  if (!dirty) return 'continue';
  const ok = confirm('You have unsaved changes. Discard them?');
  return ok ? 'continue' : 'cancel';
}

async function handleOpenFile(): Promise<void> {
  if (await maybeWarnUnsaved() === 'cancel') return;
  const result = await window.api.openFile();
  if (!result) return;
  setDoc(result.content, result.path);
  await maybeAutoSwitchFolder(result.path);
}

async function maybeAutoSwitchFolder(filePath: string): Promise<void> {
  const slash = filePath.lastIndexOf('/');
  if (slash <= 0) return;
  const fileDir = filePath.slice(0, slash);
  if (state.folder === fileDir) return;
  try {
    const files = await window.api.listFolder(fileDir);
    state.folder = fileDir;
    state.files = files;
    renderFileList();
    updateChromeState();
  } catch {
    /* directory unreadable — leave existing sidebar */
  }
}

async function handleOpenFolder(): Promise<void> {
  const result = await window.api.openFolder();
  if (!result) return;
  state.folder = result.path;
  state.files = result.files;
  renderFileList();
  updateChromeState();
}

async function handleSave(): Promise<void> {
  if (!state.path) {
    alert('No file open. Use Open File… or Open Folder… first.');
    return;
  }
  const content = view.state.doc.toString();
  await window.api.snapshot(state.path, content);
  await window.api.writeFile(state.path, content);
  state.pristine = content;
  await refreshFolder();
  updateStatus();
}

async function handleSaveNextVersion(): Promise<void> {
  if (!state.path) {
    alert('No file open. Use Open File… or Open Folder… first.');
    return;
  }
  const content = view.state.doc.toString();
  await window.api.snapshot(state.path, content);
  const result = await window.api.writeNextVersion(state.path, content);
  state.path = result.path;
  state.pristine = content;
  fileNameLabel.textContent = result.path.split('/').pop()!;
  await refreshFolder();
  updateStatus();
}

async function refreshFolder(): Promise<void> {
  if (!state.folder) return;
  state.files = await window.api.listFolder(state.folder);
  renderFileList();
}

function applyFormat(kind: string): void {
  const sel = view.state.selection.main;
  const selectedText = view.state.sliceDoc(sel.from, sel.to);

  // If the cursor (or selection) sits inside an existing Emphasis / StrongEmphasis,
  // strip its markers and bail. This handles "I'm already inside italic, clicking
  // italic again should turn it off."
  const stripSurrounding = (typeName: string): boolean => {
    const tree = syntaxTree(view.state);
    let node = tree.resolveInner(sel.from, 0);
    while (node) {
      if (node.name === typeName) {
        const open = node.firstChild;
        const close = node.lastChild;
        if (open && close && open !== close && open.name === 'EmphasisMark' && close.name === 'EmphasisMark') {
          view.dispatch({
            changes: [
              { from: open.from, to: open.to, insert: '' },
              { from: close.from, to: close.to, insert: '' },
            ],
          });
          view.focus();
          return true;
        }
      }
      const parent = node.parent;
      if (!parent) break;
      node = parent;
    }
    return false;
  };

  const wrap = (left: string, right = left, removeType?: string) => {
    // First try to strip an existing same-kind wrapper (italic-on-italic,
    // bold-on-bold). This handles cursor-inside-italic, click italic.
    if (removeType && stripSurrounding(removeType)) return;

    // If no selection, expand to the word at the cursor so cursor-in-word
    // + bold/italic wraps the word (like every native editor).
    let from = sel.from;
    let to = sel.to;
    let text = selectedText;
    if (!text) {
      const word = view.state.wordAt(sel.from);
      if (word) {
        from = word.from;
        to = word.to;
        text = view.state.sliceDoc(from, to);
      } else {
        // Cursor in whitespace: insert empty markers, drop cursor between.
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: `${left}${right}` },
          selection: EditorSelection.cursor(sel.from + left.length),
        });
        view.focus();
        return;
      }
    }

    // Toggle case 1: the range is already wrapped — markers sit immediately
    // outside it. Clicking the same button removes them.
    //
    // Subtlety: for single-char markers (italic `*`), the chars adjacent to a
    // bold run (`**foo**`) are also `*`. We must check one position further
    // out to make sure we're not inside a longer marker run, otherwise
    // italicizing inside a bold span would strip a `*` from each `**`.
    const before = view.state.sliceDoc(Math.max(0, from - left.length), from);
    const after = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + right.length));
    const isPartOfLongerRun =
      left.length === 1 &&
      ((from - 2 >= 0 && view.state.sliceDoc(from - 2, from - 1) === left) ||
        (to + 1 < view.state.doc.length && view.state.sliceDoc(to + 1, to + 2) === right));
    if (before === left && after === right && !isPartOfLongerRun) {
      view.dispatch({
        changes: { from: from - left.length, to: to + right.length, insert: text },
        selection: EditorSelection.range(from - left.length, to - left.length),
      });
      view.focus();
      return;
    }

    // Toggle case 2: the range itself starts and ends with the markers
    // (e.g. user double-clicked and grabbed `*word*` whole). Strip them.
    if (
      text.startsWith(left) &&
      text.endsWith(right) &&
      text.length > left.length + right.length
    ) {
      const stripped = text.slice(left.length, text.length - right.length);
      view.dispatch({
        changes: { from, to, insert: stripped },
        selection: EditorSelection.range(from, from + stripped.length),
      });
      view.focus();
      return;
    }

    // Otherwise wrap. CommonMark forbids emphasis markers adjacent to
    // whitespace, so push any leading/trailing spaces back outside.
    const lead = text.match(/^\s*/)![0];
    const trail = text.match(/\s*$/)![0];
    const inner = text.slice(lead.length, text.length - trail.length);
    if (!inner) {
      view.focus();
      return;
    }
    const insert = `${lead}${left}${inner}${right}${trail}`;
    const innerStart = from + lead.length + left.length;
    view.dispatch({
      changes: { from, to, insert },
      selection: EditorSelection.range(innerStart, innerStart + inner.length),
    });
    view.focus();
  };

  const prefixLine = (prefix: string) => {
    const line = view.state.doc.lineAt(sel.from);
    const currentPrefixMatch = line.text.match(/^(#{1,6}\s+|[-*+]\s+|\d+\.\s+)/);
    const stripped = line.text.replace(/^(#{1,6}\s+|[-*+]\s+|\d+\.\s+)/, '');
    // Toggle: if current line already starts with the same prefix, remove it.
    const newText = currentPrefixMatch?.[1] === prefix ? stripped : `${prefix}${stripped}`;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: newText },
    });
    view.focus();
  };

  const stripPrefix = () => {
    const line = view.state.doc.lineAt(sel.from);
    const stripped = line.text.replace(/^(#{1,6}\s+|[-*+]\s+|\d+\.\s+)/, '');
    if (stripped === line.text) return;
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: stripped },
    });
    view.focus();
  };

  const insertSectionBreak = () => {
    // Insert `* * *` on its own line, with blank lines around it so it parses
    // cleanly as a horizontal rule regardless of surrounding context. If the
    // cursor is already on an empty line, just put the marker there.
    const line = view.state.doc.lineAt(sel.from);
    const onEmptyLine = line.text.trim() === '';
    if (onEmptyLine) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: '* * *' },
        selection: EditorSelection.cursor(line.from + 5),
      });
    } else {
      const insert = '\n\n* * *\n\n';
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: EditorSelection.cursor(sel.from + insert.length),
      });
    }
    view.focus();
  };

  switch (kind) {
    case 'bold': return wrap('**', '**', 'StrongEmphasis');
    case 'italic': return wrap('*', '*', 'Emphasis');
    case 'h1': return prefixLine('# ');
    case 'h2': return prefixLine('## ');
    case 'h3': return prefixLine('### ');
    case 'p': return stripPrefix();
    case 'ul': return prefixLine('- ');
    case 'ol': return prefixLine('1. ');
    case 'hr': return insertSectionBreak();
  }
}

function moveSection(dir: 'up' | 'down'): void {
  const doc = view.state.doc;
  const head = view.state.selection.main.head;
  const tree = syntaxTree(view.state);

  // Collect every ATX heading in document order with its line and level.
  // Source-of-truth comes from the markdown syntax tree, not regex on raw
  // text, so we can never accidentally slice a heading line in half.
  type Heading = { line: number; level: number };
  const headings: Heading[] = [];
  tree.iterate({
    enter(node) {
      const m = node.name.match(/^ATXHeading(\d)$/);
      if (m) {
        headings.push({
          line: doc.lineAt(node.from).number,
          level: parseInt(m[1], 10),
        });
        return false;
      }
    },
  });
  if (headings.length === 0) return;

  // Identify which heading the cursor is under: the latest heading whose
  // line is at or before the cursor's line.
  const cursorLine = doc.lineAt(head).number;
  let curIdx = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].line <= cursorLine) curIdx = i;
    else break;
  }
  if (curIdx < 0) return; // cursor sits before any heading

  const cur = headings[curIdx];

  // A section spans from its heading line down to (but not including) the
  // next heading at the same level or shallower. If none exists, the
  // section runs to end of document.
  const findSectionEndLine = (idx: number, level: number): number => {
    for (let i = idx + 1; i < headings.length; i++) {
      if (headings[i].level <= level) return headings[i].line - 1;
    }
    return doc.lines;
  };

  const curEndLine = findSectionEndLine(curIdx, cur.level);

  // Convert line numbers to character offsets. doc.line(N).from is the start
  // of line N; the start of line (endLine+1) is the position right after
  // the section's trailing newline.
  const offsetOfLineStart = (lineNum: number) =>
    lineNum > doc.lines ? doc.length : doc.line(lineNum).from;

  const curFrom = offsetOfLineStart(cur.line);
  const curTo = offsetOfLineStart(curEndLine + 1);

  if (dir === 'down') {
    // Find the next sibling-or-shallower heading.
    let nextIdx = -1;
    for (let i = curIdx + 1; i < headings.length; i++) {
      if (headings[i].level <= cur.level) {
        nextIdx = i;
        break;
      }
    }
    if (nextIdx < 0) return; // already last section at this level

    const next = headings[nextIdx];
    const nextEndLine = findSectionEndLine(nextIdx, next.level);
    const nextFrom = offsetOfLineStart(next.line);
    const nextTo = offsetOfLineStart(nextEndLine + 1);

    const curText = doc.sliceString(curFrom, curTo);
    const nextText = doc.sliceString(nextFrom, nextTo);

    // Replace [curFrom, nextTo] with [next, cur] — atomic swap.
    const cursorOffsetInSection = head - curFrom;
    const newCursor = curFrom + nextText.length + cursorOffsetInSection;
    view.dispatch({
      changes: { from: curFrom, to: nextTo, insert: nextText + curText },
      selection: EditorSelection.cursor(newCursor),
    });
  } else {
    // dir === 'up'
    let prevIdx = -1;
    for (let i = curIdx - 1; i >= 0; i--) {
      if (headings[i].level <= cur.level) {
        prevIdx = i;
        break;
      }
    }
    if (prevIdx < 0) return; // already first section at this level

    const prev = headings[prevIdx];
    const prevFrom = offsetOfLineStart(prev.line);
    // Previous section ends right where current section begins.
    const prevTo = curFrom;

    const curText = doc.sliceString(curFrom, curTo);
    const prevText = doc.sliceString(prevFrom, prevTo);

    const cursorOffsetInSection = head - curFrom;
    const newCursor = prevFrom + cursorOffsetInSection;
    view.dispatch({
      changes: { from: prevFrom, to: curTo, insert: curText + prevText },
      selection: EditorSelection.cursor(newCursor),
    });
  }
}

function toggleSourceMode(): void {
  currentMode = currentMode === 'live' ? 'source' : 'live';
  localStorage.setItem(MODE_KEY, currentMode);
  view.dispatch({
    effects: livePreviewCompartment.reconfigure(currentMode === 'live' ? livePreviewPlugin : []),
  });
  sourceToggleBtn.textContent = currentMode === 'live' ? 'Source' : 'Live';
  sourceToggleBtn.title = currentMode === 'live' ? 'Show raw markdown (Cmd+/)' : 'Show rendered (Cmd+/)';
  document.body.classList.toggle('mode-source', currentMode === 'source');
}

function setFont(kind: FontKind): void {
  currentFont = kind;
  localStorage.setItem(FONT_KEY, kind);
  view.dispatch({
    effects: fontCompartment.reconfigure(fontTheme(kind)),
  });
}

// Initialize button labels from persisted state.
sourceToggleBtn.textContent = currentMode === 'live' ? 'Source' : 'Live';
sourceToggleBtn.title = currentMode === 'live' ? 'Show raw markdown (Cmd+/)' : 'Show rendered (Cmd+/)';
if (currentMode === 'source') document.body.classList.add('mode-source');

document.querySelectorAll<HTMLButtonElement>('#toolbar button[data-fmt]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const fmt = btn.dataset.fmt!;
    applyFormat(fmt);
  });
});

sourceToggleBtn.addEventListener('click', toggleSourceMode);
folderNameBtn.addEventListener('click', handleOpenFolder);

window.api.onMenu('menu:new-file', async () => {
  if (await maybeWarnUnsaved() === 'cancel') return;
  setDoc('', null);
});
window.api.onMenu('menu:open-file', handleOpenFile);
window.api.onMenu('menu:open-folder', handleOpenFolder);
window.api.onMenu('menu:save', handleSave);
window.api.onMenu('menu:save-next-version', handleSaveNextVersion);
window.api.onMenu('menu:find', () => openSearchPanel(view));
window.api.onMenu('menu:replace', () => openSearchPanel(view));
window.api.onMenu('menu:format', (kind: unknown) => applyFormat(kind as string));
window.api.onMenu('menu:section-move', (dir: unknown) => moveSection(dir as 'up' | 'down'));
window.api.onMenu('menu:toggle-source', toggleSourceMode);
window.api.onMenu('menu:font', (kind: unknown) => setFont(kind as FontKind));

(async () => {
  const recent = await window.api.getRecent();
  if (recent.lastFolder) {
    try {
      const files = await window.api.listFolder(recent.lastFolder);
      state.folder = recent.lastFolder;
      state.files = files;
      renderFileList();
    } catch {
      /* folder gone — ignore */
    }
  }
  updateChromeState();
  updateStatus();
})();
