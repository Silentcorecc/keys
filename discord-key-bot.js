const { Client, GatewayIntentBits, Events } = require('discord.js');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const TICKET_BOT_SECRET = process.env.TICKET_BOT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/discord-key-bot`;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Bot ready as ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith('!')) return;

  const parts = message.content.slice(1).trim().split(/\s+/);
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  if (!['assign', 'redeem', 'stock', 'lookup'].includes(command)) return;

  try {
    await message.channel.sendTyping();

    const res = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bot-secret': TICKET_BOT_SECRET,
      },
      body: JSON.stringify({
        command,
        args,
        discord_user_id: message.author.id,
        discord_username: message.author.username,
      }),
    });

    const data = await res.json();

    if (data.error) {
      await message.reply(`❌ ${data.error}`);
      return;
    }

    // Format reply based on command
    let reply = data.message || '✅ Done';

    if (command === 'assign' && data.key) {
      reply = `✅ **Key assigned**\n📦 Product: ${data.product}\n🎟️ Variant: ${data.variant}\n📧 Email: ${data.email}\n🔑 Key: \`${data.key}\``;
    }

    if (command === 'redeem' && data.keys?.length) {
      reply = `✅ Found ${data.keys.length} key(s):\n` + data.keys
        .map((k) => `• **${k.product}** (${k.variant}): \`${k.key}\``)
        .join('\n');
    }

    if (command === 'stock' && data.stock) {
      reply = `📦 **Current Stock:**\n` + data.stock
        .map((s) => `• ${s.product}: **${s.available}**`)
        .join('\n');
    }

    if (command === 'lookup' && data.email) {
      reply = `🔍 **Lookup: ${data.email}**\n🔑 Total keys: ${data.total_keys}\n💳 Recent payments: ${data.recent_payments?.length || 0}`;
    }

    // Discord max message length is 2000
    if (reply.length > 1900) reply = reply.slice(0, 1900) + '...';

    await message.reply(reply);
  } catch (err) {
    console.error('Bot error:', err);
    await message.reply(`❌ Error: ${err.message}`);
  }
});

client.login(DISCORD_BOT_TOKEN);
