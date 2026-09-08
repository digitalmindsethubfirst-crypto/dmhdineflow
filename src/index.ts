import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { config } from './config/env';
import routes from './routes';
import { setupSockets } from './sockets';
import { db } from './db/database';

const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  },
});

setupSockets(io);

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure upload directory exists
const uploadDir = path.resolve(config.uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Serve uploaded assets with CORS support
app.use('/uploads', cors(), express.static(uploadDir));

// API Routes
app.use('/api', routes);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'DMH DineFlow SaaS API',
    timestamp: new Date().toISOString(),
    restaurants_count: db.count('restaurants'),
    orders_count: db.count('orders'),
  });
});

// Auto-seed on first start if database is empty
if (db.count('users') === 0) {
  console.log('Database empty, auto-seeding initial records...');
  require('./db/seed');
}

server.listen(config.port, () => {
  console.log(`=========================================`);
  console.log(`🚀 DMH DineFlow Backend Server Running`);
  console.log(`📡 URL: http://localhost:${config.port}`);
  console.log(`📂 Uploads: ${uploadDir}`);
  console.log(`=========================================`);
});
