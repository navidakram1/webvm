import { TCPSocketClient  } from "./TCPSocketClient";

export class TCPProxy {
  constructor() {
    this.server = null;
    this.inboundConnections = new Map();  // inboundID -> TCPSocketClient
    this.outboundConnections = new Map(); // outboundID -> TCPSocketClient
    this.forwardingPairs = new Map();     // inboundID -> outboundID
    this.reverseForwardingPairs = new Map(); // outboundID -> inboundID
    this._reader = null;

    this.nextConnectionID = 1;

    // event callbacks
    this.onServerStart = null;
    this.onInboundConnect = null;
    this.onOutboundConnect = null;
    this.onInboundData = null;
    this.onOutboundData = null;
    this.onInboundClose = null;
    this.onOutboundClose = null;
    this.onClose = null;
    this.onError = null;
  }

  _generateConnectionID() {
    return this.nextConnectionID++;
  }

  async start(localAddress, options = {}) {
    try {
      this.server = new TCPServerSocket(localAddress, options);
      console.log(`Server created: `, this.server);


      const openInfo = await this.server.opened;
      const { readable, localAddress: boundAddress, localPort } = openInfo;

      // this logs undefined, not sure what to think of that... but seems to work anyways?
      console.log(`opened properties: `, Object.getOwnPropertyDescriptor(this.server, 'opened'));
      console.log(`server properties: `, Object.getOwnPropertyDescriptor(this.server));

      console.log(`TCPProxy started on ${boundAddress}:${localPort}`);
      if (this.onServerStart) {
        this.onServerStart(openInfo);
      }

      this._reader = readable.getReader();

      // accept connections in a loop
      (async () => {
        try {
          while (true) {
            const {value: incomingSocket, done} = await this._reader.read();
            if (done) {
              console.log(`Server stopped accepting connections`);
              this._reader.releaseLock();
              this._reader = null;
              break;
            }
            this._handleIncomingConnection(incomingSocket); // can get client ID here if we have use for that later
          }
        } catch (e) {
          console.error(`Error accepting connections: `, e);
          if (this.onError) {
            this.onError(e);
          }
        }
      })();
      return openInfo;
    } catch (e) {
      console.error(`Failed to start Proxy server: `, e);
      if (this.onError) {
        this.onError(e);
      }
      throw e;
    }
  }

  async _handleIncomingConnection(incomingSocket) {
    try {
      const connectionID = this._generateConnectionID();
      console.log(`Assigned id: ${connectionID}`);
      const inboundClient = new TCPSocketClient();
      inboundClient.socket = incomingSocket;

      const openInfo = await incomingSocket.opened;
      inboundClient._readable = openInfo.readable;
      inboundClient._writable = openInfo.writable;

      inboundClient.onData = (data) => {
        this._handleInboundData(connectionID, data);
      };
      inboundClient.onClose = () => {
        this._handleInboundClose(connectionID);
      };
      inboundClient.onError = (e) => {
        if (this.onError) {
          this.onError('inbound', connectionID, e);
        }
      };

      inboundClient._startReading();
      this.inboundConnections.set(connectionID, inboundClient);
      console.log(`Accepted inbound connection ${connectionID} from ${openInfo.remoteAddress}:${openInfo.remotePort}`);
      if (this.onInboundConnect) {
        this.onInboundConnect(connectionID, openInfo);
      }

      return connectionID;
    } catch (e) {
      console.error(`Error handling incoming connection: `, e);
      if (this.onError) {
        this.onError(`inbound`, `unknown`, e);
      }
    }
  }

  _handleInboundData(inboundID, data) {
    if (!data || data.byteLength === 0) {
      return;
    }
    if (this.onInboundData) {
      this.onInboundData(inboundID, data);
    }

    const outboundID = this.forwardingPairs.get(inboundID);
    if (!outboundID) {
      return;
    }
    const outboundClient = this.outboundConnections.get(outboundID);
    if (!outboundClient) {
      return;
    }

    outboundClient.send(data).catch((e) => {
      console.error(`Error forwarding data to outbound connection ${outboundID}`);
      if (this.onError) {
        this.onError(`outbound`, outboundID, e);
      }
    });
  }

  _handleOutboundData(outboundID, data) {
    if (!data || data.byteLength === 0) {
      return;
    }
    if (this.onOutboundData) {
      this.onOutboundData(outboundID, data);
    }

    const inboundID = this.reverseForwardingPairs.get(outboundID);
    if (!inboundID) {
      return;
    }
    const inboundClient = this.inboundConnections.get(inboundID);
    if (!inboundClient) {
      return;
    }

    inboundClient.send(data).catch((e) => {
      console.error(`Error forward data to inbound connection ${inboundID}`);
      if (this.onError) {
        this.onError(`inbound`, inboundID, e);
      }
    });
  }

  _handleInboundClose(inboundID) {
    this.inboundConnections.delete(inboundID);
    console.log(`Inbond connection ${inboundID} closed`);

    if (this.onInboundClose) {
      this.onInboundClose(inboundID);
    }

    // close pair
    const outboundID = this.forwardingPairs.get(inboundID);
    if (!outboundID) {
      return;
    }
    const outboundClient = this.outboundConnections.get(outboundID);
    if (!outboundClient) {
      return;
    }
    outboundClient.close().catch((e) => {
      console.error(`Error closing outbound connection ${outboundID}`);
    });

    this.forwardingPairs.delete(inboundID);
    this.reverseForwardingPairs.delete(outboundID);
  }

  _handleOutboundClose(outboundID) {
    this.outboundConnections.delete(outboundID);
    console.log(`Outbound connection ${outboundID} closed`);

    if (this.onOutboundClose) {
      this.onOutboundClose(outboundID);
    }

    // close pair
    const inboundID = this.reverseForwardingPairs.get(outboundID);
    if (inboundID) {
      return;
    }
    const inboundClient = this.inboundConnections.get(inboundID);
    if (!inboundClient) {
      return;
    }
    inboundClient.close().catch((e) => {
      console.error(`Error closing inbound connection ${inboundID}`, e);
    });

    this.reverseForwardingPairs.delete(outboundID);
    this.forwardingPairs.delete(inboundID);
  }

  async connect(remoteAddress, remotePort, options = {}) {
    try {
      const connectionID = this._generateConnectionID();
      const outboundClient = new TCPSocketClient(remoteAddress, remotePort, options);

      outboundClient.onOpen = (openInfo) => {
        console.log(`Established outbound connection ${connectionID} to ${remoteAddress}:${remotePort}`);

        if (this.onOutboundConnect) {
          this.onOutboundConnect(connectionID, openInfo);
        }
      };
      outboundClient.onData = (data) => {
        this._handleOutboundData(connectionID, data);
      };
      outboundClient.onClose = () => {
        this._handleOutboundClose(connectionID);
      };
      outboundClient.onError = (e) => {
        if (this.onError) {
          this.onError(`outbound`, connectionID, e);
        }
      };
      await outboundClient.connect();
      this.outboundConnections.set(connectionID, outboundClient);
      return connectionID;
    } catch (e) {
      console.error(`Error connecting to ${remoteAddress}:${remotePort}: `, e);
      if (this.onError) {
        this.onError(`outbound`, `unknown`, e);
      }
      throw e;
    }
  }

  link(inboundID, remoteAddr, remotePort, options = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        if (!this.inboundConnections.has(inboundID)) {
          throw new Error(`Inbound connection ${inboundID} not found`);
        }

        const outboundID = await this.connect(remoteAddr, remotePort, options);

        this.forwardingPairs.set(inboundID, outboundID);
        this.reverseForwardingPairs.set(outboundID, inboundID);

        console.log(`Linked ${inboundID} <-> ${outboundID} (${remoteAddr}:${remotePort})`);
        resolve({inboundID, outboundID});
      } catch (e) {
        console.error(`Error creating tunnel for ${inboundID} to ${remoteAddr}:${remotePort}: `, e);
        reject(e);
      }
    });
  }

  closeInbound(inboundID) {
    const client = this.inboundConnections.get(inboundID);
    if (client) {
      return client.close();
    }
    return Promise.resolve();
  }

  closeOutbound(outboundID) {
    const client = this.outboundConnections.get(outboundID);
    if (client) {
      return client.close();
    }
    return Promise.resolve();
  }

  async close() {
    console.log(`Closing TCP proxy`);
    for (const [id, client] of this.inboundConnections.entries()) {
      try {
        if (client.socket) {
          await client.close();
        }
      } catch (e) {
        console.error(`Error closing inbound connection ${id}: `, e);
      }
    }
    for (const [id, client] of this.outboundConnections.entries()) {
      try {
        if (client.socket) {
          await client.close();
        }
      } catch (e) {
        console.error(`Error closing outbound connection ${id}: `, e);
      }
    }

    // clear maps
    this.inboundConnections.clear();
    this.outboundConnections.clear();
    this.forwardingPairs.clear();
    this.reverseForwardingPairs.clear();

    if (this.server) {
      try {
        // fixed Server close error by cancelling locked streams before close (sends done signal to loop)
        await this._reader.cancel();
        await this.server.close();
      } catch (e) {
        console.error(`Error closing server: `, e);
      }
      this.server = null;
    }

    if (this.onClose) {
      this.onClose();
    }

    console.log("TCP Proxy closed");
  }

  // helper function for testing mockSocket (avoids using _prefixed internal functions in test)
  acceptConnection(socket) {
    return this._handleIncomingConnection(socket);
  }
  
}
