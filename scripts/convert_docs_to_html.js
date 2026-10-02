const fs = require('fs');
const path = require('path');

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseMarkdown(md) {
  const lines = md.split(/\r?\n/);
  let html = '';
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockContent = [];
  let inTable = false;
  let tableHeader = [];
  let tableRows = [];
  let inList = false;
  let listType = 'ul';

  function closeList() {
    if (inList) {
      html += `</${listType}>\n`;
      inList = false;
    }
  }

  function closeTable() {
    if (inTable) {
      html += '<table>\n<thead><tr>\n';
      tableHeader.forEach(h => html += `<th>${inlineFormat(h)}</th>\n`);
      html += '</tr></thead>\n<tbody>\n';
      tableRows.forEach(row => {
        html += '<tr>\n';
        row.forEach(cell => html += `<td>${inlineFormat(cell)}</td>\n`);
        html += '</tr>\n';
      });
      html += '</tbody></table>\n';
      inTable = false;
      tableHeader = [];
      tableRows = [];
    }
  }

  function inlineFormat(text) {
    let s = escapeHtml(text);
    // Images: ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="doc-img" />');
    // Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    // Bold: **text**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic: *text*
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Inline code: `text`
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    return s;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.trim().startsWith('```')) {
      closeList();
      closeTable();
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
        codeBlockContent = [];
      } else {
        inCodeBlock = false;
        html += `<pre><code class="language-${codeBlockLang}">${escapeHtml(codeBlockContent.join('\n'))}</code></pre>\n`;
        codeBlockContent = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Horizontal rule
    if (/^(\*\*\*|---|___)$/.test(line.trim())) {
      closeList();
      closeTable();
      html += '<hr />\n';
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      closeList();
      closeTable();
      const level = hMatch[1].length;
      const text = hMatch[2];
      html += `<h${level}>${inlineFormat(text)}</h${level}>\n`;
      continue;
    }

    // Tables
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      closeList();
      const cells = line.split('|').map(c => c.trim()).slice(1, -1);
      if (!inTable) {
        inTable = true;
        tableHeader = cells;
      } else if (cells.every(c => /^:?-+:?$/.test(c))) {
        // Table separator row, ignore
      } else {
        tableRows.push(cells);
      }
      continue;
    } else {
      closeTable();
    }

    // Blockquote
    if (line.trim().startsWith('>')) {
      closeList();
      html += `<blockquote>${inlineFormat(line.trim().replace(/^>\s*/, ''))}</blockquote>\n`;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[*-]\s+(.*)$/);
    if (ulMatch) {
      if (!inList || listType !== 'ul') {
        closeList();
        inList = true;
        listType = 'ul';
        html += '<ul>\n';
      }
      html += `<li>${inlineFormat(ulMatch[2])}</li>\n`;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (olMatch) {
      if (!inList || listType !== 'ol') {
        closeList();
        inList = true;
        listType = 'ol';
        html += '<ol>\n';
      }
      html += `<li>${inlineFormat(olMatch[2])}</li>\n`;
      continue;
    }

    closeList();

    // Blank line
    if (!line.trim()) {
      continue;
    }

    // Regular paragraph
    html += `<p>${inlineFormat(line)}</p>\n`;
  }

  closeList();
  closeTable();

  return html;
}

function wrapInHtml5(title, content, relativeRoot = '../') {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - VNV-Bot</title>
  <style>
    :root {
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --text-main: #1e293b;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --bg-body: #f8fafc;
      --bg-card: #ffffff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: var(--text-main);
      background-color: var(--bg-body);
      line-height: 1.65;
      padding: 30px 20px;
    }
    .doc-container {
      max-width: 900px;
      margin: 0 auto;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 40px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.04);
    }
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
      color: var(--primary);
      font-weight: 600;
      font-size: 0.9rem;
      padding: 6px 14px;
      border-radius: 6px;
      background: #eff6ff;
      transition: background 0.15s;
    }
    .back-btn:hover { background: #dbeafe; }
    h1 { font-size: 1.75rem; color: #0f172a; margin-bottom: 16px; font-weight: 800; }
    h2 { font-size: 1.35rem; color: #0f172a; margin: 28px 0 14px; font-weight: 700; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; }
    h3 { font-size: 1.15rem; color: #1e293b; margin: 20px 0 10px; font-weight: 600; }
    h4 { font-size: 1rem; color: #334155; margin: 16px 0 8px; font-weight: 600; }
    p { font-size: 0.95rem; margin-bottom: 12px; color: #334155; }
    ul, ol { margin-left: 24px; margin-bottom: 16px; font-size: 0.95rem; }
    li { margin-bottom: 6px; color: #334155; }
    strong { color: #0f172a; }
    blockquote {
      border-left: 4px solid var(--primary);
      background: #eff6ff;
      padding: 12px 18px;
      border-radius: 6px;
      margin: 16px 0;
      color: #1e40af;
      font-size: 0.92rem;
    }
    pre {
      background: #0f172a;
      color: #f8fafc;
      padding: 16px 20px;
      border-radius: 8px;
      overflow-x: auto;
      margin: 16px 0;
      font-family: Consolas, Monaco, "Courier New", monospace;
      font-size: 0.88rem;
    }
    code {
      font-family: Consolas, Monaco, "Courier New", monospace;
      background: #f1f5f9;
      color: #0f172a;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.88rem;
    }
    pre code { background: transparent; padding: 0; color: inherit; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 0.9rem; }
    th, td { padding: 10px 14px; border: 1px solid var(--border); text-align: left; }
    th { background: #f8fafc; font-weight: 600; color: #1e293b; }
    tr:nth-child(even) td { background: #fafafa; }
    hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
    a { color: var(--primary); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .doc-img { max-width: 100%; border-radius: 8px; border: 1px solid var(--border); margin: 16px 0; }
  </style>
</head>
<body>
  <div class="doc-container">
    <div class="top-bar">
      <a href="${relativeRoot}HUONG_DAN_SU_DUNG.html" class="back-btn">⬅ Quay lại Cẩm Nang Sử Dụng</a>
      <span style="font-size: 0.82rem; color: var(--text-muted);">VNV-Bot v2.0 Docs</span>
    </div>
    ${content}
  </div>
</body>
</html>`;
}

// Convert files in docs/
const docsDir = path.join(__dirname, '../docs');
const distDocsDir = path.join(__dirname, '../dist/VNV-Bot-v2.0.0/docs');

const filesToConvert = [
  'HUONG_DAN_CHO_TRUONG_VUNG_MOI.md',
  'HUONG_DAN_SU_DUNG_NHANH.md',
  'GOOGLE_OAUTH_CONFIGURATION_GUIDE.md',
  'TAI_LIEU_TOAN_DIEN_VNV_BOT_V2.md'
];

filesToConvert.forEach(file => {
  const srcPath = path.join(docsDir, file);
  if (fs.existsSync(srcPath)) {
    const mdContent = fs.readFileSync(srcPath, 'utf8');
    const titleMatch = mdContent.match(/^#\s+(.*)$/m);
    const title = titleMatch ? titleMatch[1] : path.basename(file, '.md');
    const parsed = parseMarkdown(mdContent);
    const html = wrapInHtml5(title, parsed, '../');

    const outName = file.replace(/\.md$/, '.html');
    fs.writeFileSync(path.join(docsDir, outName), html, 'utf8');
    if (fs.existsSync(distDocsDir)) {
      fs.writeFileSync(path.join(distDocsDir, outName), html, 'utf8');
    }
    console.log(`Converted: ${file} -> ${outName}`);
  }
});
