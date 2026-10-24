// Lector de QR con la cámara del celular (BarcodeDetector si existe; si no, jsQR).
export class QrScanner {
  constructor(video, onCode) {
    this.video = video; this.onCode = onCode;
    this.stream = null; this.raf = 0; this.running = false; this.last = 0;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.detector = null; this.track = null;
  }
  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara (se necesita HTTPS).');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', ''); this.video.muted = true;
    await this.video.play();
    try { if ('BarcodeDetector' in window) this.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch { this.detector = null; }
    this.running = true;
    this.loop();
  }
  get torchSupported() { try { return !!this.track?.getCapabilities?.().torch; } catch { return false; } }
  async setTorch(on) { await this.track.applyConstraints({ advanced: [{ torch: !!on }] }); }
  loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (now - this.last < 110 || this.video.readyState < 2) return;
    this.last = now;
    this.scanFrame().catch(() => {});
  };
  async scanFrame() {
    const v = this.video;
    if (this.detector) {
      const codes = await this.detector.detect(v);
      if (codes.length) this.onCode(codes[0].rawValue);
      return;
    }
    const w = v.videoWidth, hgt = v.videoHeight;
    if (!w) return;
    const scale = Math.min(1, 640 / w);
    this.canvas.width = Math.round(w * scale); this.canvas.height = Math.round(hgt * scale);
    this.ctx.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
    const img = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const code = globalThis.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    if (code && code.data) this.onCode(code.data);
  }
  stop() {
    this.running = false; cancelAnimationFrame(this.raf);
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch { /* */ }
    this.stream = null; try { this.video.srcObject = null; } catch { /* */ }
  }
}
