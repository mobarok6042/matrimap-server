import { Router } from "express";
import multer from "multer";
import { HttpError } from "../lib/http-error.js";
import { uploadToImgBb } from "../lib/imgbb.js";
import { requireAuth } from "../middleware/require-auth.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.startsWith("image/")) {
      callback(null, true);
    } else {
      callback(new HttpError(400, "Only image files are allowed."));
    }
  },
});

export const uploadRouter = Router();

/** POST /api/upload/image  (multipart field name: "image") */
uploadRouter.post("/image", requireAuth, upload.single("image"), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(400, 'No image provided. Use the "image" form field.');

    const result = await uploadToImgBb(req.file.buffer, req.file.originalname);
    res.json(result);
  } catch (error) {
    next(error);
  }
});
