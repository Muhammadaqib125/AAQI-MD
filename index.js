const express = require('express');
const cors = require('cors');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve website

// Main Route - Generate Pairing Code
app.post('/generate-pair', async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ 
            success: false, 
            error: "Please enter WhatsApp number" 
        });
    }

    const sessionId = uuidv4().slice(0, 12);
    const serverId = Math.floor(Math.random() * 50) + 1;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(`./sessions/${sessionId}`);

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ["Chrome", "Desktop", "1.0"],
        });

        let pairingCode = null;

        sock.ev.on('connection.update', async (update) => {
            if (update.qr) {
                try {
                    pairingCode = await sock.requestPairingCode(phoneNumber.replace('+', '').replace(/\s/g, ''));
                } catch (e) {
                    console.log("Pairing code error:", e);
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Wait for code generation
        setTimeout(() => {
            if (pairingCode) {
                res.json({
                    success: true,
                    pairingCode: pairingCode,
                    sessionId: sessionId,
                    assignedServer: serverId
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: "Failed to generate pairing code. Try again."
                });
            }
        }, 6500);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Server error. Please try again."
        });
    }
});

// Home Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(3000, '0.0.0.0', () => {
    console.log('✅ AAQI MD Server Running on Port 3000');
    console.log('👉 Open in Browser: http://localhost:3000');
});
