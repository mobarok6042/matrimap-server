import { env } from "../config/env.js";
import { HttpError } from "./http-error.js";

export interface ImgBbResult {
  id: string;
  url: string;
  displayUrl: string;
  deleteUrl: string;
}

interface ImgBbResponse {
  success: boolean;
  status: number;
  error?: { message?: string };
  data?: {
    id: string;
    url: string;
    display_url: string;
    delete_url: string;
  };
}

/** Uploads a single in-memory image to ImgBB and returns the hosted URLs. */
export async function uploadToImgBb(image: Buffer, name?: string): Promise<ImgBbResult> {
  if (!env.IMGBB_API_KEY) {
    throw new HttpError(503, "Image uploads are temporarily unavailable.");
  }

  const body = new URLSearchParams({
    key: env.IMGBB_API_KEY,
    image: image.toString("base64"),
  });
  if (name) body.set("name", name);

  let response: Response;
  try {
    response = await fetch("https://api.imgbb.com/1/upload", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    console.error("[matrimap:imgbb] Upload request failed", error);
    throw new HttpError(502, "We could not upload this image. Please try again later.");
  }

  const payload = (await response.json()) as ImgBbResponse;

  if (!response.ok || !payload.success || !payload.data) {
    console.warn("[matrimap:imgbb] Image upload was rejected", { status: payload.status });
    throw new HttpError(502, "We could not upload this image. Please try another image.");
  }

  return {
    id: payload.data.id,
    url: payload.data.url,
    displayUrl: payload.data.display_url,
    deleteUrl: payload.data.delete_url,
  };
}
