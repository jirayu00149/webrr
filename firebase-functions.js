const { onRequest } = require("firebase-functions/v2/https");
const { handleRequest } = require("./server");

exports.app = onRequest(
  {
    region: "asia-southeast1",
    memory: "1GiB",
    timeoutSeconds: 540,
    minInstances: 1
  },
  handleRequest
);
