/** Save text the browser holds as a file, through a temporary object URL and a clicked link. */
export function downloadFile(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // Revoke after the click is processed; revoking synchronously can yield an
  // empty download on Firefox/Safari before the Blob is read.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
