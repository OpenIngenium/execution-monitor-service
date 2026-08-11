/**
 * Reusable mock factories for the execution-monitor-service unit tests.
 * None of these perform real I/O.
 */

/**
 * A mock logger exposing every level used by index.js.
 */
function createMockLogger() {
  return {
    critical: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn()
  };
}

/**
 * A mock Socket.IO socket.
 *
 * Event handlers registered via socket.on() are captured in `handlers` so that
 * tests can invoke them directly and assert on the resulting behavior.
 */
function createMockSocket(handshake) {
  var handlers = {};
  return {
    handshake: handshake || {query: {}, address: '127.0.0.1'},
    handlers: handlers,
    join: jest.fn(),
    on: jest.fn(function(event, handler) {
      handlers[event] = handler;
    }),
    emit: function(event) {
      if (handlers[event]) {
        var args = Array.prototype.slice.call(arguments, 1);
        return handlers[event].apply(null, args);
      }
    }
  };
}

/**
 * A mock Socket.IO namespace (the subscribe namespace collaborator used by the
 * publish connection handler).
 */
function createMockNamespace() {
  var emit = jest.fn();
  var to = jest.fn(function() {
    return {emit: emit};
  });
  return {
    to: to,
    emit: emit
  };
}

/**
 * A mock Express response object.
 */
function createMockResponse() {
  return {
    sendFile: jest.fn(),
    setHeader: jest.fn(),
    end: jest.fn()
  };
}

module.exports = {
  createMockLogger: createMockLogger,
  createMockSocket: createMockSocket,
  createMockNamespace: createMockNamespace,
  createMockResponse: createMockResponse
};
