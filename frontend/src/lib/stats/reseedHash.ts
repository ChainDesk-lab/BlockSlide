/** Checksums for reseed files. Node only (not for the browser). */
import { createHash } from "node:crypto";

export const digest = (algo: "sha1" | "sha256", text: string): string => createHash(algo).update(text, "utf8").digest("hex");
