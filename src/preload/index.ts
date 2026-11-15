import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, EVENTS, type ApiClient, type Events } from '../shared/ipc';

const api: Record<string, unknown> = {};
for (const channel of CHANNELS) {
  api[channel] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
}
api.on = <E extends keyof Events>(event: E, listener: (payload: Events[E]) => void) => {
  if (!EVENTS.includes(event)) throw new Error('Unknown event');
  const wrapped = (_: unknown, payload: Events[E]) => listener(payload);
  ipcRenderer.on(event, wrapped);
  return () => ipcRenderer.removeListener(event, wrapped);
};

contextBridge.exposeInMainWorld('api', api as ApiClient);
