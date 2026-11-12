'use client';

/**
 * Imprime (o guarda como PDF desde el diálogo del navegador) solo el elemento dado,
 * en un iframe aislado con los mismos estilos de la app. El título del documento
 * es el nombre sugerido del PDF.
 */
export function printElement(element: HTMLElement, title: string) {
  const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map((node) => node.outerHTML)
    .join('');
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed',
    right: '0',
    bottom: '0',
    width: '0',
    height: '0',
    border: '0',
  });
  iframe.srcdoc = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title>${styles}<style>@page{size:A4;margin:12mm}html,body{background:#fff}body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${
    element.outerHTML
  }</body></html>`;
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    win.addEventListener('afterprint', () => setTimeout(() => iframe.remove(), 100));
    win.focus();
    win.print();
    // Respaldo por si el navegador no emite afterprint
    setTimeout(() => iframe.isConnected && iframe.remove(), 60_000);
  };
  document.body.appendChild(iframe);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
