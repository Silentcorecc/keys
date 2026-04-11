const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || '';
const SUPABASE_FUNCTION_URL = 'https://uowyvhzklhhfuzwsldbv.supabase.co/functions/v1/discord-key-bot';

if (!BOT_TOKEN) {
  console.error('DISCORD_BOT_TOKEN is not set!');
  process.exit(1);
}

const PREFIX = '!';

function isAdmin(member) {
  if (!ADMIN_ROLE_ID) return true;
  return member && member.roles && member.roles.cache.has(ADMIN_ROLE_ID);
}

async function callEdgeFunction(command, args, discordUserId, discordUsername) {
  const res = await fetch(SUPABASE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bot-secret': BOT_TOKEN,
    },
    body: JSON.stringify({
      command,
      args,
      discord_user_id: discordUserId,
      discord_username: discordUsername,
    }),
  });
  return res.json();
}

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  try {
    // Admin-only commands
    if (['assign', 'lookup', 'stock'].includes(command)) {
      if (!isAdmin(message.member)) {
        return message.reply('❌ You do not have permission to use this command.');
      }
    }

    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('🤖 Key Bot Commands')
        .setColor(0x7c3aed)
        .addFields(
          { name: '!stock', value: 'Show available key stock (Admin)', inline: false },
          { name: '!assign <email> <product> [variant]', value: 'Assign a key to an email (Admin)', inline: false },
          { name: '!redeem <email or order_id>', value: 'Get your keys via DM', inline: false },
          { name: '!lookup <email>', value: 'Look up user info (Admin)', inline: false },
        )
        .setFooter({ text: 'Key Delivery Bot' });
      return message.reply({ embeds: [embed] });
    }

    if (command === 'stock') {
      const data = await callEdgeFunction('stock', args, message.author.id, message.author.username);
      if (data.error) return message.reply(`❌ ${data.error}`);

      const stockLines = data.stock.map(s => `• **${s.product}**: ${s.available} keys`).join('\n');
      const embed = new EmbedBuilder()
        .setTitle('📦 Current Stock')
        .setColor(0x10b981)
        .setDescription(stockLines || 'No products found.')
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (command === 'assign') {
      const data = await callEdgeFunction('assign', args, message.author.id, message.author.username);
      if (data.error) return message.reply(`❌ ${data.error}`);

      const embed = new EmbedBuilder()
        .setTitle('✅ Key Assigned')
        .setColor(0x10b981)
        .addFields(
          { name: 'Product', value: data.product, inline: true },
          { name: 'Variant', value: data.variant, inline: true },
          { name: 'Email', value: data.email, inline: true },
          { name: 'Key', value: `\`${data.key}\``, inline: false },
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    if (command === 'redeem') {
      const data = await callEdgeFunction('redeem', args, message.author.id, message.author.username);
      if (data.error) return message.reply(`❌ ${data.error}`);

      const keyLines = data.keys.map(k => `**${k.product}** (${k.variant})\n\`${k.key}\``).join('\n\n');
      const embed = new EmbedBuilder()
        .setTitle('🔑 Your Keys')
        .setColor(0x7c3aed)
        .setDescription(keyLines)
        .setTimestamp();

      try {
        await message.author.send({ embeds: [embed] });
        return message.reply('✅ Keys sent to your DMs!');
      } catch {
        return message.reply({ content: '⚠️ Could not DM you. Here are your keys:', embeds: [embed] });
      }
    }

    if (command === 'lookup') {
      const data = await callEdgeFunction('lookup', args, message.author.id, message.author.username);
      if (data.error) return message.reply(`❌ ${data.error}`);

      const keyLines = data.keys.length > 0
        ? data.keys.map(k => `• **${k.product}** (${k.variant}): \`${k.key}\``).join('\n')
        : 'No keys found';

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Lookup: ${data.email}`)
        .setColor(0x3b82f6)
        .addFields(
          { name: 'Total Keys', value: String(data.total_keys), inline: true },
          { name: 'Keys', value: keyLines.slice(0, 1024), inline: false },
        )
        .setTimestamp();
      return message.reply({ embeds: [embed] });
    }

  } catch (err) {
    console.error('Command error:', err);
    message.reply('❌ Something went wrong. Please try again.');
  }
});

client.login(BOT_TOKEN);
