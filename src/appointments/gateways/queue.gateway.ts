import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class QueueGateway {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(QueueGateway.name);

  // Method to handle clients joining a specific room based on their customerId
  @SubscribeMessage('join-customer-room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { customerId: string },
  ) {
    await client.join(data.customerId);
    this.logger.log(`🔌 Client ${data.customerId} joined the room.`);
  }

  // Method that our processors will call to emit real-time updates
  emitQueueUpdate(customerId: string, payload: any) {
    this.server.to(customerId).emit('queue-status-updated', payload);
    this.logger.log(`⚡ Queue status updated for client ${customerId}`);
  }
}
