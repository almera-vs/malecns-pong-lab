import type { BiologicalInterfaceAudit, GraphNode } from "./types";

export type MuscleGroup = "left-flexor" | "left-extensor" | "right-flexor" | "right-extensor";

export interface BiologicalInterfaceMap {
  visualInput: number[];
  visualInputChannels: number[];
  motorOutputs: [number[], number[], number[], number[]];
  proprioceptiveInputs: [number[], number[]];
  dopamineNeurons: number[];
  audit: BiologicalInterfaceAudit;
}

/**
 * Resolve the sensor and actuator interface from biological annotations. Graph indices identify
 * records but do not establish sensory modality, laterality, or muscle function.
 */
export function mapBiologicalInterface(nodes: GraphNode[]): BiologicalInterfaceMap {
  const sensory = nodes.filter(isPhotoreceptor);
  const explicitRetinotopy = sensory.filter((node) => node.retinalPosition && node.retinalPositionSource !== "optic-column-lattice");
  const opticColumnMap = sensory.filter((node) => node.retinalPosition && node.retinalPositionSource === "optic-column-lattice");
  const spatialProxy = sensory.some((node) => !node.retinalPosition && node.position8nm && retinalSideOf(node) !== null);
  const sensorsBySide = new Map<string, GraphNode[]>();
  for (const node of sensory) {
    const side = retinalSideOf(node);
    if (side) {
      let group = sensorsBySide.get(side);
      if (!group) sensorsBySide.set(side, group = []);
      group.push(node);
    }
  }
  const spatialBounds = new Map<string, [number, number, number, number]>();
  if (spatialProxy) for (const [side, group] of sensorsBySide) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const node of group) if (node.position8nm) {
      minX = Math.min(minX, node.position8nm[0]); maxX = Math.max(maxX, node.position8nm[0]);
      minZ = Math.min(minZ, node.position8nm[2]); maxZ = Math.max(maxZ, node.position8nm[2]);
    }
    if (Number.isFinite(minX + maxX + minZ + maxZ)) spatialBounds.set(side, [minX, maxX, minZ, maxZ]);
  }
  const mappedSensors = sensory.flatMap((node) => {
    const side = retinalSideOf(node);
    if (side === null) return [];
    const bounds = spatialBounds.get(side);
    const position = node.retinalPosition ?? (spatialProxy && bounds ? somaFieldPosition(node, bounds) : undefined);
    if (!position) return [];
    const col = clamp(Math.round(position[0] * 7), 0, 7);
    const row = clamp(Math.round(position[1] * 3), 0, 3);
    return [{ id: node.id, channel: (side === "right" ? 32 : 0) + row * 8 + col }];
  });

  const motorCandidates = nodes.filter(isMotorNeuron);
  const hasForelegAnnotation = motorCandidates.some((node) => limbOf(node) === "foreleg");
  const limbScope = hasForelegAnnotation ? "foreleg" : motorCandidates.some((node) => limbOf(node) === null) ? "side-tibia-pool" : "unmapped";
  const motorOutputs: [number[], number[], number[], number[]] = [[], [], [], []];
  for (const node of motorCandidates) {
    const side = sideOf(node);
    const limb = limbOf(node);
    const action = tibiaAction(node);
    const inScope = hasForelegAnnotation ? limb === "foreleg" : limb === null;
    if (side === null || !inScope || action === null) continue;
    const channel = (side === "right" ? 2 : 0) + (action === "extensor" ? 1 : 0);
    motorOutputs[channel].push(node.id);
  }

  const usedChannels = new Set(mappedSensors.map((entry) => entry.channel));
  const mappedMotorCount = motorOutputs.reduce((sum, group) => sum + group.length, 0);
  const proprioCandidates = nodes.filter(isProprioceptor);
  const proprioceptiveInputs: [number[], number[]] = [[], []];
  for (const node of proprioCandidates) {
    const side = sideOf(node);
    if (side === "left") proprioceptiveInputs[0].push(node.id);
    if (side === "right") proprioceptiveInputs[1].push(node.id);
  }
  const dopamineCandidates = nodes.filter(isDopaminergic);
  const dopamineNeurons = dopamineCandidates.map((node) => node.id);
  const mappingMethods = Number(explicitRetinotopy.length > 0) + Number(opticColumnMap.length > 0) + Number(spatialProxy);
  const mappingBasis: BiologicalInterfaceAudit["vision"]["mappingBasis"] = mappingMethods > 1
    ? "mixed"
    : opticColumnMap.length ? "optic-column-lattice"
      : explicitRetinotopy.length ? "explicit-retinotopy"
        : spatialProxy ? "soma-coordinate-proxy" : "unmapped";
  return {
    visualInput: mappedSensors.map((entry) => entry.id),
    visualInputChannels: mappedSensors.map((entry) => entry.channel),
    motorOutputs,
    proprioceptiveInputs,
    dopamineNeurons,
    audit: {
      vision: {
        receptorCandidates: sensory.length,
        mappedReceptors: mappedSensors.length,
        coveredChannels: usedChannels.size,
        mappingBasis,
      },
      motor: {
        annotatedMotorNeurons: motorCandidates.length,
        mappedTibiaMotorNeurons: mappedMotorCount,
        unmappedMotorNeurons: motorCandidates.length - mappedMotorCount,
        groups: motorOutputs.map((group) => group.length) as [number, number, number, number],
        limbScope: mappedMotorCount ? limbScope : "unmapped",
      },
      proprioception: {
        candidateNeurons: proprioCandidates.length,
        mappedNeurons: proprioceptiveInputs[0].length + proprioceptiveInputs[1].length,
        groups: [proprioceptiveInputs[0].length, proprioceptiveInputs[1].length],
      },
      reward: {
        dopamineCandidates: dopamineCandidates.length,
        mappedDopamineNeurons: dopamineNeurons.length,
      },
      embodiment: "left/right tibia muscle pairs → paddle vertical position",
    },
  };
}

export function isPhotoreceptor(node: GraphNode): boolean {
  const annotations = `${node.type} ${node.class ?? ""} ${node.subclass ?? ""} ${node.sensoryModality ?? ""} ${node.receptorSubtype ?? ""}`.toLowerCase();
  return /photoreceptor|retinula|\br1\s*[-–]\s*r6\b|\br[7-8](?:[-_]?[a-z0-9]+)*\b/.test(annotations);
}

export function isMotorNeuron(node: GraphNode): boolean {
  const annotations = `${node.superclass ?? ""} ${node.class ?? ""} ${node.type}`.toLowerCase();
  return /vnc[_ -]?motor|motor[_ -]?neuron|\bmn\b/.test(annotations);
}

/**
 * Restrict body feedback to annotation-matched proprioceptor classes; this operational classifier
 * still requires biological audit.
 */
export function isProprioceptor(node: GraphNode): boolean {
  const annotations = `${node.type} ${node.superclass ?? ""} ${node.class ?? ""} ${node.subclass ?? ""} ${node.sensoryModality ?? ""} ${node.receptorSubtype ?? ""}`.toLowerCase();
  return /propriocept|chordotonal|campaniform\s+sensillum|campaniform\s+sensilla|leg\s+sensillum|joint\s+receptor/.test(annotations);
}

export function isDopaminergic(node: GraphNode): boolean {
  const annotations = `${node.neurotransmitter ?? ""} ${node.type} ${node.superclass ?? ""} ${node.class ?? ""} ${node.subclass ?? ""}`.toLowerCase();
  return /dopamin|\bdan\b|\bdpm\b|\bppl\b|\bppm\b/.test(annotations);
}

function tibiaAction(node: GraphNode): "flexor" | "extensor" | null {
  const targetText = `${node.muscleTargets?.join(" ") ?? ""} ${node.type}`.toLowerCase().replace(/[._-]+/g, " ");
  const tibia = /\btibia\b|\bti\b/.test(targetText);
  if (!tibia) return null;
  if (/\bflex(?:or|ion)?\b/.test(targetText)) return "flexor";
  if (/\bext(?:ensor|ension)?\b/.test(targetText)) return "extensor";
  return null;
}

function limbOf(node: GraphNode): "foreleg" | "middleleg" | "hindleg" | null {
  const annotation = `${node.subclass ?? ""} ${node.motorExitNerve ?? ""} ${node.type}`.toLowerCase();
  if (/\bfl\b|fore.?leg|prothoracic|\bt1\b|proln|pron/.test(annotation)) return "foreleg";
  if (/\bml\b|middle.?leg|mesothoracic|\bt2\b|mesoln/.test(annotation)) return "middleleg";
  if (/\bhl\b|hind.?leg|metathoracic|\bt3\b|metaln/.test(annotation)) return "hindleg";
  return null;
}

function sideOf(node: GraphNode): "left" | "right" | null {
  return canonicalSide(node.side);
}

function canonicalSide(value: string | undefined): "left" | "right" | null {
  const side = (value ?? "").toLowerCase();
  if (side === "l" || side === "left" || side.endsWith("_l")) return "left";
  if (side === "r" || side === "right" || side.endsWith("_r")) return "right";
  return null;
}

function retinalSideOf(node: GraphNode): "left" | "right" | null {
  return canonicalSide(node.retinalEyeSide) ?? sideOf(node);
}

function somaFieldPosition(node: GraphNode, bounds: [number, number, number, number]): [number, number] | undefined {
  const position = node.position8nm;
  if (!position) return undefined;
  const [minX, maxX, minZ, maxZ] = bounds;
  const u = maxX === minX ? 0.5 : (position[0] - minX) / (maxX - minX);
  const v = maxZ === minZ ? 0.5 : (position[2] - minZ) / (maxZ - minZ);
  return [u, v];
}

export function readRetinalPosition(value: unknown): [number, number] | undefined {
  const values = Array.isArray(value) ? value : value && typeof value === "object"
    ? [(value as Record<string, unknown>).u ?? (value as Record<string, unknown>).x, (value as Record<string, unknown>).v ?? (value as Record<string, unknown>).y]
    : null;
  if (!values || values.length < 2 || values[0] === undefined || values[1] === undefined) return undefined;
  const x = Number(values[0]);
  const y = Number(values[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  // Interpret normalized fields or an 8-by-4 integer lattice under an explicit coordinate convention.
  return [clamp(x > 1 ? x / 7 : x, 0, 1), clamp(y > 1 ? y / 3 : y, 0, 1)];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
