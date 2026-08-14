import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

// The whole app is mounted under /app-v2/ (see vite.config.ts base + Express
// server route wiring). react-router's basename is what tells the router to
// treat /app-v2 as its root.
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing from index.html');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter basename="/app-v2">
      <App />
    </BrowserRouter>
  </StrictMode>,
);
