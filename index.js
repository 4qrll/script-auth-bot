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
const notificados = new Map(); // Guardará el timestamp de la última notificación por usuario
const denegados = new Set();
const approvedHistory = [];

// 1. Endpoint que consulta Roblox
app.post('/api/check-whitelist', async (req, res) => {
    const { userId, username } = req.body;
    if (!userId) return res.status(400).json({ allowed: false });

    const stringUserId = String(userId);

    // Si está denegado explícitamente, le avisamos al juego que cierre la UI una sola vez
    if (denegados.has(stringUserId)) {
        // Opcional: limpiamos el estado de denegado para que si vuelve a ejecutar el script en el futuro, pueda reintentar
        denegados.delete(stringUserId);
        notificados.delete(stringUserId);
        return res.json({ allowed: false, denied: true });
    }

    try {
        const binRes = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_KEY }
        });
        
        const whitelist = binRes.data.record.whitelist || [];

        // Si está en la whitelist, se le da acceso
        if (whitelist.includes(Number(userId)) || whitelist.includes(stringUserId)) {
            notificados.delete(stringUserId);
            denegados.delete(stringUserId);
            return res.json({ allowed: true });
        } else {
            // Si ya se le envió la alerta a Discord antes, NO la volvemos a enviar (evitamos spam)
            if (notificados.has(stringUserId)) {
                return res.json({ allowed: false, denied: false });
            }

            // Marcamos como notificado y enviamos el embed a Discord UNA SOLA VEZ
            notificados.set(stringUserId, true);
            await enviarAlertaBotDiscord(userId, username);

            return res.json({ allowed: false, denied: false });
        }
    } catch (error) {
        console.error("Error en check-whitelist:", error);
        res.status(500).json({ allowed: false });
    }
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

    if (command === 'quitar') {
        try {
            const binRes = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
                headers: { 'X-Master-Key': JSONBIN_KEY }
            });
            
            const whitelist = binRes.data.record.whitelist || [];

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
            const binRes = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
                headers: { 'X-Master-Key': JSONBIN_KEY }
            });
            
            const whitelist = binRes.data.record.whitelist || [];

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
            const binRes = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
                headers: { 'X-Master-Key': JSONBIN_KEY }
            });
            
            let whitelist = binRes.data.record.whitelist || [];
            if (!whitelist.includes(userId) && !whitelist.includes(Number(userId))) {
                whitelist.push(userId);
                await axios.put(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, { whitelist }, {
                    headers: { 'X-Master-Key': JSONBIN_KEY, 'Content-Type': 'application/json' }
                });
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
            const binRes = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
                headers: { 'X-Master-Key': JSONBIN_KEY }
            });
            
            let whitelist = binRes.data.record.whitelist || [];
            const nuevaWhitelist = whitelist.filter(id => String(id) !== String(userId));

            await axios.put(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}`, { whitelist: nuevaWhitelist }, {
                headers: { 'X-Master-Key': JSONBIN_KEY, 'Content-Type': 'application/json' }
            });

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
