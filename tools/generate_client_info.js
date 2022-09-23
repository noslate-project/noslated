'use strict';

const fs = require('fs');
const path = require('path');

const aliceVersion = require('#self/package.json').version;
// do not use #self
const constants = require('../src/control_panel/starter/constant').ENV;
const content = `
'use strict';

Object.defineProperty(process.versions, 'alice', {
  writable: false,
  configurable: true,
  value: '${aliceVersion}',
});

module.exports = {
  ENV: ${JSON.stringify(constants, null, 2)},
};
`;

fs.writeFileSync(path.resolve(__dirname, '../src/starter/generated.js'), content, 'utf8');
