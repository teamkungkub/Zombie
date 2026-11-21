export function renderPixelLimit(width: number, height: number, deviceRatio: number, mobile: boolean, quality: boolean) {
  const pixelBudget = mobile ? 1_300_000 : 2_650_000;
  const sharpness = quality ? (mobile ? 1.15 : 1.5) : 1;
  return Math.max(0.35, Math.min(deviceRatio, sharpness, Math.sqrt(pixelBudget / Math.max(1, width * height))));
}

/** Sample rendered frames and change scale gradually so quality does not oscillate. */
export class RenderBudget {
  private frames = 0;
  private elapsed = 0;
  private highRefreshFrames = 0;
  private fastWindows = 0;
  private highRefresh = false;
  scale = 1;

  reset() {
    this.frames = this.elapsed = this.highRefreshFrames = this.fastWindows = 0;
    this.highRefresh = false;
  }

  sample(frameTime: number, prefer120: boolean) {
    if (frameTime <= 0 || frameTime > 0.75) {
      this.reset();
      return false;
    }
    this.frames++;
    this.elapsed += frameTime;
    if (frameTime < 0.01) this.highRefreshFrames++;
    if (this.elapsed < 0.8) return false;
    const frameAverage = this.elapsed / this.frames;
    // Browsers don't expose the active display refresh rate directly.
    this.highRefresh ||= this.highRefreshFrames * 5 >= this.frames;
    this.frames = this.elapsed = this.highRefreshFrames = 0;
    const previous = this.scale;
    const target = prefer120 || this.highRefresh ? 1 / 120 : 1 / 60;
    if (frameAverage > target * 1.18) {
      this.scale = Math.max(0.63, this.scale - (frameAverage > target * 2.2 ? 0.16 : 0.09));
      this.fastWindows = 0;
    } else if (frameAverage < target * 1.025 && this.scale < 1) {
      if (++this.fastWindows >= 4) {
        this.scale = Math.min(1, this.scale + 0.06);
        this.fastWindows = 0;
      }
    } else this.fastWindows = 0;
    return previous !== this.scale;
  }
}
