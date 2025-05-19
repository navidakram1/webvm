/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

 //
 // -- MODIFIED TO JS FOR WEBVM --
 // 
 //

export async function readStream(
  reader,
  cb
) {
  while (reader) {
    const { value, done } = await reader.read();

    if (value) {
      cb(value);
    }

    if (done) {
      reader.releaseLock();
      break;
    }
  }
}

export async function writeStream(
    socket,
    message
) {
  const connection = await socket.opened;

  if (!connection || !connection.writable) {
    console.error("Socket connection or writable is null");
  }

  const writer = connection.writable.getWriter();
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(message));
  writer.releaseLock();
}

export async function collectConnections(
  server,
  infoCB,
  connectionCB
) {
  const { readable, localAddress, localPort } = await server.opened;

  const connections = readable.getReader();

  // send server info to the callback
  infoCB(localAddress, localPort);

  while (connections) {
    const { value: connection, done } = await connections.read();

    if (connection) {
      connectionCB(connection);
    }

    if (done) {
      connections.releaseLock();
      break;
    }
  }
  await server.closed;
  console.log('Closed');
}


// export async function autoConfSockets({host, port, options}) {
//   client = new TCPSocketClient(host, port, options);
//   client.connect();
//   client._startReading();

//   return client;
// }
