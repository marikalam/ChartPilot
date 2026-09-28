export type NamedText = { name: string; text: string };

// Deterministic rendering: same documents in the same order produce the same
// bytes, which is what keeps the prompt cache hitting.
export function renderDocuments(label: string, docs: NamedText[]): string {
  const body = docs
    .filter((d) => d.text.trim())
    .map((d, i) => `<document index="${i + 1}" name="${escapeAttr(d.name)}">\n${d.text.trim()}\n</document>`)
    .join('\n\n');
  return `<${label}>\n${body}\n</${label}>`;
}

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
