import { Server, Socket } from 'socket.io';

export function setupSockets(io: Server) {
  // Store global reference for controllers to emit events
  (global as any).__io = io;

  io.on('connection', (socket: Socket) => {
    // 1. Join restaurant room (for owner and general staff)
    socket.on('join:restaurant', (restaurantId: string) => {
      if (restaurantId) {
        socket.join(`restaurant_${restaurantId}`);
      }
    });

    // 2. Join kitchen room (for KDS staff)
    socket.on('join:kitchen', (restaurantId: string) => {
      if (restaurantId) {
        socket.join(`kitchen_${restaurantId}`);
      }
    });

    // 3. Join customer table session room (for active customer live tracking)
    socket.on('join:session', (sessionId: string) => {
      if (sessionId) {
        socket.join(`session_${sessionId}`);
      }
    });

    // 4. Join super admin room (for platform alerts)
    socket.on('join:admin', () => {
      socket.join('admin_platform');
    });

    socket.on('disconnect', () => {
      // Clean disconnect
    });
  });
}
