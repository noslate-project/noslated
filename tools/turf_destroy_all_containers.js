'use strict';

const path = require('path');

const { Turf } = require('#self/lib/turf/wrapper');

const turf = new Turf(path.join(__dirname, '../bin/turf'));

turf.destroyAll();
