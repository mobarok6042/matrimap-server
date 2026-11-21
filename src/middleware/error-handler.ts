import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { HttpError } from "../lib/http-error.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "The requested resource could not be found." });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? "Image must be smaller than 5 MB."
        : "We could not process the uploaded file. Please choose another image.";
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
