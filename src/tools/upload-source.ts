import { readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, sep } from "node:path";
import { z } from "zod";
import type { UploadFile } from "../canvas/client.js";

// Canvas accepts larger files, but everything is buffered in memory here
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export const uploadSourceFields = {
    file_path: z
        .string()
        .optional()
        .describe(
            "Absolute path of a file on the MCP server host. Only works when the server runs on the same machine as the file and the path is inside CANVAS_UPLOAD_ROOTS.",
        ),
    content_base64: z
        .string()
        .optional()
        .describe("File bytes sent by the client as base64. Use when the server cannot see the file; requires filename."),
    filename: z
        .string()
        .min(1)
        .optional()
        .describe("Name Canvas should store. Required with content_base64; defaults to the basename of file_path."),
    content_type: z.string().optional().describe("MIME type. Canvas guesses from the extension when omitted."),
};

export interface UploadSourceArgs {
    file_path?: string | undefined;
    content_base64?: string | undefined;
    filename?: string | undefined;
    content_type?: string | undefined;
}

export function hasUploadSource(args: UploadSourceArgs): boolean {
    return args.file_path !== undefined || args.content_base64 !== undefined;
}

/** reads exactly one of file_path or content_base64 into memory */
export async function readUploadSource(args: UploadSourceArgs, uploadRoots: readonly string[]): Promise<UploadFile> {
    if ((args.file_path === undefined) === (args.content_base64 === undefined)) {
        throw new Error("Provide exactly one of file_path or content_base64.");
    }
    const { bytes, defaultName } = args.file_path !== undefined
        ? await readAllowedPath(args.file_path, uploadRoots)
        : { bytes: decodeBase64(args.content_base64 ?? ""), defaultName: undefined };

    const name = args.filename ?? defaultName;
    if (!name) throw new Error("filename is required with content_base64.");
    if (bytes.byteLength === 0) throw new Error("Refusing to upload an empty file.");
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new Error(`File is ${bytes.byteLength} bytes; the limit is ${MAX_UPLOAD_BYTES}.`);
    }
    return { name, bytes, ...(args.content_type ? { contentType: args.content_type } : {}) };
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
    const compact = value.replace(/\s+/g, "");
    if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
        throw new Error("content_base64 is not valid base64.");
    }
    return Buffer.from(compact, "base64");
}

async function readAllowedPath(
    filePath: string,
    uploadRoots: readonly string[],
): Promise<{ bytes: Uint8Array<ArrayBuffer>; defaultName: string }> {
    if (uploadRoots.length === 0) {
        throw new Error(
            "file_path uploads are disabled on this server (CANVAS_UPLOAD_ROOTS is not set). Send content_base64 instead.",
        );
    }
    if (!isAbsolute(filePath)) throw new Error("file_path must be absolute.");

    let real: string;
    try {
        real = await realpath(filePath);
    } catch {
        throw new Error(`file_path does not exist or is not readable: ${filePath}`);
    }

    // a symlink can point anywhere, so the check runs on the resolved path,
    // and hidden segments below a root (.ssh, .env, .config) stay off limits
    const allowed = await Promise.all(uploadRoots.map(async (root) => {
        const realRoot = await realpath(root).catch(() => undefined);
        if (!realRoot) return false;
        const rel = relative(realRoot, real);
        if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;
        return !rel.split(sep).some((segment) => segment.startsWith("."));
    }));
    if (!allowed.some(Boolean)) {
        throw new Error("file_path is outside CANVAS_UPLOAD_ROOTS or inside a hidden directory.");
    }

    const info = await stat(real);
    if (!info.isFile()) throw new Error("file_path must point to a regular file.");
    if (info.size > MAX_UPLOAD_BYTES) {
        throw new Error(`File is ${info.size} bytes; the limit is ${MAX_UPLOAD_BYTES}.`);
    }
    return { bytes: await readFile(real), defaultName: basename(real) };
}
