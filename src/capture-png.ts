import { getFontEmbedCSS, toPng } from 'html-to-image';

// html-to-image freezes computed table/caption heights. In SVG foreignObject,
// Chromium lays out the caption again and can clip the last rows. Its embedded
// stylesheet option lets the export restore natural sizing without live DOM edits.
const exportLayoutCSS = `
  .wf-element.wf-interactive-hint {
    outline: none !important; box-shadow: none !important;
  }
  .wf-table-scroll {
    height: auto !important; block-size: auto !important;
    max-height: none !important; overflow: visible !important;
  }
  .wf-table-scroll :is(table, caption, thead, tbody, tfoot, tr, th, td) {
    height: auto !important; block-size: auto !important; max-height: none !important;
  }
`;

export async function capturePng(element: HTMLElement): Promise<string> {
  await element.ownerDocument.fonts.ready;
  const fontCSS = await getFontEmbedCSS(element);
  return toPng(element, {
    backgroundColor: '#ffffff', pixelRatio: 2,
    fontEmbedCSS: `${fontCSS}\n${exportLayoutCSS}`,
    style: { margin: '0', transform: 'none' },
    filter: node => node.dataset?.exportIgnore !== 'true',
  });
}
