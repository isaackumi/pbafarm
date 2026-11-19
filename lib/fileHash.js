/** SHA-256 of a File/Blob as hex, declared to files.generateUploadUrl (CF-004). */
export async function sha256HexOfFile(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
