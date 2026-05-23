const express = require('express');
const cors = require('cors');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Server pool
const servers = {};
const SERVER_COUNT = 5;
const MAX_PER_SERVER = 30;
const serverUsage = {};

// Initialize a persistent WhatsApp connection
async function initServer(serverId) {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(`./auth/${serverId}`);

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ["Chrome", "Desktop", "1.0"],
            logger: pino({ level: 'silent' }),
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    setTimeout(() => initServer(serverId), 3000);
                }
            } else if (connection === 'open') {
                console.log(`✅ Server ${serverId} connected!`);
            }
        });

        servers[serverId] = sock;
        serverUsage[serverId] = serverUsage[serverId] || 0;

    } catch (err) {
        console.error(`Server ${serverId} error:`, err.message);
        setTimeout(() => initServer(serverId), 5000);
    }
}

// Start all servers on boot
(async () => {
    console.log('🚀 Starting AAQI MD servers...');
    for (let i = 1; i <= SERVER_COUNT; i++) {
        await initServer(`server${i}`);
        await new Promise(r => setTimeout(r, 1000));
    }
    console.log(`✅ All ${SERVER_COUNT} servers ready!`);
})();

// Home route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Get server list
app.get('/servers', (req, res) => {
    const list = [];
    for (let i = 1; i <= SERVER_COUNT; i++) {
        const id = `server${i}`;
        const sock = servers[id];
        const isConnected = sock?.user != null;
        list.push({
            id: i,
            name: `Server ${i}`,
            connected: isConnected,
            usage: serverUsage[id] || 0,
            limit: MAX_PER_SERVER,
            available: (serverUsage[id] || 0) < MAX_PER_SERVER && isConnected
        });
    }
    res.json({ success: true, servers: list });
});

// Generate pairing code
app.post('/generate-pair', async (req, res) => {
    const { phoneNumber, serverId } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ success: false, error: "Please enter WhatsApp number" });
    }

    const cleanNumber = phoneNumber.replace('+', '').replace(/\s/g, '').replace(/-/g, '');

    if (cleanNumber.length < 10) {
        return res.status(400).json({ success: false, error: "Invalid number. Include country code e.g. 923001234567" });
    }

    const selectedId = serverId ? `server${serverId}` : `server1`;
    const sock = servers[selectedId];

    if (!sock) {
        return res.status(500).json({ success: false, error: "Server not ready. Please try again in a moment." });
    }

    if ((serverUsage[selectedId] || 0) >= MAX_PER_SERVER) {
        return res.status(400).json({ success: false, error: "Server is full. Please select another server." });
    }

    try {
        serverUsage[selectedId] = (serverUsage[selectedId] || 0) + 1;

        const code = await sock.requestPairingCode(cleanNumber);

        setTimeout(() => {
            if (serverUsage[selectedId] > 0) serverUsage[selectedId]--;
        }, 60000);

        if (code) {
            const formatted = code.match(/.{1,4}/g)?.join('-') || code;
            return res.json({
                success: true,
                pairingCode: formatted,
                serverId: parseInt(selectedId.replace('server', '')),
                usage: serverUsage[selectedId],
                limit: MAX_PER_SERVER
            });
        } else {
            serverUsage[selectedId]--;
            return res.status(500).json({ success: false, error: "Failed to generate code. Try another server." });
        }

    } catch (error) {
        if (serverUsage[selectedId] > 0) serverUsage[selectedId]--;
        return res.status(500).json({ success: false, error: "Error: " + error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', servers: SERVER_COUNT });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ AAQI MD Running on Port ${PORT}`);
});
