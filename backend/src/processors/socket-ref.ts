import type { Server as SocketIOServer } from 'socket.io';

/**
 * Module-level reference to the Socket.io Server instance.
 *
 * Set by the socketio plugin on initialization. Used by BullMQ
 * processors to emit real-time events from background job workers
 * (which run in the same process but outside the request context).
 */
export const ioRef = {
  _io: null as SocketIOServer | null,
  get(): SocketIOServer | null {
    return this._io;
  },
  set(io: SocketIOServer): void {
    this._io = io;
  },
};
