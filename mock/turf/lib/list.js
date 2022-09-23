'use strict';

const fs = require('fs');
const path = require('path');

const utility = require('utility');

const JSON_PATH = process.env.JSON_PATH || path.join(__dirname, '..', '.list.json');

function getJSON() {
  try {
    fs.statSync(JSON_PATH);
  } catch (e) {
    fs.writeFileSync(JSON_PATH, '{}', { encoding: 'utf8' });
  }

  return utility.readJSONSync(JSON_PATH);
}

exports.getList = function getList() {
  return getJSON();
};

exports.writeList = function writeList(list) {
  utility.writeJSONSync(JSON_PATH, list);
};
