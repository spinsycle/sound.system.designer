// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The exe's web mode serves this page from 127.0.0.1 and quits when these pings stop; anywhere else the request just 404s.
const ping = (): void => void fetch('/__ping').catch(() => undefined);
ping();
setInterval(ping, 5000);
