// Tests the installed helper without a browser: speaks native messaging with it over stdin/stdout.
// Usage: node tools/test-helper.mjs [path-to-helper]   (default: the installed one)
// Needs no network: pings 127.0.0.1, plus a name that can't resolve.
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const path = process.argv[2] || `${homedir()}/Library/Application Support/tab2ping/tab2ping-helper`;
const helper = spawn(path, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const messages = [];
let buf = Buffer.alloc(0);
helper.stdout.on('data', d => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
    const len = buf.readUInt32LE(0);
    messages.push(JSON.parse(buf.subarray(4, 4 + len)));
    buf = buf.subarray(4 + len);
  }
});
const send = msg => {
  const body = Buffer.from(JSON.stringify(msg));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  helper.stdin.write(Buffer.concat([head, body]));
};
const wait = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + name); if (!ok) failed++; };
const of = (id, type) => messages.filter(m => m.id === id && (!type || m.type === type));

// The first start of the helper may take a moment (the system checks the new binary).
const until = async (pred, ms) => { for (let t = 0; t < ms && !pred(); t += 50) await wait(50); return pred(); };
send({ cmd: 'hello' });
check('hello answers with a version', await until(() => messages.some(m => m.type === 'hello' && m.version), 5000));

send({ cmd: 'ping', id: 'local', host: '127.0.0.1' });
await wait(2500);
check('ping 127.0.0.1 replies with ms', of('local', 'reply').length >= 2 && of('local', 'reply').every(m => m.ms >= 0));

send({ cmd: 'stop', id: 'local' });
await wait(300);
const count = of('local').length;
await wait(1500);
check('stop ends the replies', of('local').length === count);

send({ cmd: 'ping', id: 'bad', host: 'nonexistent.invalid' });
await wait(1500);
check('unknown host reports an error, then ended', of('bad', 'error').length === 1 && of('bad').at(-1)?.type === 'ended');

send({ cmd: 'ping', id: 'v6', host: '::1' });
await wait(2500);
send({ cmd: 'stop', id: 'v6' });
check('IPv6 (::1) replies', of('v6', 'reply').length >= 1);

send({ cmd: 'ping', id: 'v6b', host: '[::1]' });
await wait(1500);
send({ cmd: 'stop', id: 'v6b' });
check('bracketed IPv6 host from a URL works', of('v6b', 'reply').length >= 1);

send({ cmd: 'ping', id: 'r', host: '127.0.0.1' });
await wait(1500);
send({ cmd: 'ping', id: 'r', host: '::1' });
await wait(2000);
send({ cmd: 'stop', id: 'r' });
// From the first message of the new host on (one of the old one may have been under way).
const r = of('r'), first = r.findIndex(m => m.host === '::1');
check('restart under the same id: only the new host, no "ended"',
  first >= 0 && r.slice(first).every(m => m.host === '::1' && m.type !== 'ended'));

// A frame that isn't JSON is skipped; the helper stays.
const junk = Buffer.from('not json');
const head = Buffer.alloc(4); head.writeUInt32LE(junk.length);
helper.stdin.write(Buffer.concat([head, junk]));
const hellos = messages.filter(m => m.type === 'hello').length;
send({ cmd: 'hello' });
check('invalid JSON is skipped, the helper keeps answering',
  await until(() => messages.filter(m => m.type === 'hello').length > hellos, 2000));

// Every start must give its pipes back (a leak would end the helper after ~120 tab switches).
const fds = () => execFileSync('lsof', ['-p', String(helper.pid)]).toString().trim().split('\n').length;
const before = fds();
for (let i = 0; i < 40; i++) send({ cmd: 'ping', id: 'leak', host: '127.0.0.1' });
send({ cmd: 'stop', id: 'leak' });
await wait(1500);
check(`40 restarts leave no open files behind (${before} → ${fds()})`, fds() <= before + 2);

send({ cmd: 'ping', id: 'evil', host: '-f' });
send({ cmd: 'ping', id: 'evil2', host: '1.2.3.4;ls' });
await wait(300);
check('options and shell characters are refused',
  of('evil', 'error')[0]?.text === 'invalid host' && of('evil2', 'error')[0]?.text === 'invalid host');

send({ cmd: 'ping', id: 'a', host: '127.0.0.1' });
send({ cmd: 'ping', id: 'b', host: '127.0.0.1' });
await wait(1500);
check('two pings run side by side', of('a', 'reply').length >= 1 && of('b', 'reply').length >= 1);

helper.stdin.end();   // the browser closing the connection
const exited = await Promise.race([new Promise(r => helper.on('exit', () => r(true))), wait(2000).then(() => false)]);
check('closing the connection ends the helper', exited);

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
