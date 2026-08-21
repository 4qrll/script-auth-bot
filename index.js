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
const activeSessions = new Map(); 

// Funciones auxiliares para obtener y actualizar datos en JsonBin (para persistir logs)
async function obtenerDatosBin() {
    try {
        const res = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_KEY }
        });
        return res.data.record;
    } catch (error) {
        console.error("Error al leer JsonBin:", error);
        return { whitelist: [], logsHistorial: [] };
    }
}

async function guardarDatosBin(data) {
    try {
        await axios.put(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, data, {
            headers: { 'X-Master-Key': JSONBIN_KEY, 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error("Error al guardar en JsonBin:", error);
    }
}

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
        const record = await obtenerDatosBin();
        const whitelist = record.whitelist || [];

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

// 2. Endpoint para registrar apertura y cierre de sesiones (Guardando en JsonBin)
app.post('/api/log-sesion', async (req, res) => {
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
        console.log(`[LOG OPEN] ID: ${stringUserId} | User: ${username} | Hora: ${hora}`);
    } else if (tipo === 'close') {
        const session = activeSessions.get(stringUserId);
        const horaOpen = session ? session.horaOpen : "Desconocida";
        
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

        const nuevoLog = {
            userId: stringUserId,
            username: username || (session ? session.username : "Desconocido"),
            openTime: horaOpen,
            closeTime: hora,
            timeSpent: tiempoTexto
        };

        const record = await obtenerDatosBin();
        record.logsHistorial = record.logsHistorial || [];
        record.logsHistorial.push(nuevoLog);
        await guardarDatosBin(record);

        activeSessions.delete(stringUserId);
        console.log(`[LOG CLOSE] ID: ${stringUserId} | User: ${username} | Cierre: ${hora} | Time: ${tiempoTexto}`);
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

    // NUEVO COMANDO PURGE
    if (command === 'purge' || command === 'borrar') {
        const cantidad = parseInt(args[0]);

        if (isNaN(cantidad) || cantidad <= 0 || cantidad > 100) {
            return message.reply("❌ Por favor, indica un número válido de mensajes a eliminar (entre 1 y 100). Ej: `,purge 50`");
        }

        try {
            // Borrar el comando ejecutado y los mensajes solicitados (máximo 100 por limitación de Discord API en bulkDelete)
            await message.channel.bulkDelete(cantidad + 1, true);
            
            const confirmMsg = await message.channel.send(`🧹 Se han eliminado **${cantidad}** mensajes correctamente.`);
            setTimeout(() => confirmMsg.delete().catch(() => {}), 4000); // Borra el mensaje de aviso tras 4 segundos
        } catch (error) {
            console.error(error);
            return message.reply("❌ Hubo un error al intentar borrar los mensajes. (Recuerda que Discord no permite borrar mensajes de más de 14 días de antigüedad de forma masiva).");
        }
    }

    if (command === 'logs') {
        try {
            const record = await obtenerDatosBin();
            const logsHistorial = record.logsHistorial || [];

            if (logsHistorial.length === 0) {
                return message.reply("📂 No hay registros de sesiones cerradas todavía.");
            }

            let textoLogs = "📜 **Historial de Sesiones:**\n```text\n";
            logsHistorial.forEach(log => {
                textoLogs += `${log.userId} id | ${log.username} user | ${log.openTime} : open | ${log.closeTime} : close | time : ${log.timeSpent}\n`;
            });
            textoLogs += "```";

            return message.reply(textoLogs);
        } catch (error) {
            console.error(error);
            return message.reply("❌ Hubo un error al obtener los logs desde la base de datos.");
        }
    }

    if (command === 'quitar') {
        try {
            const record = await obtenerDatosBin();
            const whitelist = record.whitelist || [];

            if (whitelist.length === 0) {
                return message.reply("📂 La whitelist está vacía actualmente, no hay nadie para quitar.");
            }

            let descripcion = "Haz clic en el botón rojo correspondiente al usuario que deseas **eliminar** de la whitelist:\n\n";
            const components = [];
            let currentRow = new ActionRowBuilder();

            for (let i = 0; i < whitelist.length && i < 25; i++) {
                const uid = String(whitelist[i]);
                descripcion += `**${i + 1}.** UserId: \`${uid}\`\n`;

                currentRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`remove_${uid}`)
                        .setLabel(`Quitar #${i + 1}`)
                        .setStyle(ButtonStyle.Danger)
                );

                if (currentRow.components.length === 5 || i === whitelist.length - 1) {
                    components.push(currentRow);
                    currentRow = new ActionRowBuilder();
                }
            }

            const embed = new EmbedBuilder()
                .setTitle("🗑️ Gestión de Whitelist - Eliminar Usuarios")
                .setDescription(descripcion)
                .setColor(0xE74C3C)
                .setTimestamp();

            message.reply({ embeds: [embed], components: components });
        } catch (error) {
            console.error(error);
            message.reply("❌ Hubo un error al obtener la lista de usuarios.");
        }
    }

    if (command === 'lista') {
        try {
            const record = await obtenerDatosBin();
            const whitelist = record.whitelist || [];

            if (whitelist.length === 0) {
                return message.reply("📂 La whitelist está vacía actualmente.");
            }

            let descripcion = "";
            for (let i = 0; i < whitelist.length; i++) {
                descripcion += `**${i + 1}.** UserId: \`${whitelist[i]}\`\n`;
            }

            const embedLista = new EmbedBuilder()
                .setTitle("📋 Usuarios Registrados en la Whitelist")
                .setDescription(descripcion)
                .setColor(0x3498DB)
                .setTimestamp();

            message.reply({ embeds: [embedLista] });
        } catch (error) {
            console.error(error);
            message.reply("❌ Hubo un error al obtener la lista.");
        }
    }

    if (command === 'solicitudes') {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const recent = approvedHistory.filter(item => item.timestamp >= thirtyDaysAgo);

        const embed = new EmbedBuilder()
            .setTitle('📋 Solicitudes Aprobadas (Últimos 30 días)')
            .setColor(0x3498DB)
            .setDescription(recent.length > 0 ? recent.map(r => `• UserId: \`${r.userId}\` - Aprobado por: ${r.approvedBy}`).join('\n') : 'No hay solicitudes aprobadas en este periodo.')
            .setTimestamp();

        message.reply({ embeds: [embed] });
    }
});

// Manejador de Clics en los Botones de Discord
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, userId] = interaction.customId.split('_');

    if (action === 'approve') {
        try {
            const record = await obtenerDatosBin();
            let whitelist = record.whitelist || [];

            if (!whitelist.includes(userId) && !whitelist.includes(Number(userId))) {
                whitelist.push(userId);
                record.whitelist = whitelist;
                await guardarDatosBin(record);
            }

            denegados.delete(userId);
            notificados.delete(userId);

            approvedHistory.push({
                userId,
                approvedBy: interaction.user.tag,
                timestamp: Date.now()
            });

            const updatedEmbed = new EmbedBuilder()
                .setTitle("✅ Solicitud Aprobada")
                .setColor(0x2ECC71)
                .addFields(
                    { name: "UserId Aprobado", value: userId, inline: true },
                    { name: "Aprobado por", value: interaction.user.tag, inline: true }
                );

            await interaction.update({ embeds: [updatedEmbed], components: [] });
        } catch (error) {
            await interaction.reply({ content: "Hubo un error al guardar en la base de datos.", ephemeral: true });
        }
    } 
    else if (action === 'deny') {
        denegados.add(userId);
        notificados.delete(userId);

        const updatedEmbed = new EmbedBuilder()
            .setTitle("❌ Solicitud Denegada")
            .setColor(0xE74C3C)
            .addFields(
                { name: "UserId Denegado", value: userId, inline: true },
                { name: "Denegado por", value: interaction.user.tag, inline: true }
            );

        await interaction.update({ embeds: [updatedEmbed], components: [] });
    }
    else if (action === 'remove') {
        try {
            const record = await obtenerDatosBin();
            let whitelist = record.whitelist || [];
            record.whitelist = whitelist.filter(id => String(id) !== String(userId));
            await guardarDatosBin(record);

            denegados.delete(userId);
            notificados.delete(userId);

            const updatedEmbed = new EmbedBuilder()
                .setTitle("🗑️ Usuario Eliminado de la Whitelist")
                .setDescription(`El usuario con UserId \`${userId}\` ha sido eliminado correctamente.`)
                .setColor(0x95A5A6);

            await interaction.update({ embeds: [updatedEmbed], components: [] });
        } catch (error) {
            await interaction.reply({ content: "Hubo un error al eliminar al usuario.", ephemeral: true });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Express corriendo en el puerto ${PORT}`);
});
