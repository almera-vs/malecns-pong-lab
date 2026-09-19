/**
 * Define overlapping binocular image crops as an experimental sensor, without claiming ommatidial
 * optics.
 */
export const RETINA_WIDTH = 8;
export const RETINA_HEIGHT = 4;
export const RETINA_CHANNELS = RETINA_WIDTH * RETINA_HEIGHT * 2;
const EYE_CROP = 0.86;
const integralCache = new WeakMap<HTMLCanvasElement, Float64Array>();

/**
 * Integrate piecewise-constant pixel luminance over each channel area to avoid point-sampling loss of
 * small objects.
 */
export function poolBinocularLuminance(pixels: Uint8ClampedArray, width: number, height: number, integral: Float64Array = new Float64Array((width + 1) * (height + 1))): Float32Array {
  if (width < 1 || height < 1 || pixels.length !== width * height * 4 || integral.length !== (width + 1) * (height + 1)) throw new Error("Invalid retina image dimensions");
  const stride = width + 1;
  // Reuse a summed-area representation to compute all channel means in linear image time plus channel
  // count.
  integral.fill(0, 0, stride);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    integral[(y + 1) * stride] = 0;
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      sum += (0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2]) / 255;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
    }
  }
  // Interpolate the integral image at fractional boundaries to include partial-pixel areas under the
  // piecewise-constant image model.
  const at = (x: number, y: number): number => {
    x = Math.max(0, Math.min(width, x)); y = Math.max(0, Math.min(height, y));
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(width, x0 + 1), y1 = Math.min(height, y0 + 1);
    const fx = x - x0, fy = y - y0;
    return (1 - fy) * ((1 - fx) * integral[y0 * stride + x0] + fx * integral[y0 * stride + x1])
      + fy * ((1 - fx) * integral[y1 * stride + x0] + fx * integral[y1 * stride + x1]);
  };
  const frame = new Float32Array(RETINA_CHANNELS);
  const cropWidth = width * EYE_CROP;
  const cellWidth = cropWidth / RETINA_WIDTH, cellHeight = height / RETINA_HEIGHT;
  for (let eye = 0; eye < 2; eye++) {
    const cropX = eye === 0 ? 0 : width - cropWidth;
    for (let row = 0; row < RETINA_HEIGHT; row++) {
      for (let col = 0; col < RETINA_WIDTH; col++) {
        const x0 = cropX + col * cellWidth, x1 = x0 + cellWidth;
        const y0 = row * cellHeight, y1 = y0 + cellHeight;
        frame[eye * 32 + row * 8 + col] = Math.max(0, Math.min(1, (at(x1, y1) - at(x0, y1) - at(x1, y0) + at(x0, y0)) / (cellWidth * cellHeight)));
      }
    }
  }
  return frame;
}

export function encodeBinocularRetina(canvas: HTMLCanvasElement): Float32Array {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Retina sampling is unavailable");
  const size = (canvas.width + 1) * (canvas.height + 1);
  let integral = integralCache.get(canvas);
  if (!integral || integral.length !== size) {
    integral = new Float64Array(size);
    integralCache.set(canvas, integral);
  }
  return poolBinocularLuminance(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, integral);
}

/**
 * Display the committed image and its corresponding channel measurements for inspection of the sensory
 * interface.
 */
export function drawRetina(canvas: HTMLCanvasElement, frame: Float32Array, court?: HTMLCanvasElement): void {
  if (frame.length !== RETINA_CHANNELS) throw new Error("Expected 64 binocular luminance channels");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Retina rendering is unavailable");
  context.fillStyle = "#02060c";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const half = canvas.width / 2;
  const gridY = court ? canvas.height - 72 : 0;
  const gridHeight = canvas.height - gridY;
  for (let eye = 0; eye < 2; eye++) {
    const x = eye * half;
    if (court) {
      context.fillStyle = eye === 0 ? "#67e8f9" : "#f0abfc";
      context.font = "13px system-ui, sans-serif";
      context.fillText(`${eye === 0 ? "LEFT" : "RIGHT"} EYE · sampled court image`, x + 10, 18);
      const crop = court.width * EYE_CROP;
      context.imageSmoothingEnabled = true;
      context.drawImage(court, eye === 0 ? 0 : court.width - crop, 0, crop, court.height, x + 8, 26, half - 16, gridY - 50);
      context.fillStyle = "#8ea8c7";
      context.fillText("8 × 4 channels · display contrast √luminance", x + 10, gridY - 8);
    }
    for (let row = 0; row < RETINA_HEIGHT; row++) {
      for (let col = 0; col < RETINA_WIDTH; col++) {
        // Apply contrast enhancement only to the visualization; neural input retains the untransformed
        // channel means.
        const value = Math.sqrt(Math.max(0, Math.min(1, frame[eye * 32 + row * 8 + col])));
        context.fillStyle = `rgb(${Math.round(10 + value * 245)},${Math.round(22 + value * 220)},${Math.round(40 + value * 205)})`;
        context.fillRect(x + col * half / 8 + 1, gridY + row * gridHeight / 4 + 1, half / 8 - 2, gridHeight / 4 - 2);
      }
    }
  }
  canvas.setAttribute("data-channel-range", `${Math.min(...frame).toFixed(5)},${Math.max(...frame).toFixed(5)}`);
}
