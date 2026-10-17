// A scripted agent for the test bench: applies one case's known change to the
// copy it runs in, whatever finding it is given. Usage: node replay.mjs <case>
import fs from 'node:fs';
import { CASES } from '../cases.js';

const c = CASES.find(x => x.id === process.argv[2]);
if (!c) {
  console.error(`no case ${process.argv[2]}`);
  process.exit(1);
}
const text = fs.readFileSync(c.patch.file, 'utf8');
if (!text.includes(c.patch.from)) {
  console.error(`case ${c.id}: the code to change was not found in ${c.patch.file}`);
  process.exit(1);
}
fs.writeFileSync(c.patch.file, text.replace(c.patch.from, c.patch.to));
console.log(`applied the ${c.id} change to ${c.patch.file}`);
