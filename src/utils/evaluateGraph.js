import { getRuntime } from '../nodes/runtimeRegistry';
import { resolveAllNodesAtFrame } from './interpolation';

export function evaluateGraph(nodes, edges, definitions, displayNodeId, context = null) {
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
        let passthrough = results.get(firstEdge.source);
        if (passthrough && passthrough.__multiOutput && firstEdge.sourceHandle) {
          passthrough = passthrough[firstEdge.sourceHandle];
        }
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
        let value;
        if (sourceResult && sourceResult.__multiOutput && edge.sourceHandle) {
          value = sourceResult[edge.sourceHandle];
        } else {
          value = sourceResult;
        }
        // Dimension annotations are an editing overlay, not real geometry. They
        // live on the Dimension node's own output (shown when it's displayed),
        // but downstream consumers (Color, Transform, ...) should only receive
        // the underlying shape — otherwise the dims keep rendering downstream.
        inputs[edge.targetHandle] = stripDimAnnotations(value);
      }
    }

    // If a frame-0 (rest) snapshot of the graph was supplied, resolve this
    // node's inputs against it too. Stateful runtimes (e.g. the physics bake)
    // use this to know an input's pose at frame 0 without re-walking the graph.
    let nodeContext = context;
    const restResults = context && context.restResults;
    if (restResults) {
      const restInputs = {};
      for (const edge of incomingEdges) {
        const sourceResult = restResults.get(edge.source);
        if (sourceResult !== undefined) {
          let value;
          if (sourceResult && sourceResult.__multiOutput && edge.sourceHandle) {
            value = sourceResult[edge.sourceHandle];
          } else {
            value = sourceResult;
          }
          restInputs[edge.targetHandle] = stripDimAnnotations(value);
        }
      }
      nodeContext = { ...context, restInputs };
    }

    // Per-frame collider motion track (physics bake). The call site pre-samples
    // each animated collision input at every integer frame so a stateful runtime
    // can move a kinematic collider along its REAL keyframe path (and stop when
    // its animation ends) instead of stretching one rest->current sweep across
    // the whole bake.
    const colliderTrack = context && context.colliderTrack;
    if (colliderTrack && colliderTrack[nodeId]) {
      nodeContext = { ...(nodeContext || context), colliderTrackInput: colliderTrack[nodeId] };
    }

    // Per-frame input motion track (spring bake). Same idea as the collider
    // track: a spring is a stateful frame-by-frame integration, so it needs its
    // input's animated centre at every integer frame to compute overshoot.
    const springTrack = context && context.springTrack;
    if (springTrack && springTrack[nodeId]) {
      nodeContext = { ...(nodeContext || context), springTrackInput: springTrack[nodeId] };
    }

    try {
      const result = runtime(node.data.params, inputs, nodeContext);
      results.set(nodeId, result);
    } catch (e) {
      results.set(nodeId, { type: 'error', message: e.message });
    }
  }

  return results;
}

/* Remove Dimension overlay annotations from a geometry value before it flows
   into a downstream node. The Dimension runtime wraps the driven shape and its
   dimAnnotation graphics in a group; consumers only want the shape. */
function stripDimAnnotations(value) {
  if (!value || value.type !== 'group' || !Array.isArray(value.children)) return value;
  const hasAnnotations = value.children.some((c) => c && c.type === 'dimAnnotation');
  if (!hasAnnotations) return value;
  const real = value.children.filter((c) => c && c.type !== 'dimAnnotation');
  if (real.length === 0) return value;
  if (real.length === 1) return real[0];
  return { ...value, children: real };
}

/* Build a per-frame motion track for every physics node's `collision_in` input.

   The physics bake is stateful: it re-runs the whole simulation from frame 0 up
   to the current frame on every render. For an ANIMATED kinematic collider we
   want it to travel along its true keyframed path over the bake and then hold
   still once its animation ends, so the pile it disturbed can actually settle.
   A single rest->current interpolation can't do that (it stretches the motion
   across the entire bake, so the collider never stops and the pile jitters).

   So here we pre-sample each animated collision input at every integer frame
   0..uptoFrame and hand the physics runtime the resulting position track via
   context. Sampling is pruned to each physics node's upstream subgraph, so it
   only re-evaluates the (cheap) collider chain, not the whole graph.

   Returns a map: { [physicsNodeId]: Array<geometryAtFrame> } where index i is
   the collision_in geometry at frame i. Nodes with no animated collider input
   are omitted (nothing to track). */
export function buildColliderTracks(nodes, edges, definitions, allKeyframes, uptoFrame) {
  const physicsNodes = nodes.filter(
    (n) => n.data && n.data.definitionId === 'physics' && !n.data.bypassed
  );
  if (physicsNodes.length === 0) return null;

  // Which physics nodes actually have something wired into collision_in?
  const colliderEdgeByTarget = new Map();
  for (const e of edges) {
    if (e.targetHandle === 'collision_in') colliderEdgeByTarget.set(e.target, e);
  }
  const tracked = physicsNodes.filter((n) => colliderEdgeByTarget.has(n.id));
  if (tracked.length === 0) return null;

  // Does the collider chain feeding any tracked node depend on a keyframe? If
  // not, the collider is static and needs no track (cheap early-out).
  const hasAnyKeyframes = allKeyframes && Object.keys(allKeyframes).length > 0;

  const track = {};
  for (const pnode of tracked) track[pnode.id] = new Array(uptoFrame + 1);

  const N = Math.max(0, Math.round(uptoFrame));
  for (let f = 0; f <= N; f++) {
    const frameNodes = hasAnyKeyframes
      ? resolveAllNodesAtFrame(nodes, allKeyframes, f)
      : nodes;
    for (const pnode of tracked) {
      // Evaluate pruned to the COLLIDER's source node (not the physics node), so
      // only the collider's upstream chain runs. Pruning to the physics node
      // would re-run its full bake here on every sampled frame — wasteful, and it
      // would also clobber the physics node's cross-frame bake cache with these
      // frame-sample evaluations. Reading the source's output gives us the same
      // collider geometry without touching the sim.
      const edge = colliderEdgeByTarget.get(pnode.id);
      const results = evaluateGraph(frameNodes, edges, definitions, edge.source, null);
      let value = results.get(edge.source);
      if (value && value.__multiOutput && edge.sourceHandle) value = value[edge.sourceHandle];
      track[pnode.id][f] = stripDimAnnotations(value);
    }
    // Static colliders: the first frame already captured it; if there are no
    // keyframes anywhere the geometry never changes, so stop after frame 0.
    if (!hasAnyKeyframes) {
      for (const pnode of tracked) {
        const g0 = track[pnode.id][0];
        for (let k = 1; k <= N; k++) track[pnode.id][k] = g0;
      }
      break;
    }
  }

  return track;
}

/* Build a per-frame motion track for every Spring node's `geometry_in` input.

   A Spring is stateful: it integrates a damped mass-spring from frame 0 up to
   the current frame, chasing the input's animated position, so it needs to know
   where its input sits at EVERY integer frame (not just the current one). The
   pure per-frame graph can't provide that, so — exactly like the collider track
   — we pre-sample each spring's input source at every frame 0..uptoFrame and
   hand the result to the spring runtime via context.springTrack[nodeId].

   Sampling is pruned to the input's source node so only that (cheap) upstream
   chain re-evaluates, never the spring node itself.

   Returns { [springNodeId]: Array<geometryAtFrame> }, or null if none apply. */
export function buildSpringTracks(nodes, edges, definitions, allKeyframes, uptoFrame) {
  const springNodes = nodes.filter(
    (n) => n.data && n.data.definitionId === 'spring' && !n.data.bypassed
  );
  if (springNodes.length === 0) return null;

  // Source edge feeding each spring's geometry_in.
  const inputEdgeByTarget = new Map();
  for (const e of edges) {
    if (e.targetHandle === 'geometry_in') inputEdgeByTarget.set(e.target, e);
  }
  const tracked = springNodes.filter((n) => inputEdgeByTarget.has(n.id));
  if (tracked.length === 0) return null;

  const hasAnyKeyframes = allKeyframes && Object.keys(allKeyframes).length > 0;

  const track = {};
  for (const snode of tracked) track[snode.id] = new Array(uptoFrame + 1);

  const N = Math.max(0, Math.round(uptoFrame));
  for (let f = 0; f <= N; f++) {
    const frameNodes = hasAnyKeyframes
      ? resolveAllNodesAtFrame(nodes, allKeyframes, f)
      : nodes;
    for (const snode of tracked) {
      const edge = inputEdgeByTarget.get(snode.id);
      const results = evaluateGraph(frameNodes, edges, definitions, edge.source, null);
      let value = results.get(edge.source);
      if (value && value.__multiOutput && edge.sourceHandle) value = value[edge.sourceHandle];
      track[snode.id][f] = stripDimAnnotations(value);
    }
    // No keyframes anywhere -> input never moves; frame 0 is the whole track.
    if (!hasAnyKeyframes) {
      for (const snode of tracked) {
        const g0 = track[snode.id][0];
        for (let kf = 1; kf <= N; kf++) track[snode.id][kf] = g0;
      }
      break;
    }
  }

  return track;
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
