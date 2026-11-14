// archiver 8 ships no types and @types/archiver still describes v7's default
// export, which v8 dropped. This covers only what carousel.ts uses.
declare module 'archiver' {
  import type { Writable } from 'stream'

  export interface ZipArchiveOptions {
    zlib?: { level?: number }
  }

  export class ZipArchive {
    constructor(options?: ZipArchiveOptions)
    on(event: 'error' | 'warning', listener: (err: Error) => void): this
    pipe<T extends Writable>(destination: T): T
    file(filepath: string, data: { name: string }): this
    finalize(): Promise<void>
  }
}
