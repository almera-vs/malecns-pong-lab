import { MALE_CNS_SWCS } from "./data-loader";
import type { GraphNode, GraphSummary, NeuronSnapshot, VisualizationFrame } from "./types";
import { MAX_ACTIVITY_EDGES, MAX_ACTIVITY_MARKERS, sampleActivity, SECTION_COLORS } from "./activity-display";

export type PopulationFilters = Record<GraphNode["population"], boolean>;

/**
 * Maintain a 2D anatomical section by projecting known soma locations onto x/z; this display omits
 * depth and missing positions.
 */
export class ConnectomeView {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly baseLayer: HTMLCanvasElement;
  private readonly resizeObserver: ResizeObserver;
  private graph: GraphSummary;
  private filters: PopulationFilters = { visual: true, central: true, descending: true, other: true };
  private selected: number | null = null;
  private frame: VisualizationFrame | null = null;
  private screenX = new Float32Array(0);
  private screenY = new Float32Array(0);
  private renderIds: number[] = [];
  private morphologySegments: number[] = [];
  private baseWidth = 0;
  private baseHeight = 0;
  private readonly onSelect: (nodeId: number, node: GraphNode) => void;

  constructor(private readonly host: HTMLElement, graph: GraphSummary, onSelect: (nodeId: number, node: GraphNode) => void) {
    this.graph = graph;
    this.onSelect = onSelect;
    host.replaceChildren();
    this.canvas = document.createElement("canvas");
    this.canvas.id = "brain-canvas";
    this.canvas.setAttribute("aria-label", "Persistent 2D MaleCNS anatomical section with region-colored neurons and live activity");
    host.appendChild(this.canvas);
    this.context = this.canvas.getContext("2d");
    this.baseLayer = document.createElement("canvas");
    this.canvas.addEventListener("click", this.handleClick);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  setGraph(graph: GraphSummary): void {
    this.graph = graph;
    this.selected = null;
    this.frame = null;
    this.removeMorphology();
    this.rebuildBaseLayer();
    this.draw();
  }

  setFilters(filters: Partial<PopulationFilters>): void {
    this.filters = { ...this.filters, ...filters };
    this.rebuildBaseLayer();
    this.draw();
  }

  update(frame: VisualizationFrame): void {
    this.frame = frame;
    this.draw();
  }

  async loadMorphology(snapshot: NeuronSnapshot): Promise<number> {
    if (!snapshot.morphologyAvailable || !this.graph.coordinateTransform) return 0;
    const response = await fetch(`${MALE_CNS_SWCS}${encodeURIComponent(snapshot.bodyId)}.swc`);
    if (!response.ok) throw new Error(`SWC download failed (${response.status})`);
    const text = await response.text();
    const transform = this.graph.coordinateTransform;
    const points = new Map<number, [number, number, number]>();
    const rawSegments: Array<[[number, number, number], [number, number, number]]> = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const values = trimmed.split(/\s+/).map(Number);
      if (values.length < 7 || values.some((value, index) => index < 6 && !Number.isFinite(value))) continue;
      const [id, , x, y, z, , parent] = values;
      const normalized: [number, number, number] = [
        (x - transform.center[0]) / transform.scale,
        (y - transform.center[1]) / transform.scale,
        (z - transform.center[2]) / transform.scale,
      ];
      points.set(id, normalized);
      if (parent >= 0 && points.has(parent)) rawSegments.push([points.get(parent)!, normalized]);
    }
    this.removeMorphology();
    for (const [[x1, , z1], [x2, , z2]] of rawSegments) {
      this.morphologySegments.push(this.projectX(x1), this.projectZ(z1), this.projectX(x2), this.projectZ(z2));
    }
    this.draw();
    return this.morphologySegments.length / 4;
  }

  removeMorphology(): void {
    this.morphologySegments = [];
    this.draw();
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(width * dpr);
    this.canvas.height = Math.floor(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.rebuildBaseLayer();
    this.draw();
  }

  private rebuildBaseLayer(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.baseWidth = width;
    this.baseHeight = height;
    this.baseLayer.width = Math.floor(width * dpr);
    this.baseLayer.height = Math.floor(height * dpr);
    this.screenX = new Float32Array(this.graph.nodes.length);
    this.screenY = new Float32Array(this.graph.nodes.length);
    this.screenX.fill(-1);
    this.screenY.fill(-1);
    this.renderIds = [];

    const context = this.baseLayer.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#030812";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "rgba(103, 144, 190, .16)";
    context.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const x = (width * i) / 4;
      const y = (height * i) / 4;
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
      context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
    }
    context.fillStyle = "#8ea8c7";
    context.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
    context.fillText("2D anatomical section · x/z EM projection", 12, 18);
    context.fillStyle = "#7690af";
    context.fillText("known soma locations · colors = region", 12, height - 12);

    for (const node of this.graph.nodes) {
      if (!this.filters[node.population] || !Number.isFinite(node.x) || !Number.isFinite(node.z)) continue;
      const [x, y] = this.project(node.x, node.z, width, height);
      this.screenX[node.id] = x;
      this.screenY[node.id] = y;
      this.renderIds.push(node.id);
      context.globalAlpha = node.section === "other" ? 0.34 : 0.78;
      context.fillStyle = SECTION_COLORS[node.section] ?? SECTION_COLORS.other;
      const radius = this.graph.nodes.length > 10_000 ? 0.9 : 2.2;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    context.globalAlpha = 1;
  }

  private draw(): void {
    if (!this.context) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    if (width !== this.baseWidth || height !== this.baseHeight) this.rebuildBaseLayer();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.context.clearRect(0, 0, width, height);
    this.context.drawImage(this.baseLayer, 0, 0, width, height);
    this.context.save();
    this.context.lineWidth = 1;
    for (const edge of sampleActivity(this.frame?.activeEdges ?? [], MAX_ACTIVITY_EDGES)) {
      const sx = this.screenX[edge.source], sy = this.screenY[edge.source];
      const tx = this.screenX[edge.target], ty = this.screenY[edge.target];
      if (sx < 0 || sy < 0 || tx < 0 || ty < 0) continue;
      this.context.strokeStyle = edge.plastic ? "rgba(255, 249, 208, .35)" : "rgba(140, 215, 255, .12)";
      this.context.beginPath(); this.context.moveTo(sx, sy); this.context.lineTo(tx, ty); this.context.stroke();
    }
    for (const id of sampleActivity(this.frame?.spikes ?? [], MAX_ACTIVITY_MARKERS)) {
      const x = this.screenX[id], y = this.screenY[id];
      const node = this.graph.nodes[id];
      if (!node || x < 0 || y < 0) continue;
      this.context.fillStyle = SECTION_COLORS[node.section] ?? SECTION_COLORS.other;
      // Bound activity-marker size to retain anatomical color context during high-activity batches.
      this.context.fillRect(x - 1.5, y - 1.5, 3, 3);
      this.context.fillStyle = "#fffdf0";
      this.context.fillRect(x, y, 1, 1);
    }
    this.context.restore();
    if (this.morphologySegments.length) {
      this.context.strokeStyle = "rgba(140, 236, 255, .78)";
      this.context.lineWidth = 0.75;
      this.context.beginPath();
      for (let i = 0; i < this.morphologySegments.length; i += 4) {
        this.context.moveTo(this.morphologySegments[i], this.morphologySegments[i + 1]);
        this.context.lineTo(this.morphologySegments[i + 2], this.morphologySegments[i + 3]);
      }
      this.context.stroke();
    }
    if (this.selected !== null) {
      const x = this.screenX[this.selected], y = this.screenY[this.selected];
      if (x >= 0 && y >= 0) {
        this.context.strokeStyle = "#ffffff";
        this.context.lineWidth = 1.5;
        this.context.beginPath(); this.context.arc(x, y, 7, 0, Math.PI * 2); this.context.stroke();
      }
    }
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let selected = -1;
    let distance = 14 * 14;
    for (const id of this.renderIds) {
      const dx = this.screenX[id] - x;
      const dy = this.screenY[id] - y;
      const next = dx * dx + dy * dy;
      if (next < distance) { distance = next; selected = id; }
    }
    if (selected < 0) return;
    this.selected = selected;
    const node = this.graph.nodes[selected];
    if (node) { this.onSelect(selected, node); this.draw(); }
  };

  private project(x: number, z: number, width: number, height: number): [number, number] {
    return [width / 2 + x * Math.min(width, height) * 0.39, height / 2 - z * Math.min(width, height) * 0.39];
  }

  private projectX(x: number): number { return this.project(x, 0, this.baseWidth, this.baseHeight)[0]; }
  private projectZ(z: number): number { return this.project(0, z, this.baseWidth, this.baseHeight)[1]; }
}
