import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, LevelFormat,
} from 'docx';

const FONT = 'Calibri';
const BODY_SIZE = 24; // 12pt in half-points (docx unit)
const SPACING = { after: 160, line: 276 }; // 1.15x line spacing

// ── Inline formatter ────────────────────────────────────────────────────────
// Splits text on **bold** and *italic* spans, returns docx TextRuns.
function parseInline(text: string): TextRun[] {
  const parts = text.split(/(\*\*[^*]+?\*\*|\*[^*]+?\*)/);
  const runs: TextRun[] = [];
  for (const part of parts) {
    if (!part) continue;
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) {
      runs.push(new TextRun({ text: bold[1], bold: true, font: FONT, size: BODY_SIZE }));
      continue;
    }
    const italic = part.match(/^\*([^*]+)\*$/);
    if (italic) {
      runs.push(new TextRun({ text: italic[1], italics: true, font: FONT, size: BODY_SIZE }));
      continue;
    }
    runs.push(new TextRun({ text: part, font: FONT, size: BODY_SIZE }));
  }
  return runs.length ? runs : [new TextRun({ text, font: FONT, size: BODY_SIZE })];
}

// ── Block parser ─────────────────────────────────────────────────────────────
type Block =
  | { kind: 'h1' | 'h2' | 'h3'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'number'; text: string }
  | { kind: 'blockquote'; text: string }
  | { kind: 'hr' };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let paraLines: string[] = [];

  function flushPara() {
    if (paraLines.length) {
      blocks.push({ kind: 'paragraph', text: paraLines.join(' ') });
      paraLines = [];
    }
  }

  for (const line of lines) {
    // Headings (check longest prefix first so ## isn't caught by #)
    const h3 = line.match(/^### (.+)$/);
    if (h3) { flushPara(); blocks.push({ kind: 'h3', text: h3[1] }); continue; }
    const h2 = line.match(/^## (.+)$/);
    if (h2) { flushPara(); blocks.push({ kind: 'h2', text: h2[1] }); continue; }
    const h1 = line.match(/^# (.+)$/);
    if (h1) { flushPara(); blocks.push({ kind: 'h1', text: h1[1] }); continue; }

    // Horizontal rule — must come before bullet so `* * *` isn't parsed as a bullet
    if (/^\s*(\* \* \*|\*\*\*|---)\s*$/.test(line)) {
      flushPara(); blocks.push({ kind: 'hr' }); continue;
    }

    // Bullet list (-, *, +)
    const bullet = line.match(/^[-*+] (.+)$/);
    if (bullet) { flushPara(); blocks.push({ kind: 'bullet', text: bullet[1] }); continue; }

    // Numbered list
    const num = line.match(/^\d+\. (.+)$/);
    if (num) { flushPara(); blocks.push({ kind: 'number', text: num[1] }); continue; }

    // Blockquote
    const bq = line.match(/^> (.+)$/);
    if (bq) { flushPara(); blocks.push({ kind: 'blockquote', text: bq[1] }); continue; }

    // Blank line — flush accumulated paragraph
    if (line.trim() === '') { flushPara(); continue; }

    // Regular paragraph text — accumulate across soft-wrapped lines
    paraLines.push(line.trim());
  }
  flushPara();
  return blocks;
}

// ── Block → docx Paragraph ───────────────────────────────────────────────────
function toParagraphs(blocks: Block[]): Paragraph[] {
  return blocks.map(block => {
    switch (block.kind) {
      case 'h1':
        return new Paragraph({ heading: HeadingLevel.HEADING_1, children: parseInline(block.text) });
      case 'h2':
        return new Paragraph({ heading: HeadingLevel.HEADING_2, children: parseInline(block.text) });
      case 'h3':
        return new Paragraph({ heading: HeadingLevel.HEADING_3, children: parseInline(block.text) });
      case 'hr':
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200, after: 200 },
          children: [new TextRun({ text: '* * *', font: FONT, size: BODY_SIZE })],
        });
      case 'bullet':
        return new Paragraph({
          numbering: { reference: 'goatpad-bullet', level: 0 },
          children: parseInline(block.text),
        });
      case 'number':
        return new Paragraph({
          numbering: { reference: 'goatpad-number', level: 0 },
          children: parseInline(block.text),
        });
      case 'blockquote':
        return new Paragraph({
          indent: { left: 720 },
          spacing: SPACING,
          children: [new TextRun({ text: block.text, italics: true, font: FONT, size: BODY_SIZE })],
        });
      case 'paragraph':
        return new Paragraph({ spacing: SPACING, children: parseInline(block.text) });
    }
  });
}

// ── Public API ───────────────────────────────────────────────────────────────
export async function markdownToDocxBuffer(markdown: string): Promise<Buffer> {
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'goatpad-bullet',
          levels: [{
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          }],
        },
        {
          reference: 'goatpad-number',
          levels: [{
            level: 0,
            format: LevelFormat.DECIMAL,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          }],
        },
      ],
    },
    sections: [{ children: toParagraphs(parseBlocks(markdown)) }],
  });

  return Packer.toBuffer(doc);
}
