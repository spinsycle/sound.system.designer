// Copyright (C) 2026 Spinsycle
// SPDX-License-Identifier: AGPL-3.0-only
// Transports for the probe: USB serial (through the desktop shell's Rust commands) and WebSocket (WiFi). Each hands lines
// to a callback and takes lines to send; the protocol is in session.ts.
import { isDesktop } from '../desktop';

export interface Link {
  send(line: string): void;
  close(): void;
}

export const WIFI_DEFAULT_HOST = 'driverprobe.local';

export async function listUsbPorts(): Promise<string[]> {
  if (!isDesktop()) return [];
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string[]>('probe_ports');
}

export async function openUsb(port: string, onLine: (l: string) => void, onClose: () => void): Promise<Link> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const offLine = await listen<string>('probe-line', (e) => onLine(e.payload));
  const offClose = await listen('probe-closed', () => onClose());
  try {
    await invoke('probe_open', { port });
  } catch (e) {
    offLine();
    offClose();
    throw new Error(`Could not open ${port}: ${String(e)}`);
  }
  return {
    send: (line) => void invoke('probe_write', { line }).catch(() => onClose()),
    close: () => {
      offLine();
      offClose();
      void invoke('probe_close');
    },
  };
}

/** Resolves once the socket is open; rejects after timeoutMs. One text frame is one protocol line. */
export function openWs(host: string, onLine: (l: string) => void, onClose: () => void, timeoutMs = 4000): Promise<Link> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://${host}:81/`);
    } catch (e) {
      return reject(new Error(`Bad address ${host}.`));
    }
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`No probe answered at ${host}.`));
    }, timeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve({ send: (line) => ws.readyState === WebSocket.OPEN && ws.send(line), close: () => ws.close() });
    };
    ws.onmessage = (e) => typeof e.data === 'string' && onLine(e.data);
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Could not reach a probe at ${host}.`));
    };
    ws.onclose = () => onClose();
  });
}

/**
 * Looks for a probe on each serial port: opens it and asks hello (a board that just reset needs a moment, so the question is
 * repeated for up to `waitMs`). Resolves with the first port that answers, still open, or null.
 */
export async function detectUsb(onLine: (l: string) => void, onClose: () => void, waitMs = 3500): Promise<{ port: string; link: Link } | null> {
  for (const port of await listUsbPorts()) {
    let answered = false;
    let link: Link;
    try {
      link = await openUsb(port, (l) => {
        if (l.includes('"t":"hello"')) answered = true;
        onLine(l);
      }, onClose);
    } catch {
      continue;
    }
    const until = Date.now() + waitMs;
    while (!answered && Date.now() < until) {
      link.send('{"t":"hello"}');
      await new Promise((r) => setTimeout(r, 500));
    }
    if (answered) return { port, link };
    link.close();
  }
  return null;
}
