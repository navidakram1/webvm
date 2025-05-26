// import {getDumpIP} from "./tun/tailscale_tun_auto.js"

export class DirectNetwork {
  constructor() {}
  tcpSocket(ip, port, options) {
    return new TCPSocketClient(ip, port, options);
  }
  // directServerSocket(localAddress, options) {
  //   return new DirectTCPServer(localAddress, options);
  // }
}

function uint32ToIp(uint32) {
  // backwards from what I thought?
  const a = uint32 & 0xFF;              // First byte
  const b = (uint32 >>> 8) & 0xFF;      // Second byte
  const c = (uint32 >>> 16) & 0xFF;     // Third byte
  const d = (uint32 >>> 24) & 0xFF;     // Fourth byte

  return `${a}.${b}.${c}.${d}`;
}

export class TCPSocketClient {
  constructor(ip, port, options) {
    this.localPort = null;
    this.socket = null;
    this.remoteAddress = null;
    this.remotePort = null;
    this.options = null;

    this.readable = null;
    this.writable = null;

    let ip_string = uint32ToIp(ip);

    this.socket = new TCPSocket(ip_string, port, options);
    console.log(`Created new TCPSocket: ip=[${ip_string}], port=[${port}], options=[${options}]`);
  }
  async connect() {
    try {
      const {readable, writable} = await this.socket.opened;
      if (readable && writable) {
        this.readable = readable;
        this.writable = writable;
        console.log("writable, readable: ", writable, readable);
        console.log("return 0");
        return 0;
      }
      console.log("return 1");
      return 1;
    } catch (e) {
      console.error(`TCPSocketClient failed to connect: `, e);
      return 2
    }
  }
  async send(data) {
    try {
      console.log("WEBVM: SEND");
      const writer = this.writable.getWriter();
      await writer.write(data);
      writer.releaseLock();
      return 0
    } catch (e) {
      console.log("Error sending: ", e);
      return 1;
    }
  }
  async recv() {
    try {
      console.log("WEBVM: RECV");
      const reader = this.readable.getReader();
      while (true) {
        const {value, done} = await reader.read();
        if (done) {
          break;
        }
        console.log("value in recv(): ", value);
        reader.releaseLock();
        return value;
      }
      reader.releaseLock();
    } catch (e) {
      console.log("Error Receiving: ", e);
      return null;
    }
    return null;
  }
  async close() {
    try {
      console.log("WEBVM: CLOSE");
      await this.socket.close();
      console.log("WEBVM: CLOSED");
      return 0
    } catch (e) {
      console.log("Error closing: ", e);
      return 1;
    }
  }
}


export async function autoConfSockets() {
  console.log(`AutoConfSockets running`);
  return {tcpSocket: TCPSocketClient}
}


export class DirectTCPServer {
  constructor(localAddress, options) {
    this.server = null;
    this.localAddress = localAddress;
    this.readable = null;

    let str =uint32ToIp(localAddress);
    this.server = new TCPServerSocket(localAddress, options);
    console.log(`Created new ServerSocket: localAddress = [${localAddress}], options = [${options}]`);
  }

  async bind() {
    this.readable = await this.server.opened;
    const reader = this.readable.getReader();

    while (true) {
      const {value: acceptedSocket, done} = await reader.read();
      if (done) {
        break;
      }
      console.log(`New Socket connected to server: `, value);
    }

    reader.releaseLock();
  }

  close() {
    this.server.close();
  }
}
