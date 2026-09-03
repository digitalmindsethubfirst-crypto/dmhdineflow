import { Router, Response } from 'express';
import { upload } from '../middleware/upload';
import { AuthRequest, verifyToken } from '../middleware/auth';

const router = Router();

// POST /api/upload
router.post('/upload', verifyToken, upload.single('file'), (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded.' });
    return;
  }

  res.json({
    url: `/uploads/${req.file.filename}`,
    filename: req.file.filename,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

export default router;
