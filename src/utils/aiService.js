import { useAiStore } from '../store/aiStore';

const GEOMETRY_SCHEMA = `
You are a geometry code generator for a 2D design tool called 2Dni.
You write JavaScript code that manipulates geometry objects.

The code receives an "input" variable containing the upstream geometry (or null if nothing is connected).
You must return a geometry object.

GEOMETRY TYPES:
- rect: { type: 'rect', x, y, width, height, fill, stroke, strokeWidth, bounds: {x,y,width,height} }
- ellipse: { type: 'ellipse', cx, cy, rx, ry, fill, stroke, strokeWidth, bounds }
- arc: { type: 'arc', pathData, cx, cy, rx, ry, arcStart, arcEnd, fill, stroke, strokeWidth, bounds }
- line: { type: 'line', x1, y1, x2, y2, stroke, strokeWidth, bounds }
- text: { type: 'text', content, fontFamily, fontSize, fontWeight, fill }
- group: { type: 'group', children: [...geometries], transform: { translate_x, translate_y, rotate, scale_x, scale_y, pivot_x, pivot_y }, bounds }
- roundedRect: { type: 'roundedRect', x, y, width, height, corners: [tl, tr, br, bl], fill, stroke, strokeWidth }
- booleanResult: { type: 'booleanResult', pathData (SVG path string), fill, stroke, strokeWidth, bounds }

RULES:
- Only output the JavaScript code body (no function wrapper, no markdown fences)
- The code will be executed as: new Function('input', yourCode)
- Always return a geometry object
- You can modify "input" and return it, or create new geometry
- You can use standard JavaScript (Math, loops, arrays, etc.)
- Do NOT use import/require/fetch or any async operations
- Keep code concise and correct
`;

export async function generateCode(userMessage, inputGeometry, chatHistory) {
  const store = useAiStore.getState();
  const { provider, endpoint, apiKey, model } = store;

  const messages = [
    { role: 'system', content: GEOMETRY_SCHEMA },
  ];

  if (inputGeometry) {
    messages.push({
      role: 'system',
      content: `The current input geometry is:\n${JSON.stringify(inputGeometry, null, 2)}`,
    });
  }

  for (const msg of chatHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  messages.push({ role: 'user', content: userMessage });

  if (provider === 'anthropic') {
    return callAnthropic(endpoint, apiKey, model, messages);
  }
  return callOpenAICompatible(endpoint, apiKey, model, messages);
}

async function callOpenAICompatible(endpoint, apiKey, model, messages) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, temperature: 0.2 }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  return extractCode(content);
}

async function callAnthropic(endpoint, apiKey, model, messages) {
  const systemMsg = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system: systemMsg,
      messages: chatMessages,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || '';
  return extractCode(content);
}

function extractCode(text) {
  const fenceMatch = text.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  const cleanedLines = text.split('\n').filter(
    (line) => !line.startsWith('```') && !line.startsWith('Here')
  );
  return cleanedLines.join('\n').trim();
}
