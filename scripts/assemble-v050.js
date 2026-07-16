const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// Deterministic assembly from the reviewed compressed source parts.
const root = path.resolve(__dirname, '..');
const partsDir = path.join(root, 'build', 'v050');
const encoded = fs.readdirSync(partsDir)
  .filter((name) => /^part\d+\.b64$/.test(name))
  .sort()
  .map((name) => fs.readFileSync(path.join(partsDir, name), 'utf8').trim())
  .join('');

if (!encoded) throw new Error('Nenhuma parte da v0.5.0 encontrada.');
const source = zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
if (!source.includes('// @version      0.5.0')) throw new Error('Versão inesperada no script montado.');
if (!source.includes("const SESSION_KEY='oslerAnkiBridge.sessions.v3'")) throw new Error('Camada unificada de sessões ausente.');

for (const relative of [
  'docs/osler-anki-bridge-v050.user.js',
  'userscript/osler-anki-bridge-v050.user.js',
]) {
  fs.writeFileSync(path.join(root, relative), source, 'utf8');
}

console.log(`Osler Anki Bridge v0.5.0 montado: ${Buffer.byteLength(source)} bytes.`);
