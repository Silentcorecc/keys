{
  "name": "discord-key-bot",
  "version": "1.0.0",
  "main": "discord-key-bot.js",
  "scripts": {
    "start": "node discord-key-bot.js"
  },
  "dependencies": {
    "discord.js": "^14.14.1"
  }
}

const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// ===== CONFIGURATION =====
const SUPABASE_FUNCTION_URL = 'https://uowyvhzklhhfuzwsldbv.supabase.co/functions/v1/discord-key-bot';
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID; // Your admin/staff role ID in Discord

if (!BOT_TOKEN) {
  console.error('ERROR: Set DISCORD_BOT_TOKEN environment variable!');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Check if user has admin role
function isAdmin(member) {
  if (!ADMIN_ROLE_ID) return member.permissions.has(PermissionFlagsBits.Administrator);
  return member.roles.cache.has(ADMIN_ROLE_ID);
}

// Call the Supabase edge function
async function callBot(command, args, user) {
  const res = await fetch(SUPABASE_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bot-secret': BOT_TOKEN,
    },
    body: JSON.stringify({
      command,
      args,
      discord_user_id: user.id,
      discord_username: user.username,
    }),
  });
  return res.json();
}

client.on('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const parts = message.content.slice(1).trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  try {
    // ===== !help =====
    if (command === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('🤖 Key Bot Commands')
        .setColor(0x5865f2)
        .addFields(
          { name: '!redeem <email>', value: 'Get your product keys via DM', inline: false },
          { name: '!assign <email> <product> [variant]', value: '(Admin) Assign a key to an email', inline: false },
          { name: '!stock', value: '(Admin) Show available key stock', inline: false },
          { name: '!lookup <email>', value: '(Admin) Look up user keys & payments', inline: false },
        )
        .setFooter({ text: 'SilentCore Key Bot' });
      return message.reply({ embeds: [embed] });
    }

    // ===== !redeem =====
    if (command === 'redeem') {
      if (args.length === 0) {
        return message.reply('❌ Usage: `!redeem <your-email>`');
      }

      const data = await callBot('redeem', args, message.author);

      if (data.error) {
        return message.reply(`❌ ${data.error}`);
      }

      // Send keys via DM for privacy
      const embed = new EmbedBuilder()
        .setTitle('🔑 Your Product Keys')
        .setColor(0x00ff00)
        .setDescription(data.message);

      for (const key of data.keys) {
        embed.addFields({
          name: `${key.product} (${key.variant})`,
          value: `\`\`\`${key.key}\`\`\``,
          inline: false,
        });
      }

      try {
        await message.author.send({ embeds: [embed] });
        await message.reply('✅ Keys sent to your DMs! Check your direct messages.');
      } catch {
        await message.reply('❌ Could not DM you. Please enable DMs from server members.');
      }
      return;
    }

    // ===== ADMIN COMMANDS BELOW =====
    if (!isAdmin(message.member)) {
      return message.reply('❌ You do not have permission to use this command.');
    }

    // ===== !assign =====
    if (command === 'assign') {
      if (args.length < 2) {
        return message.reply('❌ Usage: `!assign <email> <product_name> [variant]`\nExample: `!assign user@email.com SilentAim lifetime`');
      }

      const data = await callBot('assign', args, message.author);

      if (data.error) {
        return message.reply(`❌ ${data.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Key Assigned')
        .setColor(0x00ff00)
        .addFields(
          { name: 'Product', value: data.product, inline: true },
          { name: 'Variant', value: data.variant, inline: true },
          { name: 'Email', value: data.email, inline: true },
          { name: 'Key', value: `\`\`\`${data.key}\`\`\``, inline: false },
        );
      return message.reply({ embeds: [embed] });
    }

    // ===== !stock =====
    if (command === 'stock') {
      const data = await callBot('stock', [], message.author);

      if (data.error) {
        return message.reply(`❌ ${data.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle('📦 Current Stock')
        .setColor(0x5865f2);

      for (const item of data.stock) {
        embed.addFields({
          name: item.product,
          value: `${item.available} keys available`,
          inline: true,
        });
      }
      return message.reply({ embeds: [embed] });
    }

    // ===== !lookup =====
    if (command === 'lookup') {
      if (args.length === 0) {
        return message.reply('❌ Usage: `!lookup <email>`');
      }

      const data = await callBot('lookup', args, message.author);

      if (data.error) {
        return message.reply(`❌ ${data.error}`);
      }

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Lookup: ${data.email}`)
        .setColor(0x5865f2)
        .addFields({ name: 'Total Keys', value: `${data.total_keys}`, inline: true });

      if (data.keys.length > 0) {
        const keyList = data.keys
          .map((k) => `**${k.product}** (${k.variant}): \`${k.key}\``)
          .join('\n');
        embed.addFields({ name: 'Keys', value: keyList.slice(0, 1024), inline: false });
      }

      if (data.recent_payments?.length > 0) {
        const payments = data.recent_payments
          .map((p) => `£${p.amount} - ${p.product_name || 'Unknown'} (${p.status})`)
          .join('\n');
        embed.addFields({ name: 'Recent Payments', value: payments.slice(0, 1024), inline: false });
      }

      return message.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error('Command error:', err);
    message.reply('❌ Something went wrong. Please try again.');
  }
});

client.login(BOT_TOKEN);
