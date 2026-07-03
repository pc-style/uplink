type StoredObject = {
  key: string;
  bytes: Uint8Array;
  httpMetadata: R2HTTPMetadata;
  customMetadata: Record<string, string>;
  uploaded: Date;
  etag: string;
};

export class MemoryR2Bucket {
  readonly objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    const bytes = await toBytes(value);
    const stored: StoredObject = {
      key,
      bytes,
      httpMetadata: normalizeHttpMetadata(options?.httpMetadata),
      customMetadata: options?.customMetadata ?? {},
      uploaded: new Date(),
      etag: crypto.randomUUID(),
    };
    this.objects.set(key, stored);
    return toR2Object(stored);
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const object = toR2Object(stored);
    return {
      ...object,
      body: new Response(copyArrayBuffer(stored.bytes)).body!,
      bodyUsed: false,
      arrayBuffer: () => Promise.resolve(copyArrayBuffer(stored.bytes)),
      text: () => Promise.resolve(new TextDecoder().decode(stored.bytes)),
      json: async <T>() => JSON.parse(new TextDecoder().decode(stored.bytes)) as T,
      blob: () => Promise.resolve(new Blob([copyArrayBuffer(stored.bytes)], { type: stored.httpMetadata.contentType })),
    } as R2ObjectBody;
  }

  async head(key: string): Promise<R2Object | null> {
    const stored = this.objects.get(key);
    return stored ? toR2Object(stored) : null;
  }
}

function toR2Object(stored: StoredObject): R2Object {
  return {
    key: stored.key,
    version: "",
    size: stored.bytes.byteLength,
    etag: stored.etag,
    httpEtag: `"${stored.etag}"`,
    uploaded: stored.uploaded,
    checksums: { toJSON: () => ({}) },
    httpMetadata: stored.httpMetadata,
    customMetadata: stored.customMetadata,
    range: undefined,
    writeHttpMetadata(headers: Headers) {
      if (stored.httpMetadata.contentType) headers.set("content-type", stored.httpMetadata.contentType);
      if (stored.httpMetadata.contentDisposition) headers.set("content-disposition", stored.httpMetadata.contentDisposition);
      if (stored.httpMetadata.cacheControl) headers.set("cache-control", stored.httpMetadata.cacheControl);
      if (stored.httpMetadata.contentEncoding) headers.set("content-encoding", stored.httpMetadata.contentEncoding);
      if (stored.httpMetadata.contentLanguage) headers.set("content-language", stored.httpMetadata.contentLanguage);
      if (stored.httpMetadata.cacheExpiry) headers.set("expires", stored.httpMetadata.cacheExpiry.toUTCString());
    },
  } as R2Object;
}

async function toBytes(value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob): Promise<Uint8Array> {
  if (value === null) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ReadableStream) return new Uint8Array(await new Response(value).arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function normalizeHttpMetadata(metadata: R2HTTPMetadata | Headers | undefined): R2HTTPMetadata {
  if (!metadata) return {};
  if (metadata instanceof Headers) {
    return {
      contentType: metadata.get("content-type") ?? undefined,
      contentDisposition: metadata.get("content-disposition") ?? undefined,
      contentEncoding: metadata.get("content-encoding") ?? undefined,
      contentLanguage: metadata.get("content-language") ?? undefined,
      cacheControl: metadata.get("cache-control") ?? undefined,
      cacheExpiry: metadata.get("expires") ? new Date(metadata.get("expires")!) : undefined,
    };
  }
  return metadata;
}
