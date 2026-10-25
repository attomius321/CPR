// A trial's transcript as a timeline, in seconds after the keys were pressed.
const fs = require('fs');
const [file, pressedAt] = process.argv.slice(2);
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
for (const e of rows) {
  if (e.type === 'attachment' && !['queued_command', 'edited_text_file'].includes(e.attachment?.type)) continue;
  if (/^api-request/.test(e.type)) continue;
  const c = e.message?.content ?? e.attachment ?? e.content ?? e.operation ?? '';
  const s = typeof c === 'string' ? c : JSON.stringify(c);
  const t = ((Date.parse(e.timestamp) - Number(pressedAt)) / 1000).toFixed(2).padStart(7);
  console.log(t, e.type, e.operation || e.subtype || e.attachment?.type || '', s.replace(/\s+/g, ' ').slice(0, 150));
}
