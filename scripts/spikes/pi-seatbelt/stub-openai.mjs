// Minimal OpenAI-compatible stub for the pi Seatbelt spike.
// Serves /v1/models and a streamed /v1/chat/completions text turn.
// Logs every request (method, url, auth header) to STUB_LOG for assertions.
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.STUB_PORT ?? 8137);
const LOG = process.env.STUB_LOG ?? 'stub.log';
const log = (m) => fs.appendFileSync(LOG, m + '\n');

const server = http.createServer((req, res) => {
  log(`${req.method} ${req.url} auth=${req.headers.authorization ?? 'none'}`);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] }));
      return;
    }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const base = { id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: 1, model: 'stub-model' };
    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello ' }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: { content: 'from stub.' }, finish_reason: null }] });
    send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
server.listen(PORT, '127.0.0.1', () => console.log(`stub listening on ${PORT}`));
