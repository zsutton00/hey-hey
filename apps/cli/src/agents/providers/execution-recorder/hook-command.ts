/** Stable hook definition: runtime credentials are inherited, never embedded in Codex's trust hash. */
const relaySource = String.raw`
const http = require('node:http');
const url = process.env.HEY_HEY_CAPTURE_URL;
const token = process.env.HEY_HEY_CAPTURE_TOKEN;
if (!url || !token) process.exit(0);
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 16777216) process.exit(0); });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);
    const body = JSON.stringify({
      hook_event_name: event.hook_event_name, session_id: event.session_id,
      turn_id: event.turn_id, tool_use_id: event.tool_use_id, tool_name: event.tool_name,
      exit_code: event.tool_response && event.tool_response.exit_code
    });
    const request = http.request(url, { method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' } }, response => {
      response.resume(); response.on('end', () => process.exit(0));
    });
    request.on('error', () => process.exit(0));
    request.setTimeout(115000, () => { request.destroy(); process.exit(0); });
    request.end(body);
  } catch { process.exit(0); }
});
`;
const quoteShell = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export const executionHookCommand = (nodePath = process.execPath): string =>
  `${quoteShell(nodePath)} -e ${quoteShell(relaySource)}`;
