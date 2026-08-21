const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configuración de Discord y JSONBin
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK; // Tu webhook de Discord para alertas con botones
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

// 1. Ruta que consulta Roblox para saber si está autorizado
app.post('/api/check-whitelist', async (req, res) => {
    const { userId, username } = req.body;
    if (!userId) return res.status(400).json({ allowed: false });

    try {
        // Leer la whitelist actual desde JSONBin
        const binRes = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_KEY }
        });
        
        const whitelist = binRes.data.record.whitelist || [];

        if (whitelist.includes(userId)) {
            return res.json({ allowed: true }); // ¡Está aprobado!
        } else {
            // No está aprobado: Mandamos alerta a Discord con botones de aprobación
            await enviarAlertaDiscord(userId, username);
            return res.json({ allowed: false }); // Aún no, esperando aprobación
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ allowed: false });
    }
});

// Función para enviar alerta a Discord
async function enviarAlertaDiscord(userId, username) {
    if (!DISCORD_WEBHOOK_URL) return;

    const payload = {
        content: "🚨 **Nuevo intento de ejecución detectado**",
        embeds: [{
            title: "Solicitud de Acceso Pendiente",
            color: 16776960, // Amarillo
            fields: [
                { name: "Usuario", value: username || "Desconocido", inline: true },
                { name: "UserId", value: userId, inline: true }
            ]
        }],
        components: [{
            type: 1,
            components: [
                {
                    type: 2,
                    style: 3, // Verde
                    label: "✅ Permitir Acceso",
                    custom_id: `approve_${userId}`
                },
                {
                    type: 2,
                    style: 4, // Rojo
                    label: "❌ Denegar",
                    custom_id: `deny_${userId}`
                }
            ]
        }]
    };

    await axios.post(DISCORD_WEBHOOK_URL, payload);
}

app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});