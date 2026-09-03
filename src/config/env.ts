import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  jwtSecret: process.env.JWT_SECRET || 'dmh-dineflow-secret',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  dbPath: process.env.DB_PATH || './data/db.json',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};
