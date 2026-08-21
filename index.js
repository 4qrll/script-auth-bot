const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK;
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const SERVER_URL = process.env.RENDER_EXTERNAL_URL || "https://script-auth-bot-dec8.onrender.com";

// 1. Verificar si el usuario está en la whitelist
app.post('/api/check-whitelist', async (req, res) => {
    const { userId, username } = req.body;
    if (!userId) return res.status(400).json({ allowed: false });

    try {
        const binRes = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_KEY }
        });
        
        const whitelist = binRes.data.record.whitelist || [];

        if (whitelist.includes(Number(userId)) || whitelist.includes(userId)) {
            return res.json({ allowed: true });
        } else {
            await enviarAlertaDiscord(userId, username);
            return res.json({ allowed: false });
        }
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ allowed: false });
    }
});

// 2. Enlace web para Aprobar al usuario con 1 clic
app.get('/api/approve/:userId', async (req, res) => {
    const targetUserId = req.params.userId;
    try {
        const binRes = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_KEY }
        });
        
        let whitelist = binRes.data.record.whitelist || [];
        if (!whitelist.includes(targetUserId) && !whitelist.includes(Number(targetUserId))) {
            whitelist.push(targetUserId);
            // Actualizar JSONBin permanentemente
            await axios.put(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, { whitelist }, {
                headers: { 'X-Master-Key': JSONBIN_KEY, 'Content-Type': 'application/json' }
            });
        }
        res.send(`<h2>✅ ¡Usuario ${targetUserId} aprobado con éxito! Ya puedes cerrar esta pestaña y entrar al script.</h2>`);
    } catch (error) {
        res.status(500).send("Hubo un error al aprobar al usuario.");
    }
});

// Enviar alerta a Discord con link de aprobación
async function enviarAlertaDiscord(userId, username) {
    if (!DISCORD_WEBHOOK_URL) return;

    const linkAprobar = `${SERVER_URL}/api/approve/${userId}`;

    const payload = {
        content: "🚨 **Nuevo intento de ejecución detectado**",
        embeds: [{
            title: "Solicitud de Acceso Pendiente",
            color: 16776960,
            fields: [
                { name: "Usuario", value: username || "Desconocido", inline: true },
                { name: "UserId", value: userId, inline: true },
                { name: "Acción rápida", value: `[👉 Haz clic aquí para APROBAR al usuario](${linkAprobar})`, inline: false }
            ]
        }]
    };

    await axios.post(DISCORD_WEBHOOK_URL, payload);
}

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
