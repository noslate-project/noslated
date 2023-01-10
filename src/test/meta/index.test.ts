import assert from 'assert';
import fs from 'fs';
import path from 'path';
import * as common from '../common';
import { config } from '#self/config';

const pkgJson = require('#self/package.json');

const ignoredPrefixes = [
  /^\./,
  /^core./,
  /^CODEOWNERS$/,
  /^tsconfig/,
  /\.sock$/,
  /\.out$/,
  /\.tsbuildinfo$/,
];
function isIgnoredPattern(filename: string) {
  for (const item of ignoredPrefixes) {
    if (item.exec(filename) != null) {
      return true;
    }
  }
  return false;
}

describe(common.testName(__filename), () => {
  const _it = process.env.BUILD_NUMBER ? it : it.skip;
  _it('archive files', () => {
    const excludedPaths = [
      'assets',
      'benchmark',
      'devstart.js',
      'example',
      'fixtures',
      'mock',
      'node_modules',
      'src',
      'tools',
      'typings',
      'LICENSE',
      'Makefile',
      'noslated.gyp',
      'package-lock.json',
      'package.json',
      'README.md',

      // dist root
      'bin',
      'build',
    ];
    const existingPaths = fs.readdirSync(config.projectRoot);
    const actualPaths = existingPaths.filter(it => {
      return !excludedPaths.includes(it) && !isIgnoredPattern(it);
    });

    const pkgJsonFilesDirs = pkgJson.files
      .filter(
        (it: string) => !it.startsWith('bin/') && !it.startsWith('build/')
      )
      .sort();
    assert.deepStrictEqual(actualPaths.sort(), pkgJsonFilesDirs);

    // Check bins
    const excludedBins = ['aworker', 'dev', 'node', 'turf', 'turfd'];
    const existingBins = fs.readdirSync(
      path.resolve(config.projectRoot, 'bin')
    );
    const actualBins = existingBins.filter(it => {
      return !excludedBins.includes(it) && !isIgnoredPattern(it);
    });

    const pkgJsonFilesBins = pkgJson.files
      .filter((it: string) => it.startsWith('bin/'))
      .map((it: string) => it.substring('bin/'.length))
      .sort();
    assert.deepStrictEqual(actualBins.sort(), pkgJsonFilesBins);

    // Check sources
    const excludedBuilds = ['test'];
    const existingBuilds = fs.readdirSync(
      path.resolve(config.projectRoot, 'build')
    );
    const actualBuilds = existingBuilds.filter(it => {
      return !excludedBuilds.includes(it) && !isIgnoredPattern(it);
    });

    const pkgJsonFilesBuilds = pkgJson.files
      .filter((it: string) => it.startsWith('build/'))
      .map((it: string) => it.substring('build/'.length))
      .sort();
    assert.deepStrictEqual(actualBuilds.sort(), pkgJsonFilesBuilds);
  });
});
