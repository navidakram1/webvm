export async function autoConfSockets() {
  return {
    tcpSocket: TCPSocket,
    tcpServer: TCPServerSocket,
    udpSocket: UDPSocket,
  };
}
