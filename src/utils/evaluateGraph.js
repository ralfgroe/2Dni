import { getRuntime } from '../nodes/runtimeRegistry';

export function evaluateGraph(nodes, edges, definitions, displayNodeId) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const results = new Map();

  const adjacency = new Map();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    const deps = adjacency.get(edge.target) || [];
    deps.push(edge);
    adjacency.set(edge.target, deps);
  }

  let visibleNodes;
  if (displayNodeId) {
    visibleNodes = getUpstreamNodes(displayNodeId, adjacency, nodeMap);
    for (const node of nodes) {
      if (node.data.templated) {
        const upstreamOfTemplate = getUpstreamNodes(node.id, adjacency, nodeMap);
        for (const nid of upstreamOfTemplate) {
          visibleNodes.add(nid);
        }
      }
    }
  } else {
    visibleNodes = new Set(nodes.map((n) => n.id));
  }

  const sorted = topologicalSort(nodes, edges);

  for (const nodeId of sorted) {
    if (!visibleNodes.has(nodeId)) continue;

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    if (node.data.bypassed) {
      const incomingEdges = adjacency.get(nodeId) || [];
      if (incomingEdges.length > 0) {
        const firstEdge = incomingEdges[0];
        const passthrough = results.get(firstEdge.source);
        if (passthrough !== undefined) {
          results.set(nodeId, passthrough);
        }
      }
      continue;
    }

    const def = definitions[node.data.definitionId];
    if (!def) continue;

    const runtime = getRuntime(def.runtime);
    if (!runtime) continue;

    const inputs = {};
    const incomingEdges = adjacency.get(nodeId) || [];
    for (const edge of incomingEdges) {
      const sourceResult = results.get(edge.source);
      if (sourceResult !== undefined) {
        inputs[edge.targetHandle] = sourceResult;
      }
    }

    try {
      const result = runtime(node.data.params, inputs);
      results.set(nodeId, result);
    } catch (e) {
      results.set(nodeId, { type: 'error', message: e.message });
    }
  }

  return results;
}

function getUpstreamNodes(nodeId, adjacency, nodeMap) {
  const visited = new Set();
  const stack = [nodeId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (visited.has(current)) continue;
    visited.add(current);

    const incomingEdges = adjacency.get(current) || [];
    for (const edge of incomingEdges) {
      if (nodeMap.has(edge.source)) {
        stack.push(edge.source);
      }
    }
  }

  return visited;
}

function topologicalSort(nodes, edges) {
  const inDegree = new Map();
  const adj = new Map();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }

  for (const edge of edges) {
    const targets = adj.get(edge.source) || [];
    targets.push(edge.target);
    adj.set(edge.source, targets);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  const queue = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted = [];
  while (queue.length > 0) {
    const current = queue.shift();
    sorted.push(current);
    for (const neighbor of adj.get(current) || []) {
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return sorted;
}
