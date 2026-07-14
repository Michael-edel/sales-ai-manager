import { describe, expect, it } from "vitest";

import {
  MAX_AUDIO_UPLOAD_BYTES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  UploadPolicyError,
  validateUploadDescriptor,
} from "./upload-policy";

describe("validateUploadDescriptor", () => {
  it.each([
    ["photo.JPG", MAX_IMAGE_UPLOAD_BYTES],
    ["offer.pdf", MAX_DOCUMENT_UPLOAD_BYTES],
    ["voice.ogg", MAX_AUDIO_UPLOAD_BYTES],
  ])("accepts supported file %s at its limit", (fileName, size) => {
    expect(() => validateUploadDescriptor(fileName, size)).not.toThrow();
  });

  it("rejects unsupported extensions", () => {
    expect(() => validateUploadDescriptor("payload.exe", 100)).toThrow(UploadPolicyError);
  });

  it("rejects empty files", () => {
    expect(() => validateUploadDescriptor("offer.pdf", 0)).toThrow("Файл пустой");
  });

  it("rejects files above the class limit with status 413", () => {
    try {
      validateUploadDescriptor("offer.pdf", MAX_DOCUMENT_UPLOAD_BYTES + 1);
      throw new Error("Expected upload validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(UploadPolicyError);
      expect((error as UploadPolicyError).status).toBe(413);
    }
  });
});
