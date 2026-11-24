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
    const tool = event.toolCall;
    const hookEvent = event.hook_event_name || event.hookEventName;
    // Antigravity sends camelCase fields with the tool under toolCall and no exit code:
    // a non-empty error on PostToolUse is the only failure signal it gives.
    if (tool) process.stdout.write(hookEvent === 'PreToolUse' ? '{"decision":"ask"}' : '{}');
    const exitCode = tool
      ? (hookEvent === 'PostToolUse' ? (event.error ? 1 : 0) : undefined)
      : event.tool_response && event.tool_response.exit_code;
    const body = JSON.stringify({
      hook_event_name: hookEvent, session_id: event.session_id || event.conversationId,
      turn_id: event.turn_id, tool_use_id: event.tool_use_id || (tool && tool.id),
      tool_name: event.tool_name || (tool && tool.name),
      tool_input: hookEvent === 'PreToolUse' ? (tool ? tool.args : event.tool_input) : undefined,
      exit_code: exitCode
    });
    const request = http.request(url, { method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' } }, response => {
      response.resume(); response.on('end', () => process.exit(0));
    });
    const warn = (reason, error) => process.stderr.write(JSON.stringify({
      level: 'warn', event: 'execution_capture.hook_relay_failed', reason,
      toolName: event.tool_name || (tool && tool.name), toolCallId: event.tool_use_id || (tool && tool.id),
      errorCode: error && error.code, error: error && error.message
    }) + '\n');
    request.on('error', error => { warn('transport-error', error); process.exit(0); });
    request.setTimeout(2500, () => { warn('response-timeout'); request.destroy(); process.exit(0); });
    request.end(body);
  } catch { process.exit(0); }
});
`;
export const quoteShell = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export const executionHookCommand = (nodePath = process.execPath): string =>
  `${quoteShell(nodePath)} -e ${quoteShell(relaySource)}`;
