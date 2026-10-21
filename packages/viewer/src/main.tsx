import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The bundled fonts (V29b, decision 180): served by Symbiote, fetched per script as the page uses it.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App.js';

/**
 * The page draws once its fonts' Latin faces are in (from Symbiote's own server, in milliseconds), or
 * after `FONT_WAIT_MS`: its first frame is in Geist, not the browser's default font for a moment.
 */
const FONT_WAIT_MS = 1_000;
const fonts = Promise.all([
  document.fonts.load("13px 'Geist Variable'"),
  document.fonts.load("13px 'Geist Mono Variable'"),
]).catch(() => undefined);

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
const shown = root;
void Promise.race([fonts, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).then(() =>
  createRoot(shown).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
