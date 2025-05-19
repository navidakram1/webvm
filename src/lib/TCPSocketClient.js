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

    // open and closed promise as fields
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
      // added timeout cause it seems to be standard
      const timeoutPromise = new Promise((_, reject) => {
        timeoutID = setTimeout(() => {
          console.log(`Connection to ${this.remoteAddress}:${this.remotePort} timed out after ${timeoutMs}ms`);
          reject(new Error("Connection timeout"));
        }, timeoutMs);
      });

      this.socket = new TCPSocket(this.remoteAddress, this.remotePort, this.options);
      // race between socket.opened and timeout
      const openInfo = await Promise.race([this.socket.opened, timeoutPromise]);
      clearTimeout(timeoutID);

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
          // releaseLock() here
          this._reader.releaseLock();
          this._reader = null;
          if (this.onClose) {
            this.onClose();
          }
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
      if (this.onClose) {
        this.onClose();
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
      // old: for text exchange test, can probably be removed
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
      throw e;
    }
  }

  async close() {
    if (!this.socket) {
      throw new Error(`Socket is not connected`);
    }


    try {
      // try to handle leftover locks if necessary, tho should have been handled in startReading's loop and send()
      if (this._reader) {
        this._reader.releaseLock();
        this._reader = null;
      }
      if (this._writer) {
        this._writer.releaseLock();
        this._writer = null;
      }

      // returning this before trying to handle leftover locks errs because close before releaseLock(). I thought I had made it so it'd take care of that but guess not
      // just try to release before fixes it
      if (this._isClosedSettled) {
        return this._closedPromise;
      }


      await this.socket.closed;
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
      
      throw e;
    }
  }
}
