// The view server's terminals (V21): output streamed, keys, size, images, files opened.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseTerminalFile, parseTerminalPaths, terminalSize } from './server-requests.js';
import { imageKind, MAX_IMAGE_BYTES, type Terminals } from './terminal.js';
import type { ServerContext } from './server-context.js';
import { json, send, type ServerHttp } from './server-http.js';

/** Most a terminal is sent at once: keys typed, or a line Symbiote types (V21). */
const MAX_TERMINAL_INPUT = 64 * 1024;

/** A file a terminal could not open (V38): its status by why. */
const FILE_REFUSED = { terminal: 404, outside: 400, missing: 409, editor: 502 } as const;

/** Most an image's request may weigh (V36): the image as base64, in its JSON. */
const MAX_IMAGE_BODY = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 1024;

const IMAGE_TOO_LARGE = `an image of at most ${MAX_IMAGE_BYTES / 2 ** 20} MB`;

/** `/api/terminals/<id>…`. */
export function serverTerminals(
  { streams }: Pick<ServerContext, 'streams'>,
  { sameSite, written }: Pick<ServerHttp, 'sameSite' | 'written'>,
) {
  /**
   * A terminal (V21): `GET` streams its output as server-sent events (`out`, then `exit` and
   * the end); `POST …/in { data }`, `…/resize { cols, rows }` and `…/close` are writes, and so is
   * `…/image { data }` (V36), an image as base64 saved for the agent: its path and the text to
   * paste. `…/paths { paths }` answers which paths it printed are files in its folder, and
   * `…/open { path, line?, column? }` opens one in the editor (V38): writes too, as which files
   * exist is not for another site. Its ID is unguessable and made only by a write; a read from
   * another site is refused too.
   */
  async function terminalApi(
    req: IncomingMessage,
    res: ServerResponse,
    terminals: Terminals,
    id: string,
    action: string | undefined,
  ): Promise<void> {
    if (action === undefined) {
      if (req.method !== 'GET') return send(res, 405, 'method not allowed');
      if (!sameSite(req)) return send(res, 403, 'forbidden');
      // What it printed so far arrives while listening starts: kept until the head is sent.
      let ready = false;
      const queued: string[] = [];
      const event = (name: string, data: unknown) => {
        const text = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
        if (ready) res.write(text);
        else queued.push(text);
      };
      const stop = terminals.listen(id, {
        out: (data) => event('out', data),
        exit: (code) => {
          event('exit', { code });
          streams.delete(res);
          res.end();
        },
      });
      if (!stop) return send(res, 404, 'no such terminal');
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      ready = true;
      if (queued.length > 0) res.write(queued.join(''));
      else res.flushHeaders();
      streams.add(res);
      req.on('close', () => {
        streams.delete(res);
        stop();
      });
      return;
    }
    const parse = (text: string) => JSON.parse(text) as Record<string, unknown> | null;
    if (action === 'image') {
      // Refused before it is read: the page checks the size first.
      if (Number(req.headers['content-length']) > MAX_IMAGE_BODY) {
        req.resume();
        return send(res, 413, IMAGE_TOO_LARGE);
      }
      return written(
        req,
        res,
        parse,
        async (body) => {
          if (typeof body?.data !== 'string' || body.data === '') {
            return send(res, 400, 'data: the image, as base64');
          }
          const bytes = Buffer.from(body.data, 'base64');
          if (bytes.length > MAX_IMAGE_BYTES) return send(res, 413, IMAGE_TOO_LARGE);
          const kind = imageKind(bytes);
          if (!kind)
            return send(res, 400, 'not an image the agents attach: PNG, JPEG, GIF or WebP');
          const saved = await terminals.image(id, bytes, kind);
          if (!saved) return send(res, 404, 'no such terminal');
          return json(res, 200, saved);
        },
        MAX_IMAGE_BODY,
      );
    }
    if (action === 'paths') {
      return written(req, res, parseTerminalPaths, async (paths) => {
        const files = await terminals.files(id, paths);
        if (!files) return send(res, 404, 'no such terminal');
        return json(res, 200, { files });
      });
    }
    if (action === 'open') {
      return written(req, res, parseTerminalFile, async (at) => {
        const result = await terminals.openFile(id, at);
        if (!result.opened) return send(res, FILE_REFUSED[result.why], result.message);
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
      });
    }
    return written(req, res, parse, (body) => {
      let done: boolean;
      if (action === 'in') {
        if (typeof body?.data !== 'string' || body.data.length > MAX_TERMINAL_INPUT) {
          return Promise.resolve(
            send(res, 400, `data: what to type, at most ${MAX_TERMINAL_INPUT} characters`),
          );
        }
        done = terminals.write(id, body.data);
      } else if (action === 'resize') {
        const size = terminalSize(body);
        if (!size) return Promise.resolve(send(res, 400, 'cols, rows: whole numbers, 2 to 1000'));
        done = terminals.resize(id, size.cols, size.rows);
      } else done = terminals.close(id);
      if (!done) return Promise.resolve(send(res, 404, 'no such terminal'));
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return Promise.resolve();
    });
  }

  return { terminalApi };
}
