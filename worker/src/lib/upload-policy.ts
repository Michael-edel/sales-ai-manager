export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_REQUEST_BYTES = MAX_AUDIO_UPLOAD_BYTES + 1024 * 1024;

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".wav", ".ogg", ".opus", ".webm"];
const DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".xlsx"];

export class UploadPolicyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "UploadPolicyError";
  }
}

export function isImageFile(fileName: string): boolean {
  return hasExtension(fileName, IMAGE_EXTENSIONS);
}

export function isAudioFile(fileName: string): boolean {
  return hasExtension(fileName, AUDIO_EXTENSIONS);
}

export function isDocumentFile(fileName: string): boolean {
  return hasExtension(fileName, DOCUMENT_EXTENSIONS);
}

export function validateUploadDescriptor(fileName: string, size: number): void {
  const normalizedName = fileName.trim().toLowerCase();
  if (!isImageFile(normalizedName) && !isAudioFile(normalizedName) && !isDocumentFile(normalizedName)) {
    throw new UploadPolicyError(
      "Формат файла не поддерживается. Используйте PDF, DOCX, XLSX, PNG, JPG, WEBP, MP3, M4A, WAV, OGG, OPUS или WEBM.",
    );
  }
  if (!Number.isFinite(size) || size <= 0) throw new UploadPolicyError("Файл пустой.");

  const maxBytes = isImageFile(normalizedName)
    ? MAX_IMAGE_UPLOAD_BYTES
    : isDocumentFile(normalizedName)
      ? MAX_DOCUMENT_UPLOAD_BYTES
      : MAX_AUDIO_UPLOAD_BYTES;
  if (size > maxBytes) {
    throw new UploadPolicyError(
      `Файл слишком большой. Максимальный размер для этого формата: ${maxBytes / 1024 / 1024} МБ.`,
      413,
    );
  }
}

function hasExtension(fileName: string, extensions: string[]): boolean {
  const normalizedName = fileName.trim().toLowerCase();
  return extensions.some((extension) => normalizedName.endsWith(extension));
}
