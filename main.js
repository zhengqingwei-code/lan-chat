const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const net = require('net');
const dgram = require('dgram');
const os = require('os');
const path = require('path');

const UDP_PORT = 41234;
const TCP_PORT = 40000 + Math.floor(Math.random() * 1000);

let mainWindow;
let udpSocket;
let udpInterval;
let udpTimeout;
let tcpServer;
let peers = new Set();
let isConnected = false;
let countdownTimer; // 倒计时定时器

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}
const localIp = getLocalIp();

// ----- TCP -----
function startTcpServer() {
  tcpServer = net.createServer((socket) => {
    console.log('[TCP] Incoming connection:', socket.remoteAddress);

    stopUdp();
    isConnected = true;
    peers.add(socket);

    updateStatus('Connected');
    mainWindow.webContents.send('peer-connected', socket.remoteAddress);

    socket.on('data', (data) => {
      const msg = data.toString();
      mainWindow.webContents.send('chat-message', msg);
    });

    socket.on('end', () => {
      peers.delete(socket);
      console.log('[TCP] Peer disconnected');
    });
  });

  tcpServer.listen(TCP_PORT, () => {
    console.log(`[TCP] Listening on ${TCP_PORT}`);
  });
}

function stopTcpServer() {
  if (tcpServer) {
    tcpServer.close(() => {
      console.log('[TCP] Server closed');
    });
    tcpServer = null;
  }
}

// ----- UDP -----
function startUdp() {
  let countdown = 11;
  updateStatus(`Searching... (${countdown}s)`);

  udpSocket = dgram.createSocket('udp4');

  udpSocket.on('message', (msg, rinfo) => {
    if (isConnected) return;
    const [hello, peerPort] = msg.toString().split(':');
    if (hello !== 'HELLO') return;
    if (rinfo.address === localIp && parseInt(peerPort) === TCP_PORT) return;

    console.log('[UDP] Discovered peer', rinfo.address, peerPort);
    stopUdp();
    connectToPeer(rinfo.address, parseInt(peerPort));
  });

  udpSocket.bind(UDP_PORT, () => {
    udpSocket.setBroadcast(true);

    // 每2秒广播一次
    udpInterval = setInterval(() => {
      const msg = Buffer.from(`HELLO:${TCP_PORT}`);
      udpSocket.send(msg, 0, msg.length, UDP_PORT, '255.255.255.255');
    }, 2000);

    // 倒计时，每秒更新一次
    countdownTimer = setInterval(() => {
      if (isConnected) return;
      countdown -= 1;
      if (countdown > 0) {
        updateStatus(`Searching... (${countdown}s)`);
      }
    }, 1000);

    // 11秒后超时
    udpTimeout = setTimeout(() => {
      if (!isConnected) {
        stopUdp();
        stopTcpServer();
        updateStatus('Timeout');
        dialog.showMessageBox(mainWindow, {
          type: 'question',
          buttons: ['Retry', 'Cancel'],
          defaultId: 0,
          message: 'No peers found within 11s. Retry?'
        }).then(result => {
          if (result.response === 0) {
            startTcpServer();
            startUdp();
          } else {
            updateStatus('Idle');
          }
        });
      }
    }, 11000);
  });
}

function stopUdp() {
  if (udpInterval) {
    clearInterval(udpInterval);
    udpInterval = null;
  }
  if (udpTimeout) {
    clearTimeout(udpTimeout);
    udpTimeout = null;
  }
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  if (udpSocket) {
    udpSocket.close();
    udpSocket = null;
  }
}

// ----- TCP Client -----
function connectToPeer(ip, port) {
  const socket = new net.Socket();
  socket.connect(port, ip, () => {
    console.log(`[TCP] Connected to ${ip}:${port}`);
    isConnected = true;
    peers.add(socket);
    updateStatus('Connected');
    mainWindow.webContents.send('peer-connected', ip);
  });

  socket.on('data', (data) => {
    mainWindow.webContents.send('chat-message', data.toString());
  });

  socket.on('end', () => peers.delete(socket));
}

// ----- IPC -----
ipcMain.on('send-message', (_, text) => {
  const msg = `[${localIp}][${new Date().toLocaleTimeString()}] ${text}`;
  for (const p of peers) {
    p.write(msg);
  }
  mainWindow.webContents.send('chat-message', msg);
});

function updateStatus(status) {
  if (mainWindow) {
    mainWindow.webContents.send('status-update', status);
  }
}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  mainWindow.loadFile('renderer.html');

  startTcpServer();
  startUdp();
});
