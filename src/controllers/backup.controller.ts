import { Router, Response } from 'express';
import { backupService } from '../services/backup.service';
import { AuthRequest, verifyToken, requireRole } from '../middleware/auth';
import multer from 'multer';

const router = Router();
const uploadMem = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max for backup restore

// GET /api/admin/backups (List all backups)
router.get('/admin/backups', verifyToken, requireRole('super_admin'), (_req: AuthRequest, res: Response) => {
  const list = backupService.listBackups();
  res.json(list);
});

// POST /api/admin/backups/create (Trigger manual backup)
router.post('/admin/backups/create', verifyToken, requireRole('super_admin'), async (_req: AuthRequest, res: Response) => {
  try {
    const backup = await backupService.createBackup('manual');
    res.json({ message: 'Backup created successfully.', backup });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate backup archive.' });
  }
});

// GET /api/admin/backups/:filename/download (Download backup zip)
router.get('/admin/backups/:filename/download', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const filePath = backupService.getBackupPath(req.params.filename);
  if (!filePath) {
    res.status(404).json({ error: 'Backup archive not found.' });
    return;
  }
  res.download(filePath, req.params.filename);
});

// POST /api/admin/backups/restore (Restore database from uploaded backup zip)
router.post('/admin/backups/restore', verifyToken, requireRole('super_admin'), uploadMem.single('backup_file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No backup file uploaded.' });
    return;
  }

  try {
    const result = await backupService.restoreBackup(req.file.buffer);
    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }
    res.json({ message: result.message });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to restore backup archive.' });
  }
});

// DELETE /api/admin/backups/:filename (Delete a backup file)
router.delete('/admin/backups/:filename', verifyToken, requireRole('super_admin'), (req: AuthRequest, res: Response) => {
  const success = backupService.deleteBackup(req.params.filename);
  if (!success) {
    res.status(404).json({ error: 'Backup file not found.' });
    return;
  }
  res.json({ message: 'Backup file deleted successfully.' });
});

export default router;
