'use strict';

// eslint-disable-next-line no-unused-vars
exports.handler = async (ctx, req, res) => {
  await new Promise((resolve) => {
    setTimeout(resolve, 2000);
  });
};
