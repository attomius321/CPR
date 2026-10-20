import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The bundled fonts (V29b, decision 180): served by CPR, fetched per script as the page uses it.
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
