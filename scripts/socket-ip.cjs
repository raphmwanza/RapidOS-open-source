/**
 * Preloaded with `node --require ./scripts/socket-ip.cjs` in front of `next start`/`next dev`.
 *
 * Next.js route handlers cannot see the TCP peer address, so this stamps it onto every
 * incoming request as `x-rapidos-socket-ip`, overwriting any value a client sent.
 * lib/clientIp.ts uses it as the client IP unless TRUSTED_PROXY is configured.
 */
'use strict';

const http = require('http');

const HEADER = 'x-rapidos-socket-ip';
const originalEmit = http.Server.prototype.emit;

http.Server.prototype.emit = function emit(event, req, ...rest) {
  if (event === 'request' && req && req.headers) {
    const addr = (req.socket && req.socket.remoteAddress) || '';
    req.headers[HEADER] = addr;
  }
  return originalEmit.call(this, event, req, ...rest);
};
