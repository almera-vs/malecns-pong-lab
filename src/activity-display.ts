import type { GraphNode } from "./types";

export const MAX_ACTIVITY_MARKERS = 2048;
export const MAX_ACTIVITY_EDGES = 384;
export const SECTION_COLORS: Record<GraphNode["section"], string> = {
  optic: "#37d4d8", central: "#a6b0bf", vnc: "#b07b4a", motor: "#f0a266", other: "#566575",
};

/**
 * Subsample activity for rendering while preserving the simulation and quantitative spike statistics.
 */
export function sampleActivity<T>(items: readonly T[], limit: number): readonly T[] {
  if (items.length <= limit) return items;
  if (limit <= 0) return [];
  return Array.from({ length: limit }, (_, i) => items[Math.floor(i * items.length / limit)]);
}

/**
 * Bin the supplied spike IDs by anatomical section and horizontal pixel; browser input is already
 * worker-sampled.
 */
export class SpikeRaster {
  private readonly context: CanvasRenderingContext2D;
  private readonly sections = Object.keys(SECTION_COLORS) as GraphNode["section"][];
  private readonly bins: Uint8Array;
  private sectionById = new Uint8Array(0);

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Raster rendering is unavailable");
    this.context = context;
    this.bins = new Uint8Array(canvas.width * this.sections.length);
    this.clear();
  }

  setGraph(nodes: GraphNode[]): void {
    this.sectionById = Uint8Array.from(nodes, (node) => this.sections.indexOf(node.section));
    this.clear();
  }

  clear(): void {
    this.context.fillStyle = "#07101d";
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  append(spikes: readonly number[], nodeCount: number): void {
    const { context, canvas } = this;
    const rowHeight = 3;
    // Shift the raster image once per batch so historical display cost does not grow with recording
    // duration.
    context.drawImage(canvas, 0, rowHeight, canvas.width, canvas.height - rowHeight, 0, 0, canvas.width, canvas.height - rowHeight);
    context.fillStyle = "#07101d";
    context.fillRect(0, canvas.height - rowHeight, canvas.width, rowHeight);
    this.bins.fill(0);
    for (const id of spikes) {
      if (id < 0 || id >= nodeCount) continue;
      const section = this.sectionById[id] ?? 4;
      const x = Math.min(canvas.width - 1, Math.floor(id * canvas.width / nodeCount));
      this.bins[section * canvas.width + x] = 1;
    }
    // Bound raster drawing by pixel width and anatomical categories rather than spike multiplicity.
    for (let section = 0; section < this.sections.length; section++) {
      context.fillStyle = SECTION_COLORS[this.sections[section]];
      for (let x = 0; x < canvas.width; x++) {
        if (this.bins[section * canvas.width + x]) context.fillRect(x, canvas.height - rowHeight, 1, 2);
      }
    }
  }
}
