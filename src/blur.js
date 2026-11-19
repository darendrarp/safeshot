// SafeShot — guided blur editor.
// The AI report tells the user WHAT is sensitive and WHERE (in words, e.g.
// "top-right corner"). The user draws rectangles over those regions; blur is
// baked into the exported PNG on a canvas. No bounding-box hallucination:
// the human stays in control of exactly what gets hidden.

export class BlurEditor {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.image = null;
    this.rects = []; // {x, y, w, h} in canvas pixels
    this.onChange = onChange;
    this.dragging = null;
    this.scale = 1; // canvas px per displayed px
    this._bind();
  }

  loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        this.image = img;
        this.rects = [];
        // Cap working resolution for performance; export keeps full res.
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        this.canvas.width = Math.round(img.naturalWidth * scale);
        this.canvas.height = Math.round(img.naturalHeight * scale);
        this.render();
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  get displayScale() {
    const rect = this.canvas.getBoundingClientRect();
    return this.canvas.width / rect.width;
  }

  _bind() {
    const toCanvas = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * this.displayScale,
        y: (e.clientY - rect.top) * this.displayScale,
      };
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.image) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.dragging = { ...toCanvas(e), w: 0, h: 0 };
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const p = toCanvas(e);
      this.dragging.w = p.x - this.dragging.x;
      this.dragging.h = p.y - this.dragging.y;
      this.render(this.dragging);
    });
    this.canvas.addEventListener('pointerup', () => {
      if (!this.dragging) return;
      const r = this._normalize(this.dragging);
      if (r.w > 8 && r.h > 8) {
        this.rects.push(r);
        this.onChange?.(this.rects.length);
      }
      this.dragging = null;
      this.render();
    });
  }

  _normalize(r) {
    const x = Math.min(r.x, r.x + r.w);
    const y = Math.min(r.y, r.y + r.h);
    return {
      x: Math.max(0, x),
      y: Math.max(0, y),
      w: Math.min(Math.abs(r.w), this.canvas.width - Math.max(0, x)),
      h: Math.min(Math.abs(r.h), this.canvas.height - Math.max(0, y)),
    };
  }

  undo() {
    this.rects.pop();
    this.render();
    this.onChange?.(this.rects.length);
  }

  clear() {
    this.rects = [];
    this.render();
    this.onChange?.(0);
  }

  // Pixelate-blur: draw the region tiny, then scale it back up with
  // smoothing off. Cheap, deterministic, and irreversible in the export.
  _blurRegion(ctx, src, r, blockPx = 12) {
    const w = Math.max(1, Math.round(r.w));
    const h = Math.max(1, Math.round(r.h));
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.round(w / blockPx));
    tmp.height = Math.max(1, Math.round(h / blockPx));
    const tctx = tmp.getContext('2d');
    tctx.drawImage(src, r.x, r.y, w, h, 0, 0, tmp.width, tmp.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, r.x, r.y, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  render(draft = null) {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this.image) return;
    ctx.drawImage(this.image, 0, 0, canvas.width, canvas.height);
    for (const r of this.rects) this._blurRegion(ctx, canvas, r);
    // Outline blurred regions so the user sees what is hidden.
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    for (const r of this.rects) ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    if (draft) {
      const r = this._normalize(draft);
      ctx.strokeStyle = '#38bdf8';
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.setLineDash([]);
    }
  }

  /** Export the blurred image at full original resolution. */
  exportPng() {
    if (!this.image) return null;
    const out = document.createElement('canvas');
    out.width = this.image.naturalWidth;
    out.height = this.image.naturalHeight;
    const octx = out.getContext('2d');
    octx.drawImage(this.image, 0, 0);
    const k = this.image.naturalWidth / this.canvas.width;
    for (const r of this.rects) {
      this._blurRegion(octx, out, {
        x: r.x * k,
        y: r.y * k,
        w: r.w * k,
        h: r.h * k,
      });
    }
    return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
  }
}
