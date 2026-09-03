import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { config } from '../config/env';
import { db } from '../db/database';

export interface BackupMetadata {
  filename: string;
  size: number;
  sizeFormatted: string;
  createdAt: string;
  type: 'auto' | 'manual';
}

const BACKUP_DIR = path.resolve('./data/backups');

export class BackupService {
  constructor() {
    this.ensureBackupDir();
    this.startAutoBackupSchedule();
  }

  private ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Create full snapshot backup (database + uploaded assets)
  async createBackup(type: 'auto' | 'manual' = 'manual'): Promise<BackupMetadata> {
    this.ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `dineflow_backup_${type}_${timestamp}.zip`;
    const filePath = path.join(BACKUP_DIR, filename);

    const zip = new JSZip();

    // 1. Include current database file
    const dbFilePath = path.resolve(config.dbPath);
    if (fs.existsSync(dbFilePath)) {
      const dbContent = fs.readFileSync(dbFilePath, 'utf-8');
      zip.file('database/db.json', dbContent);
    }

    // 2. Include backup metadata & summary
    const meta = {
      createdAt: new Date().toISOString(),
      type,
      restaurantsCount: db.count('restaurants'),
      ordersCount: db.count('orders'),
      usersCount: db.count('users'),
      version: '1.0.0',
    };
    zip.file('metadata.json', JSON.stringify(meta, null, 2));

    // 3. Include uploaded assets
    const uploadDir = path.resolve(config.uploadDir);
    if (fs.existsSync(uploadDir)) {
      const uploadFiles = fs.readdirSync(uploadDir);
      for (const file of uploadFiles) {
        const fullPath = path.join(uploadDir, file);
        if (fs.statSync(fullPath).isFile()) {
          zip.file(`uploads/${file}`, fs.readFileSync(fullPath));
        }
      }
    }

    // Generate zip buffer and save to disk
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    });

    fs.writeFileSync(filePath, zipBuffer);
    const stats = fs.statSync(filePath);

    // Keep only last 10 backups to preserve disk space
    this.rotateBackups();

    return {
      filename,
      size: stats.size,
      sizeFormatted: this.formatBytes(stats.size),
      createdAt: new Date().toISOString(),
      type,
    };
  }

  // List all available backups
  listBackups(): BackupMetadata[] {
    this.ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.zip'));

    const list: BackupMetadata[] = files.map((file) => {
      const fullPath = path.join(BACKUP_DIR, file);
      const stats = fs.statSync(fullPath);
      return {
        filename: file,
        size: stats.size,
        sizeFormatted: this.formatBytes(stats.size),
        createdAt: stats.mtime.toISOString(),
        type: file.includes('_auto_') ? 'auto' : 'manual',
      };
    });

    // Sort newest first
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  // Get path for download
  getBackupPath(filename: string): string | null {
    const safeName = path.basename(filename);
    const fullPath = path.join(BACKUP_DIR, safeName);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
    return null;
  }

  // Restore database from zip backup
  async restoreBackup(backupZipBuffer: Buffer): Promise<{ success: boolean; message: string }> {
    try {
      const zip = await JSZip.loadAsync(backupZipBuffer);
      const dbFile = zip.file('database/db.json');

      if (!dbFile) {
        throw new Error('Invalid backup archive: missing database/db.json');
      }

      const dbJson = await dbFile.async('string');
      const parsedData = JSON.parse(dbJson);

      // Restore data to active database instance
      db.setData(parsedData);

      // Extract uploaded assets if present
      const uploadDir = path.resolve(config.uploadDir);
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

      const uploadFolder = zip.folder('uploads');
      if (uploadFolder) {
        for (const [relativePath, file] of Object.entries(uploadFolder.files)) {
          if (!file.dir) {
            const content = await file.async('nodebuffer');
            fs.writeFileSync(path.join(uploadDir, path.basename(relativePath)), content);
          }
        }
      }

      return { success: true, message: 'Database and assets successfully restored.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Failed to restore backup.' };
    }
  }

  // Delete specific backup
  deleteBackup(filename: string): boolean {
    const safeName = path.basename(filename);
    const fullPath = path.join(BACKUP_DIR, safeName);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      return true;
    }
    return false;
  }

  // Retention rotation: Keep maximum 15 newest backups
  private rotateBackups() {
    const list = this.listBackups();
    if (list.length > 15) {
      const toDelete = list.slice(15);
      for (const b of toDelete) {
        this.deleteBackup(b.filename);
      }
    }
  }

  // Automated cron/timer scheduler (Runs every 12 hours)
  private startAutoBackupSchedule() {
    // Initial auto-backup check on startup (if no backups exist yet)
    setTimeout(async () => {
      const existing = this.listBackups();
      if (existing.length === 0) {
        console.log('🔄 Performing initial automated backup...');
        await this.createBackup('auto');
      }
    }, 5000);

    // Recurring 12-hour automated backup interval
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;
    setInterval(async () => {
      try {
        console.log('🔄 Executing scheduled automated system backup...');
        await this.createBackup('auto');
      } catch (err) {
        console.error('Auto backup failed:', err);
      }
    }, TWELVE_HOURS);
  }
}

export const backupService = new BackupService();
