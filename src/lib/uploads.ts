import yauzl from "yauzl";
import { randomUUID } from "node:crypto";
import { config, isLoopback } from "./config";
import { AppError, invariant } from "./errors";
import { digest } from "./signing";
import { query } from "./db";
import { storageClient } from "./auth";

export function uploadFileName(request:Request) {
  const value=request.headers.get('x-file-name')||'';
  invariant(value.length<=1000,'FILE_NAME','Invalid filename.',400);
  try{return decodeURIComponent(value);}catch{throw new AppError('FILE_NAME','Invalid filename encoding.',400);}
}
export async function validateFile(
  bytes: Buffer,
  filename: string,
  mime: string,
  max = 5 * 1024 * 1024,
) {
  invariant(
    bytes.length > 0 && bytes.length <= max,
    "FILE_SIZE",
    "CV must be between 1 byte and 5 MiB.",
    413,
  );
  invariant(
    filename.length <= 180 && !/[\x00-\x1f/\\]/.test(filename),
    "FILE_NAME",
    "Invalid filename.",
    400,
  );
  if (filename.toLowerCase().endsWith(".pdf")) {
    invariant(
      mime === "application/pdf" && bytes.subarray(0, 5).toString() === "%PDF-",
      "INVALID_PDF",
      "Choose a valid PDF file.",
      415,
    );
    const text = bytes.toString("latin1").replace(/#([a-f0-9]{2})/gi,(_,hex:string)=>String.fromCharCode(parseInt(hex,16)));
    invariant(
      /%%EOF\s*$/.test(text) &&
        /\b\d+\s+\d+\s+obj\b/.test(text) &&
        /\/Type\s*\/Catalog\b/.test(text) &&
        /\/Root\b/.test(text),
      "INVALID_PDF",
      "PDF structure could not be verified.",
      415,
    );
    invariant(
      !/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|Encrypt|RichMedia)\b/i.test(
        text,
      ),
      "ACTIVE_CONTENT",
      "Active or encrypted PDF content is not accepted. Export a plain PDF.",
      415,
    );
    return "application/pdf";
  }
  invariant(
    filename.toLowerCase().endsWith(".docx") &&
      mime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
      bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])),
    "UNSUPPORTED_FILE",
    "Choose one PDF or DOCX CV.",
    415,
  );
  await new Promise<void>((resolve, reject) =>
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new AppError("INVALID_DOCX", "Invalid DOCX archive.", 415));
          return;
        }
        let total = 0,
          count = 0,
          failed = false;
        const required = new Set([
          "[Content_Types].xml",
          "_rels/.rels",
          "word/document.xml",
        ]);
        const seen = new Set<string>();
        const fail = () => {
          if (!failed) {
            failed = true;
            zip.close();
            reject(
              new AppError(
                "UNSAFE_DOCX",
                "Unsafe or invalid DOCX package.",
                415,
              ),
            );
          }
        };
        zip.on("error", fail);
        zip.on("end", () => {
          if (!failed) {
            if (required.size) fail();
            else resolve();
          }
        });
        zip.on("entry", (entry: yauzl.Entry) => {
          total += entry.uncompressedSize;
          count++;
          if (
            count > 1500 ||
            total > 20 * 1024 * 1024 ||
            entry.uncompressedSize > 8 * 1024 * 1024 ||
            entry.fileName.includes("..") ||
            entry.fileName.startsWith("/") ||
            /^[a-z]:/i.test(entry.fileName) ||
            seen.has(entry.fileName) ||
            entry.generalPurposeBitFlag & 1 ||
            /vbaProject|activeX|embeddings/i.test(entry.fileName)
          ) {
            fail();
            return;
          }
          seen.add(entry.fileName);
          if (entry.fileName.endsWith("/")) {
            zip.readEntry();
            return;
          }
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) {
              fail();
              return;
            }
            let actual = 0;
            const parts: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => {
              actual += chunk.length;
              if (actual > entry.uncompressedSize || actual > 8 * 1024 * 1024) {
                stream.destroy();
                fail();
              } else if (/\.xml$|\.rels$/.test(entry.fileName))
                parts.push(chunk);
            });
            stream.on("error", fail);
            stream.on("end", () => {
              if (failed) return;
              if (actual !== entry.uncompressedSize) {
                fail();
                return;
              }
              const xml = Buffer.concat(parts).toString("utf8");
              if (
                /<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External|<script/i.test(
                  xml,
                )
              ) {
                fail();
                return;
              }
              if (required.has(entry.fileName)) {
                if (
                  entry.fileName === "word/document.xml" &&
                  !/<w:document[\s>]/.test(xml)
                ) {
                  fail();
                  return;
                }
                if (
                  entry.fileName === "[Content_Types].xml" &&
                  !xml.includes("wordprocessingml.document.main+xml")
                ) {
                  fail();
                  return;
                }
                if (
                  entry.fileName === "_rels/.rels" &&
                  !xml.includes("officeDocument")
                ) {
                  fail();
                  return;
                }
                required.delete(entry.fileName);
              }
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    ),
  );
  return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
export async function saveUpload(
  bytes: Buffer,
  filename: string,
  mime: string,
  purpose: "public" | "gmail",
  jobCode?: string,
) {
  const c = config(),
    type = await validateFile(bytes, filename, mime, c.UPLOAD_MAX_BYTES),
    sha = digest(bytes);
  let scan: "clean" | "synthetic_unscanned";
  if (c.SCANNER_URL) {
    const result = await fetch(c.SCANNER_URL, {
      method: "POST",
      body: new Uint8Array(bytes),
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Content-SHA256": sha,
      },
      signal: AbortSignal.timeout(20000),
    });
    const verdict = await result.json();
    invariant(
      result.ok && verdict.clean === true && verdict.sha256 === sha,
      "SCAN_REJECTED",
      "The CV did not pass file scanning.",
      415,
    );
    scan = "clean";
  } else {
    invariant(
      c.ALLOW_SYNTHETIC_UNSCANNED === "true" && isLoopback(c.APP_URL),
      "SCANNER_UNAVAILABLE",
      "File scanning is unavailable. Please try later.",
      503,
    );
    scan = "synthetic_unscanned";
  }
  let jobId: string | null = null;
  if (purpose === "public") {
    const job = (
      await query("select id from jobs where job_code=$1 and status='open'", [
        jobCode,
      ])
    ).rows[0];
    invariant(
      job,
      "JOB_UNAVAILABLE",
      "This job is not accepting applications.",
      409,
    );
    jobId = job.id;
  }
  const path =
    randomUUID() +
    "/" +
    randomUUID() +
    (type === "application/pdf" ? ".pdf" : ".docx");
  const storage = storageClient().storage.from("candidate-cvs");
  const { error } = await storage.upload(path, bytes, {
    contentType: type,
    upsert: false,
  });
  if (error)
    throw new AppError(
      "UPLOAD_UNAVAILABLE",
      "CV could not be saved. Please retry.",
      503,
      true,
    );
  try {
    const row = (
      await query(
        `insert into uploads(purpose,job_id,object_path,original_name,media_type,byte_size,sha256,scan_status) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,expires_at`,
        [purpose, jobId, path, filename, type, bytes.length, sha, scan],
      )
    ).rows[0];
    return { upload_handle: row.id, expires_at: row.expires_at };
  } catch (e) {
    await storage.remove([path]);
    throw e;
  }
}
export async function signedCv(uploadId: string) {
  const file = (
    await query(
      "select object_path from uploads where id=$1 and consumed_at is not null",
      [uploadId],
    )
  ).rows[0];
  invariant(file, "FILE_NOT_FOUND", "CV not found.", 404);
  const { data, error } = await storageClient()
    .storage.from("candidate-cvs")
    .createSignedUrl(file.object_path, 300, { download: "candidate-cv" });
  if (error || !data)
    throw new AppError(
      "FILE_UNAVAILABLE",
      "CV is temporarily unavailable.",
      503,
      true,
    );
  return data.signedUrl;
}
