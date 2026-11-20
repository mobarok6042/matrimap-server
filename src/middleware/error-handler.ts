import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { HttpError } from "../lib/http-error.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.originalUrl}` });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Image must be smaller than 5 MB."
        : error.message;
    res.status(400).json({ error: message });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  console.error("[matrimap:error]", error);
  res.status(500).json({ error: "Internal server error" });
};
