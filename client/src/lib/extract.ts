// Turns an uploaded file into plain text in the browser, so the rulebook never
// has to be converted by hand. Supports text/markdown/HTML, Word and PDF.
export async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.docx')) {
    const { default: mammoth } = await import('mammoth/mammoth.browser.min.js');
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return tidy(value);
  }

  if (name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      pages.push(`[Page ${i}]\n${text.trim()}`);
    }
    return tidy(pages.join('\n\n'));
  }

  const text = await file.text();
  if (name.endsWith('.html') || name.endsWith('.htm')) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return tidy(doc.body.innerText || doc.body.textContent || '');
  }
  return tidy(text);
}

export const ACCEPTED_FILES = '.txt,.md,.markdown,.csv,.html,.htm,.docx,.pdf';

function tidy(s: string) {
  return s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
