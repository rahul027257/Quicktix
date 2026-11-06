import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config';
import { badRequest } from './errors';

const MAX_BYTES = 5 * 1024 * 1024;

/** Accepts up to 5 MB images in memory; the content is verified by magic bytes before it touches disk. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 3, fields: 30 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(badRequest('Only JPEG, PNG or WebP images are allowed', 'INVALID_FILE'));
  },
});

function sniff(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

export type UploadKind = 'banners' | 'upi-qr' | 'proofs';
// Payment proofs are private (served only through an authorised API route); the rest are public.
const baseDir = (kind: UploadKind) => path.join(config.uploadRoot, kind === 'proofs' ? 'private' : 'public', kind);

export const publicUploadsDir = () => path.join(config.uploadRoot, 'public');

/** Saves a validated image and returns the stored reference (public: URL path, proofs: file name). */
export async function saveImage(file: Express.Multer.File, kind: UploadKind): Promise<string> {
  const ext = sniff(file.buffer);
  if (!ext) throw badRequest('That file is not a valid image', 'INVALID_FILE');
  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.mkdir(baseDir(kind), { recursive: true });
  await fs.writeFile(path.join(baseDir(kind), name), file.buffer);
  return kind === 'proofs' ? name : `/uploads/${kind}/${name}`;
}

export function proofFilePath(name: string) {
  return path.join(baseDir('proofs'), path.basename(name));
}

export async function removeUpload(ref: string | null | undefined, kind: UploadKind) {
  if (!ref) return;
  await fs.rm(path.join(baseDir(kind), path.basename(ref)), { force: true }).catch(() => undefined);
}
