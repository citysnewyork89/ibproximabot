const express = require("express");
const bodyParser = require("body-parser");
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType, SlashCommandBuilder, Routes, RoleSelectMenuBuilder, UserSelectMenuBuilder, StringSelectMenuBuilder } = require("discord.js");
const { REST } = require("@discordjs/rest");
const path = require("path");

const app = express();
app.use(bodyParser.json());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ]
});

// Variables de entorno
require("dotenv").config();
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;

// Cooldown 20s por usuario
const cooldowns = new Map();

async function sendDM(user, message) {
  const now = Date.now();
  const last = cooldowns.get(user.id) || 0;
  if (now - last < 20000) throw new Error("⏳ Debes esperar 20s antes de enviar otro mensaje a este usuario");
  await user.send(message);
  cooldowns.set(user.id, now);
}

// Servir HTML
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// Endpoint DM desde la web (sin cambios)
app.post("/send-dm", async (req, res) => {
  const { userId, sendType, roleName, message, embeds } = req.body;
  try {
    let dmPayload = {};
    if (embeds && embeds.length > 0) {
      dmPayload.embeds = embeds.map(e => {
        const embed = new EmbedBuilder();
        if (e.authorName) embed.setAuthor({ name: e.authorName, url: e.authorURL || null, iconURL: e.authorIcon || null });
        if (e.title) embed.setTitle(e.title);
        if (e.url) embed.setURL(e.url);
        if (e.description) embed.setDescription(e.description);
        if (e.color) embed.setColor(e.color);
        if (e.fields && e.fields.length > 0) embed.addFields(e.fields.map(f => ({ name: f.name, value: f.value, inline: f.inline })));
        if (e.thumbnail) embed.setThumbnail(e.thumbnail);
        if (e.image) embed.setImage(e.image);
        if (e.footer) embed.setFooter({ text: e.footer, iconURL: e.footerIcon || null });
        if (e.timestamp) embed.setTimestamp(e.timestamp ? new Date(e.timestamp) : null);
        return embed;
      });
    }
    if (message) dmPayload.content = message.replace(/\r?\n/g, "\n");

    if (sendType === "single") {
      const user = await client.users.fetch(userId);
      if (!user) return res.status(404).send("Usuario no encontrado");
      await sendDM(user, dmPayload);
      return res.send("📩 Mensaje enviado al usuario");
    } else if (sendType === "all") {
      const guild = client.guilds.cache.get(GUILD_ID);
      await guild.members.fetch();
      guild.members.cache.forEach(member => {
        if (!member.user.bot) sendDM(member.user, dmPayload).catch(()=>{});
      });
      return res.send("📩 Mensaje enviado a todos los miembros");
    } else if (sendType === "role") {
      if (!roleName) return res.status(400).send("Falta nombre del rol");
      const guild = client.guilds.cache.get(GUILD_ID);
      await guild.members.fetch();
      const role = guild.roles.cache.find(r => r.name === roleName);
      if (!role) return res.status(404).send("Rol no encontrado");
      role.members.forEach(member => {
        if (!member.user.bot) sendDM(member.user, dmPayload).catch(()=>{});
      });
      return res.send(`📩 Mensaje enviado a todos con rol ${roleName}`);
    }
  } catch(err) {
    console.error(err);
    return res.status(500).send("❌ Error: " + err.message);
  }
});

// Obtener roles para la web
app.get("/get-roles", async (req,res)=>{
  try{
    const guild = client.guilds.cache.get(GUILD_ID);
    if(!guild) return res.status(404).send("No hay servidor");
    await guild.roles.fetch();
    const roles = guild.roles.cache.filter(r=>!r.managed && r.name!=="@everyone").map(r=>r.name);
    res.json(roles);
  }catch(err){console.error(err); res.status(500).send("Error al obtener roles");}
});

app.listen(3002,()=>console.log("🌐 Servidor en http://localhost:3002"));

// Comandos Slash
client.once("ready", async () => {
  console.log(`✅ Bot conectado como ${client.user.tag}`);
  client.user.setActivity("Managing your bookings", { type: "WATCHING" });

  const commands = [
    new SlashCommandBuilder()
      .setName("sendmessage")
      .setDescription("Send a DM to a user, role, or all members")
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("🔄 Slash commands registered");
});

// Manejo de interacciones
client.on("interactionCreate", async interaction => {
  if(interaction.type === InteractionType.ApplicationCommand){
    if(interaction.commandName === "sendmessage"){
      const allowedRoleId = "1415056022288208083";
      if(!interaction.member.roles.cache.has(allowedRoleId)){
        const embed = new EmbedBuilder()
          .setTitle("You do not have permission")
          .setDescription("You do not have sufficient permissions to send a message.")
          .setColor("#FF0000");
        return interaction.reply({ embeds:[embed], ephemeral:true });
      }

      // Modal con selección de target y mensaje
      const modal = new ModalBuilder()
        .setCustomId("sendmessage_modal")
        .setTitle("Send DM");

      const targetInput = new TextInputBuilder()
        .setCustomId("modal_target")
        .setLabel("Target type: user / role / all")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("user | role | all");

      const targetIdInput = new TextInputBuilder()
        .setCustomId("modal_targetId")
        .setLabel("User ID or Role ID (if applicable)")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder("Leave empty if 'all'");

      const messageInput = new TextInputBuilder()
        .setCustomId("modal_message")
        .setLabel("Enter your message")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(targetInput),
        new ActionRowBuilder().addComponents(targetIdInput),
        new ActionRowBuilder().addComponents(messageInput)
      );

      await interaction.showModal(modal);
    }
  } else if(interaction.type === InteractionType.ModalSubmit){
    if(interaction.customId === "sendmessage_modal"){
      const target = interaction.fields.getTextInputValue("modal_target").toLowerCase();
      const targetId = interaction.fields.getTextInputValue("modal_targetId");
      const message = interaction.fields.getTextInputValue("modal_message");
      const dmPayload = { content: message };

      try{
        const guild = client.guilds.cache.get(GUILD_ID);
        await guild.members.fetch();

        let count = 0;

        if(target === "user" && targetId){
          const user = await client.users.fetch(targetId);
          if(!user) throw new Error("User not found");
          await sendDM(user, dmPayload);
          count = 1;
        } else if(target === "role" && targetId){
          const role = guild.roles.cache.get(targetId);
          if(!role) throw new Error("Role not found");
          for(const member of role.members.values()){
            if(!member.user.bot) { await sendDM(member.user, dmPayload).catch(()=>{}); count++; }
          }
        } else if(target === "all"){
          for(const member of guild.members.cache.values()){
            if(!member.user.bot) { await sendDM(member.user, dmPayload).catch(()=>{}); count++; }
          }
        } else {
          throw new Error("Invalid target");
        }

        const embed = new EmbedBuilder()
          .setTitle("Message Sent")
          .setDescription(`Your message has been sent successfully to ${count} member(s).`)
          .setColor("#00FF00");
        await interaction.reply({ embeds:[embed], ephemeral:true });

      }catch(err){
        console.error(err);
        const embed = new EmbedBuilder()
          .setTitle("Error")
          .setDescription("There was an error sending the message: "+err.message)
          .setColor("#FF0000");
        await interaction.reply({ embeds:[embed], ephemeral:true });
      }
    }
  }
});

client.login(process.env.TOKEN);
