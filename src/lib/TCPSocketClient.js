export class TCPSocketClient {
  constructor(remoteAddress, remotePort, options = {}) {
    this.socket = null;
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    this.options = options;

    // internals
    this._readable = null;
    this._writable = null;
    this._reader = null;
    this._writer;

    this._isOpenedSettled = false;
    this._isClosedSettled = false;
    this._openedPromise = new Promise((resolve, reject) => {
      this._resolveOpened = (value) => {
        this._isOpenedSettled = true;
        resolve(value);
      };

      this._rejectOpened = (reason) => {
        this._isOpenedSettled = true;
        reject(reason);
      };
    });
    this._closedPromise = new Promise((resolve, reject) => {
      this._resolveClosed = (value) => {
        this._isClosedSettled = true;
        resolve(value);
      };
      this._rejectClosed = (reason) => {
        this._isClosedSettled = true;
        reject(reason);
      };
    });

    // event callbacks
    this.onOpen = null;
    this.onData = null;
    this.onClose = null;
    this.onError = null;
  }

  get opened() {
    return this._openedPromise;
  }

  get closed() {
    return this._closedPromise;
  }

  async connect(timeoutMs = 5000) {
    try {
      let timeoutID;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutID = setTimeout(() => {
          console.log(`Connection to ${this.remoteAddress}:${this.remotePort} timed out after ${timeoutMs}ms`);
          reject(new Error("Connection timeout"));
        }, timeoutMs);
      });

      this.socket = new TCPSocket(this.remoteAddress, this.remotePort, this.options);
      const openInfo = await Promise.race([this.socket.opened, timeoutPromise]);
      clearTimeout(timeoutID);
      // const openInfo = await this.socket.opened;

      this._readable = openInfo.readable;
      this._writable = openInfo.writable;

      if (this.onData) {
        this._startReading();
      }
      if (this.onOpen) {
        this.onOpen(openInfo);
      }

      this._resolveOpened(openInfo);
      return openInfo;
    } catch (e) {
      this._rejectOpened(e);
      this._rejectClosed(e);

      if (this.onError) {
        this.onError(e);
      }

      throw e;
    }
  }

  async _startReading() {
    try {
      this._reader = this._readable.getReader();
      while (true) {
        const {value, done} = await this._reader.read();

        if (done) {
          break;
        }
        if (value && value.byteLength > 0) {
          if (this.onData) {
            this.onData(value);
          }
        }
      }
    } catch (e) {
      if (this._reader) {
        this._reader.releaseLock();
        this._reader = null;
      }
    }
  }

  async send(data) {
    if (!this._writable) {
      throw new Error(`Socket is not connected`);
    }

    try {
      this._writer = this._writable.getWriter();
      let buffer = data;
      if (typeof data === `string`) {
        const encoder = new TextEncoder();
        buffer = encoder.encode(data);
      }

      await this._writer.write(buffer);

      await this._writer.releaseLock();
      this._writer = null;
      return true;
    } catch (e) {
      if (this.onError) {
        this.onError(e);
      }
      throw error;
    }
  }

  async close() {
    try {
      if (!this.socket) {
        throw new Error(`Socket is not connected`);
      }

      if (this._isClosedSettled) {
        return this._closedPromise;
      }

      // if streams are locked err
      if ((this._readable && this._readable.locked) || (this._writable && this._writable.locked)) {
        throw new Error(`Cannot close socket while streams are locked`);
      }

      await this.socket.close();
      if (this.onClose) {
        this.onClose();
      }

      this._resolveClosed();
      return this._closedPromise;
    } catch (e) {
      this._rejectClosed(e);
      if (this.onError) {
        this.onError(e);
      }
      
      throw error;
    }
  }
}
