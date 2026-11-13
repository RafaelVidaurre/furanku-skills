// Markdown text written by agents or people, rendered for the reviewer. The text is untrusted:
// marked turns it into HTML, then DOMPurify keeps only the formatting tags and attributes below,
// so raw HTML, scripts, styles, images, forms and event handlers never reach the page.
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { html } from './core.js';

const marked = new Marked({ gfm: true, breaks: true });
const purify = DOMPurify(window);
const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'];
const ALLOWED_ATTR = ['href', 'title', 'start', 'align'];
// Catalog links (#/...) stay in the app; anything else opens in a new tab without a referrer.
purify.addHook('afterSanitizeAttributes', (n) => {
  if (n.tagName === 'A' && !n.getAttribute('href')?.startsWith('#')) { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
});

export const renderMarkdown = (text) => purify.sanitize(marked.parse(text), { ALLOWED_TAGS, ALLOWED_ATTR });

export function Markdown({ text, label }) {
  return html`<div class="md" aria-label=${label} dangerouslySetInnerHTML=${{ __html: renderMarkdown(text) }}></div>`;
}
