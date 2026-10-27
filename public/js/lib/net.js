// WebSocket-Verbindung zum Spielraum: automatischer Reconnect, Uhr-Abgleich mit dem Server
import { netStatus } from './dom.js';

export class Conn {
  constructor({ code, token, as, onState, onEvent, onHello, onJoined, onError, onGone, onKicked }) {
    Object.assign(this, { code, token, as, onState, onEvent, onHello, onJoined, onError, onGone, onKicked });
    this.offset = 0; // serverNow − Date.now()
    this.tries = 0;
    this.closed = false;
    this.queue = [];
    this.open();
    this.onVis = () => { if (document.visibilityState === 'visible' && (!this.ws || this.ws.readyState > 1)) this.reconnectNow(); };
    document.addEventListener('visibilitychange', this.onVis);
    window.addEventListener('online', this.onVis);
  }

  url() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  open() {
    if (this.closed) return;
    clearTimeout(this.retryT);
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      netStatus('');
      ws.send(JSON.stringify({ t: 'hello', code: this.code, token: this.token || undefined, as: this.as }));
      this.pingT = setInterval(() => this.send({ t: 'ping' }), 20000);
    };
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.serverNow) this.offset = m.serverNow - Date.now();
      if (m.view?.serverNow) this.offset = m.view.serverNow - Date.now();
      switch (m.t) {
        case 'hello': this.onHello?.(m); this.flush(); break;
        case 'state': this.onState?.(m.view); break;
        case 'event': this.onEvent?.(m); break;
        case 'joined': this.token = m.token; this.onJoined?.(m); break;
        case 'error': this.onError?.(m.msg); break;
        case 'gone': this.closed = true; this.onGone?.(m.msg); break;
        case 'kicked': this.token = null; this.onKicked?.(m.msg); break;
      }
    };
    ws.onclose = () => {
      clearInterval(this.pingT);
      if (this.closed) return;
      this.tries++;
      if (this.tries > 1) netStatus('📡 Verbindung weg – verbinde neu …');
      const wait = Math.min(8000, 300 * 2 ** Math.min(this.tries, 5));
      this.retryT = setTimeout(() => this.open(), wait);
    };
    ws.onerror = () => {};
  }

  reconnectNow() {
    if (this.closed) return;
    try { this.ws?.close(); } catch {}
    this.tries = 0;
    this.open();
  }

  flush() {
    while (this.queue.length) this.send(this.queue.shift());
  }

  send(msg) {
    if (this.ws?.readyState === 1) { this.ws.send(JSON.stringify(msg)); return true; }
    if (msg.t !== 'ping' && msg.t !== 'hello') this.queue.push(msg);
    return false;
  }

  act(a, extra = {}) { return this.send({ t: 'act', a, ...extra }); }

  now() { return Date.now() + this.offset; }

  close() {
    this.closed = true;
    clearTimeout(this.retryT);
    clearInterval(this.pingT);
    document.removeEventListener('visibilitychange', this.onVis);
    window.removeEventListener('online', this.onVis);
    try { this.ws?.close(); } catch {}
    netStatus('');
  }
}
