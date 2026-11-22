// One shared <audio> element that plays a preview up to a time limit.
export class Clip {
  constructor() {
    this.a = new Audio();
    this.a.preload = 'auto';
    this.limit = 0;
    this.raf = 0;
    this.playing = false;
    this.onTick = null;   // (seconds) => void
    this.onState = null;  // (playing) => void
  }
  load(src) {
    if (this.a.getAttribute('src') !== src) { this.stop(); this.a.src = src; this.a.load(); }
  }
  // Call inside a click so later programmatic play() is allowed (iOS, multiplayer rounds).
  unlock() {
    const a = this.a;
    if (!a.getAttribute('src')) return;
    a.muted = true;
    const p = a.play();
    const done = () => { a.pause(); a.muted = false; };
    p ? p.then(done, () => { a.muted = false; }) : done();
  }
  async play(limit, from = 0) {
    this.stop();
    this.limit = limit;
    try { this.a.currentTime = from; } catch {}
    try { await this.a.play(); } catch (e) { this.set(false); throw e; }
    this.set(true);
    this.loop();
  }
  loop() {
    const t = this.a.currentTime;
    this.onTick?.(t);
    if (t >= this.limit || this.a.ended) { this.stop(); return; }
    this.raf = requestAnimationFrame(() => this.loop());
  }
  stop() {
    cancelAnimationFrame(this.raf);
    if (!this.a.paused) this.a.pause();
    this.set(false);
  }
  set(p) { if (p !== this.playing) { this.playing = p; this.onState?.(p); } }
}

export const clip = new Clip();
