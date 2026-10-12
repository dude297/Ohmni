import { LOADED_BRIDGE_12V } from "../../lib/circuit/fixtures";
import type { CircuitGraph } from "../../lib/circuit/types";

/** Prepared educational graph. Never represents image extraction or a live meter. */
export const advancedGraph = (): CircuitGraph => ({
  ...LOADED_BRIDGE_12V,
  components: LOADED_BRIDGE_12V.components.map(c => ({...c})),
});

/** Fixed drawing is used only while every labelled terminal matches this graph. */
export function isAdvancedGraph(graph: CircuitGraph): boolean {
  const reference = advancedGraph();
  return graph.groundNode === "GND" && graph.components.length === reference.components.length &&
    reference.components.every((part) => graph.components.some((c) => c.id === part.id && c.kind === part.kind && c.positiveNode === part.positiveNode && c.negativeNode === part.negativeNode));
}
