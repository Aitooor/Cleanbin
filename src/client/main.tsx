import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import './styles/clean.css';
import App from './App';

async function bootstrap() {
  if (import.meta.env.VITE_DEMO_MODE === '1') {
    const { installDemoMode } = await import('./demo/demoBackend');
    installDemoMode();
  }

  const rootEl = document.getElementById('root');
  if (rootEl) {
    createRoot(rootEl).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
}

void bootstrap();
