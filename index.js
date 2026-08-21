const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // El token de tu Bot
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID; // El ID del canal donde el bot mandará la alerta

// Configurar el Bot de Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', () => {
    console.log(`Bot de Discord conectado como ${client.user.tag}`);
});

client.login(DISCORD_TOKEN);

// Memoria para evitar spam de alertas
const notificados = new Set();
const denegados = new Set();

// 1. Endpoint que consulta Roblox
app.post('/api/check-whitelist', async (req, res) => {
    const { userId, username } = req.body;
    if (!userId) return res.status(400).json({ allowed: false });

    if (denegados.has(String(userId))) {
        return res.json({ allowed: false, denied: true });
    }

    try {
        const binRes = await axios.get(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_KEY }
        });
        
        const whitelist = binRes.data.record.whitelist || [];

        if (whitelist.includes(Number(userId)) || whitelist.includes(String(userId))) {
            return res.json({ allowed: true });
        } else {
            if (!notificados.has(String(userId))) {
                notificados.add(String(userId));
                await enviarAlertaBotDiscord(userId, username);
            }
            return res.json({ allowed: false });
        }
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ allowed: false });
    }
});

// Función para enviar embed con Botones Interactivos
async function enviarAlertaBotDiscord(userId, username) {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle("🚨 Solicitud de Acceso Pendiente")
            .setColor(0xF1C40F) // Amarillo
            .addFields(
                { name: "Usuario", value: username || "Desconocido", inline: true },
                { name: "UserId", value: userId, inline: true }
            )
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`approve_${userId}`)
                .setLabel('Aprobar')
                .setStyle(ButtonStyle.Success), // Verde
            new ButtonBuilder()
                .setCustomId(`deny_${userId}`)
                .setLabel('Denegar')
                .setStyle(ButtonStyle.Danger) // Rojo
        );

        await channel.send({ content: "Nuevo intento de ejecución detectado:", embeds: [embed], components: [row] });
    } catch (err) {
        console.error("Error al enviar alerta con el bot:", err);
    }
}

// Manejador de Clics en los Botones de Discord
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, userId] = interaction.customId.split('_');

    if (action === 'approve') {
        try {
            // Actualizar JSONBin
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

            // Modificar mensaje original en Discord (ponerlo verde y desactivar botones)
            const updatedEmbed = new EmbedBuilder()
                .setTitle("✅ Solicitud Aprobada")
                .setColor(0x2ECC71) // Verde
                .addFields(
                    { name: "UserId Aprobado", value: userId, inline: true },
                    { name: "Aprobado por", value: interaction.user.tag, inline: true }
                );

            await interaction.update({ embeds: [updatedEmbed], components: [] });
        } catch (error) {
            await interaction.reply({ content: "Hubo un error al guardar en la base de datos.", ephemeral: true });
        }
    } else if (action === 'deny') {
        denegados.add(userId);
        notificados.delete(userId);

        // Modificar mensaje original en Discord (ponerlo rojo y desactivar botones)
        const updatedEmbed = new EmbedBuilder()
            .setTitle("❌ Solicitud Denegada")
            .setColor(0xE74C3C) // Rojo
            .addFields(
                { name: "UserId Denegado", value: userId, inline: true },
                { name: "Denegado por", value: interaction.user.tag, inline: true }
            );

        await interaction.update({ embeds: [updatedEmbed], components: [] });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Express corriendo en el puerto ${PORT}`);
});
