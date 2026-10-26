/**
 * The proxy sink: a loopback listener the harness holds for the whole run, which drops every
 * connection at once. The run's proxy variables and the browser's proxy point at it, so a request
 * meant for anywhere else fails, and no other process can take the port meanwhile.
 */
import net from 'node:net'

export function startSink() {
  let dropped = 0
  const server = net.createServer(socket => {
    dropped++
    socket.destroy()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        dropped: () => dropped,
        close: () => new Promise(done => server.close(() => done())),
      })
    })
  })
}
