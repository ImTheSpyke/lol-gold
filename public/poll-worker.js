/* Web Worker — fires an unthrottled tick every INTERVAL_MS */
var intervalId = null;

self.onmessage = function (e) {
  if (e.data.type === 'start') {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = setInterval(function () {
      self.postMessage({ type: 'tick' });
    }, e.data.intervalMs);
  } else if (e.data.type === 'stop') {
    if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
  }
};
