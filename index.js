const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent
    ] 
});

client.once('ready', () => {
    console.log(`Bot de Discord conectado como ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);

// Estructuras de control
const notificados = new Map();
const denegados = new Set();
const approvedHistory = [];
const activeSessions = new Map(); // Guarda las sesiones activas en tiempo real: userId -> { username, horaOpen, timestampOpen }
const logsHistorial = []; // Almacena el historial completo de logs

// 1. Endpoint que consulta Roblox (Whitelist)
app.post('/api/check-whitelist', async (req, res) => {
    const { userId, username } = req.body;
    if (!userId) return res.status(400).json({ allowed: false });

    const stringUserId = String(userId);

    if (denegados.has(stringUserId)) {
        denegados.delete(stringUserId);
        notificados.delete(stringUserId);
        return res.json({ allowed: false, denied: true });
    }

    try {
        const binRes = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_KEY }
        });
        
        const whitelist = binRes.data.record.whitelist || [];

        if (whitelist.includes(Number(userId)) || whitelist.includes(stringUserId)) {
            notificados.delete(stringUserId);
            denegados.delete(stringUserId);
            return res.json({ allowed: true });
        } else {
            if (notificados.has(stringUserId)) {
                return res.json({ allowed: false, denied: false });
            }

            notificados.set(stringUserId, true);
            await enviarAlertaBotDiscord(userId, username);

            return res.json({ allowed: false, denied: false });
        }
    } catch (error) {
        console.error("Error en check-whitelist:", error);
        res.status(500).json({ allowed: false });
    }
});

// 2. Endpoint para registrar apertura y cierre de sesiones (Logs con nuevo formato)
app.post('/api/log-sesion', (req, res) => {
    const { userId, username, tipo, hora } = req.body;
    if (!userId) return res.status(400).json({ success: false });

    const stringUserId = String(userId);

    if (tipo === 'open') {
        activeSessions.set(stringUserId, {
            userId: stringUserId,
            username: username || "Desconocido",
            horaOpen: hora,
            timestampOpen: Date.now()
        });
        console.log(`[LOG OPEN] ID: ${stringUserId} | User: ${username} \vert{} Hora:${hora}`);
    } else if (tipo === 'close') {
        const session = activeSessions.get(stringUserId);
        const horaOpen = session ? session.horaOpen : "Desconocida";
        
        // Calcular tiempo transcurrido en horas (ej: 1.3h) o minutos
        let tiempoTexto = "0m";
        if (session) {
            const diffMs = Date.now() - session.timestampOpen;
            const diffMins = Math.floor(diffMs / 60000);
            if (diffMins >= 60) {
                const horas = (diffMins / 60).toFixed(1);
                tiempoTexto = `${horas}h`;
            } else {
                tiempoTexto = `${diffMins}m`;
            }
        }

        // Guardar en el historial con el nuevo formato solicitado
        logsHistorial.push({
            userId: stringUserId,
            username: username || (session ? session.username : "Desconocido"),
            openTime: horaOpen,
            closeTime: hora,
            timeSpent: tiempoTexto
        });

        activeSessions.delete(stringUserId);
        console.log(`[LOG CLOSE] ID: ${stringUserId} \vert{} User:${username} | Cierre: ${hora} \vert{} Time:${tiempoTexto}`);
    }

    res.json({ success: true });
});

// Endpoint cuando el usuario sale del script
app.post('/api/leave-script', (req, res) => {
    const { userId } = req.body;
    if (userId) {
        notificados.delete(String(userId));
    }
    res.json({ success: true });
});

// Función para enviar alerta de acceso pendiente
async function enviarAlertaBotDiscord(userId, username) {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle("🚨 Solicitud de Acceso Pendiente")
            .setColor(0xF1C40F)
            .addFields(
                { name: "Usuario", value: username || "Desconocido", inline: true },
                { name: "UserId", value: userId, inline: true }
            )
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`approve_${userId}`)
                .setLabel('Aprobar')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`deny_${userId}`)
                .setLabel('Denegar')
                .setStyle(ButtonStyle.Danger)
        );

        await channel.send({ content: "Nuevo intento de ejecución detectado:", embeds: [embed], components: [row] });
    } catch (err) {
        console.error("Error al enviar alerta con el bot:", err);
    }
}

// Comandos de Discord con prefijo coma (,)
client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(',')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'logs') {
        if (logsHistorial.length === 0) {
            return message.reply("📂 No hay registros de sesiones cerradas todavía.");
        }

        let textoLogs = "📜 **Historial de Sesiones:**\n```text\n";
        logsHistorial.forEach(log => {
            textoLogs += `${log.userId} id \vert{}${log.username} user | ${log.openTime} : open \vert{}${log.closeTime} : close |
