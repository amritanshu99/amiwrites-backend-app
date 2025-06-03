// utils/cache.js
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 60 }); // 60 seconds default

module.exports = cache;
