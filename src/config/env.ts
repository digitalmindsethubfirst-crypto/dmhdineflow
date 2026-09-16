import dotenv from 'dotenv';
dotenv.config();

const volumePath = process.env.RAILWAY_VOLUME_MOUNT_PATH;

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  jwtSecret: process.env.JWT_SECRET || 'dmh-dineflow-secret',
  uploadDir: process.env.UPLOAD_DIR || (volumePath ? `${volumePath}/uploads` : './uploads'),
  dbPath: process.env.DB_PATH || (volumePath ? `${volumePath}/db.json` : './data/db.json'),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};
