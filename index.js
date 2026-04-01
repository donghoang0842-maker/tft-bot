require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const DATA_FILE = path.join(__dirname, 'data.json');

function defaultData() {
  return {
    players: [],
    queue: [],
    matches: [],
    nextMatchId: 1,
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return defaultData();
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return defaultData();
  }
}

const data = loadData();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getPlayerByDiscordId(discordId) {
  return data.players.find((p) => p.discordId === discordId);
}

function getPlayerByName(name) {
  return data.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

function getRankedPlayers() {
  return [...data.players].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.top4 !== a.top4) return b.top4 - a.top4;
    if (a.matchesPlayed !== b.matchesPlayed) return a.matchesPlayed - b.matchesPlayed;
    return a.name.localeCompare(b.name);
  });
}

function getQueueNames() {
  return data.queue
    .map((discordId) => getPlayerByDiscordId(discordId))
    .filter(Boolean)
    .map((player) => player.name);
}

function createMatchIfEnoughPlayers() {
  if (data.queue.length < 8) return null;

  const openMatch = data.matches.find((m) => m.status === 'OPEN');
  if (openMatch) return openMatch;

  const selectedIds = data.queue.slice(0, 8);
  data.queue = data.queue.slice(8);

  const players = selectedIds
    .map((discordId) => getPlayerByDiscordId(discordId))
    .filter(Boolean)
    .map((player) => ({
      discordId: player.discordId,
      name: player.name,
      placement: null,
      pointsChange: 0,
    }));

  const match = {
    id: data.nextMatchId++,
    status: 'OPEN',
    createdAt: new Date().toISOString(),
    reportedAt: null,
    resultImageUrl: null,
    ocrText: null,
    players,
  };

  data.matches.push(match);
  saveData();
  return match;
}

function formatMatch(match) {
  const lines = [
    `Match #${match.id}`,
    `Status: ${match.status}`,
    `Result Image: ${match.resultImageUrl ? 'YES' : 'NO'}`,
    '',
    'Players:',
  ];

  const hasPlacements = match.players.every((p) => Number.isInteger(p.placement));

  if (!hasPlacements) {
    match.players.forEach((player, index) => {
      lines.push(`${index + 1}. ${player.name}`);
    });
  } else {
    const sorted = [...match.players].sort((a, b) => a.placement - b.placement);
    sorted.forEach((player) => {
      const sign = player.pointsChange > 0 ? '+' : '';
      lines.push(`${player.placement}. ${player.name} (${sign}${player.pointsChange})`);
    });
  }

  return lines.join('\n');
}

const POINTS_BY_PLACEMENT = {
  1: 8,
  2: 6,
  3: 4,
  4: 2,
  5: -2,
  6: -4,
  7: -6,
  8: -8,
};

function applyResults(matchId, placements) {
  const match = data.matches.find((m) => m.id === matchId);
  if (!match) {
    return { ok: false, message: 'Không tìm thấy match.' };
  }

  if (match.status !== 'OPEN') {
    return { ok: false, message: 'Match này đã được chấm rồi.' };
  }

  const lowerNames = placements.map((name) => name.toLowerCase());
  if (new Set(lowerNames).size !== 8) {
    return { ok: false, message: 'Tên trong kết quả đang bị trùng.' };
  }

  const matchNames = match.players.map((p) => p.name.toLowerCase());
  for (const name of lowerNames) {
    if (!matchNames.includes(name)) {
      return { ok: false, message: `Tên "${name}" không nằm trong match #${matchId}.` };
    }
  }

  for (let i = 0; i < placements.length; i++) {
    const placement = i + 1;
    const playerName = placements[i];
    const delta = POINTS_BY_PLACEMENT[placement];

    const matchPlayer = match.players.find(
      (p) => p.name.toLowerCase() === playerName.toLowerCase()
    );
    const player = getPlayerByName(playerName);

    if (!matchPlayer || !player) {
      return { ok: false, message: `Không tìm thấy người chơi: ${playerName}` };
    }

    matchPlayer.placement = placement;
    matchPlayer.pointsChange = delta;

    player.points += delta;
    player.matchesPlayed += 1;
    if (placement === 1) player.wins += 1;
    if (placement <= 4) player.top4 += 1;
  }

  match.status = 'COMPLETED';
  match.reportedAt = new Date().toISOString();
  saveData();

  return { ok: true, message: `Đã chấm điểm cho match #${matchId}.` };
}

async function extractTextFromImageUrl(imageUrl) {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) {
    throw new Error('Thiếu OCR_SPACE_API_KEY trong file .env');
  }

  const imageResponse = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
  });

  const formData = new FormData();
  formData.append('apikey', apiKey);
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');
  formData.append('OCREngine', '2');
  formData.append('file', Buffer.from(imageResponse.data), {
    filename: 'result.png',
    contentType: 'image/png',
  });

  const response = await axios.post('https://api.ocr.space/parse/image', formData, {
    headers: formData.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 60000,
  });

  const parsedText = response.data?.ParsedResults?.[0]?.ParsedText || '';
  return parsedText;
}

function detectPlacementsFromOcrText(match, ocrText) {
  const normalized = ocrText.toLowerCase();

  const found = [];
  for (const player of match.players) {
    const idx = normalized.indexOf(player.name.toLowerCase());
    if (idx !== -1) {
      found.push({
        name: player.name,
        index: idx,
      });
    }
  }

  found.sort((a, b) => a.index - b.index);

  const uniqueNames = [];
  const seen = new Set();
  for (const item of found) {
    const key = item.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueNames.push(item.name);
    }
  }

  if (uniqueNames.length !== 8) {
    return {
      ok: false,
      message: `OCR chỉ nhận ra ${uniqueNames.length}/8 tên.`,
      detectedNames: uniqueNames,
    };
  }

  return {
    ok: true,
    placements: uniqueNames,
  };
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('clientReady', async () => {
  console.log('Bot đã online');

  const commands = [
    new SlashCommandBuilder()
      .setName('register')
      .setDescription('Register player')
      .addStringOption((option) =>
        option.setName('name').setDescription('Ingame name').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('join')
      .setDescription('Join queue'),

    new SlashCommandBuilder()
      .setName('leave')
      .setDescription('Leave queue'),

    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('Show current queue'),

    new SlashCommandBuilder()
      .setName('current_match')
      .setDescription('Show current match'),

    new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Show leaderboard'),

    new SlashCommandBuilder()
      .setName('match_history')
      .setDescription('Show completed matches')
      .addIntegerOption((option) =>
        option.setName('limit').setDescription('How many matches').setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName('report_result')
      .setDescription('Upload result image and auto-score if OCR succeeds')
      .addIntegerOption((option) =>
        option.setName('match_id').setDescription('Match ID').setRequired(true)
      )
      .addAttachmentOption((option) =>
        option.setName('image').setDescription('Result image').setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('manual_result')
      .setDescription('Manual fallback result entry')
      .addIntegerOption((option) =>
        option.setName('match_id').setDescription('Match ID').setRequired(true)
      )
      .addStringOption((option) => option.setName('top1').setDescription('Top 1').setRequired(true))
      .addStringOption((option) => option.setName('top2').setDescription('Top 2').setRequired(true))
      .addStringOption((option) => option.setName('top3').setDescription('Top 3').setRequired(true))
      .addStringOption((option) => option.setName('top4').setDescription('Top 4').setRequired(true))
      .addStringOption((option) => option.setName('top5').setDescription('Top 5').setRequired(true))
      .addStringOption((option) => option.setName('top6').setDescription('Top 6').setRequired(true))
      .addStringOption((option) => option.setName('top7').setDescription('Top 7').setRequired(true))
      .addStringOption((option) => option.setName('top8').setDescription('Top 8').setRequired(true)),
  ].map((command) => command.toJSON());

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log('Đã đăng ký slash commands');
  } catch (error) {
    console.error('Lỗi đăng ký slash commands:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'register') {
      const name = interaction.options.getString('name', true).trim();

      if (getPlayerByDiscordId(interaction.user.id)) {
        await interaction.reply({
          content: 'Bạn đã đăng ký rồi.',
          ephemeral: true,
        });
        return;
      }

      if (getPlayerByName(name)) {
        await interaction.reply({
          content: 'Tên này đã được dùng.',
          ephemeral: true,
        });
        return;
      }

      data.players.push({
        discordId: interaction.user.id,
        name,
        points: 100,
        matchesPlayed: 0,
        wins: 0,
        top4: 0,
      });

      saveData();
      await interaction.reply(`Đăng ký thành công: **${name}** | Điểm khởi đầu: **100**`);
      return;
    }

    if (interaction.commandName === 'join') {
      const player = getPlayerByDiscordId(interaction.user.id);

      if (!player) {
        await interaction.reply({
          content: 'Bạn chưa đăng ký. Dùng `/register` trước.',
          ephemeral: true,
        });
        return;
      }

      if (data.queue.includes(interaction.user.id)) {
        await interaction.reply({
          content: 'Bạn đã ở trong queue rồi.',
          ephemeral: true,
        });
        return;
      }

      const inOpenMatch = data.matches.some(
        (m) =>
          m.status === 'OPEN' &&
          m.players.some((p) => p.discordId === interaction.user.id)
      );

      if (inOpenMatch) {
        await interaction.reply({
          content: 'Bạn đang nằm trong một match chưa chấm.',
          ephemeral: true,
        });
        return;
      }

      data.queue.push(interaction.user.id);
      saveData();

      const match = createMatchIfEnoughPlayers();

      if (match) {
        await interaction.reply(
          `**${player.name}** đã vào queue.\nĐủ 8 người, đã tạo **match #${match.id}**.\nDùng \`/current_match\` để xem danh sách.`
        );
        return;
      }

      await interaction.reply(
        `**${player.name}** đã vào queue. Hiện có **${data.queue.length}** người trong queue.`
      );
      return;
    }

    if (interaction.commandName === 'leave') {
      const index = data.queue.indexOf(interaction.user.id);

      if (index === -1) {
        await interaction.reply({
          content: 'Bạn không ở trong queue.',
          ephemeral: true,
        });
        return;
      }

      data.queue.splice(index, 1);
      saveData();

      await interaction.reply('Bạn đã rời queue.');
      return;
    }

    if (interaction.commandName === 'queue') {
      const names = getQueueNames();

      if (names.length === 0) {
        await interaction.reply('Queue đang trống.');
        return;
      }

      const lines = names.map((name, index) => `${index + 1}. ${name}`);
      await interaction.reply(
        `Hiện có **${names.length}** người trong queue:\n${lines.join('\n')}`
      );
      return;
    }

    if (interaction.commandName === 'current_match') {
      const openMatch = data.matches.find((m) => m.status === 'OPEN');

      if (!openMatch) {
        await interaction.reply('Hiện không có match nào đang mở.');
        return;
      }

      await interaction.reply(`\`\`\`\n${formatMatch(openMatch)}\n\`\`\``);
      return;
    }

    if (interaction.commandName === 'leaderboard') {
      const ranked = getRankedPlayers();

      if (ranked.length === 0) {
        await interaction.reply('Chưa có người chơi nào.');
        return;
      }

      const lines = ranked.slice(0, 20).map((player, index) => {
        return `${index + 1}. ${player.name} | ${player.points} điểm | ${player.matchesPlayed} trận | ${player.wins} top1 | ${player.top4} top4`;
      });

      await interaction.reply(`**Leaderboard**\n${lines.join('\n')}`);
      return;
    }

    if (interaction.commandName === 'match_history') {
      const limit = interaction.options.getInteger('limit') || 5;
      const completed = [...data.matches]
        .filter((m) => m.status === 'COMPLETED')
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);

      if (completed.length === 0) {
        await interaction.reply('Chưa có match nào hoàn thành.');
        return;
      }

      const blocks = completed.map((match) => {
        const sorted = [...match.players].sort((a, b) => a.placement - b.placement);
        const lines = sorted.map((p) => {
          const sign = p.pointsChange > 0 ? '+' : '';
          return `${p.placement}. ${p.name} (${sign}${p.pointsChange})`;
        });

        const imageLine = match.resultImageUrl
          ? `Image: ${match.resultImageUrl}`
          : 'Image: none';

        return `Match #${match.id}\n${lines.join('\n')}\n${imageLine}`;
      });

      await interaction.reply(`\`\`\`\n${blocks.join('\n\n')}\n\`\`\``);
      return;
    }

    if (interaction.commandName === 'report_result') {
      const matchId = interaction.options.getInteger('match_id', true);
      const image = interaction.options.getAttachment('image', true);

      const match = data.matches.find((m) => m.id === matchId);
      if (!match) {
        await interaction.reply({
          content: 'Không tìm thấy match.',
          ephemeral: true,
        });
        return;
      }

      match.resultImageUrl = image.url;
      saveData();

      await interaction.deferReply();

      let ocrText = '';
      try {
        ocrText = await extractTextFromImageUrl(image.url);
        match.ocrText = ocrText;
        saveData();
      } catch (error) {
        await interaction.editReply(
          `Đã lưu ảnh cho **match #${matchId}** nhưng OCR lỗi.\nLỗi: ${error.message}`
        );
        return;
      }

      const detected = detectPlacementsFromOcrText(match, ocrText);

      if (!detected.ok) {
        await interaction.editReply(
          `Đã lưu ảnh cho **match #${matchId}**.\nBot chưa tự chấm được.\n${detected.message}\nBot đọc được: ${detected.detectedNames.join(', ') || 'không đọc được tên nào'}`
        );
        return;
      }

      const result = applyResults(matchId, detected.placements);

      if (!result.ok) {
        await interaction.editReply(
          `Bot đọc được ảnh nhưng chấm không thành công.\nLý do: ${result.message}\nBot đọc thứ tự: ${detected.placements.join(', ')}`
        );
        return;
      }

      const updatedMatch = data.matches.find((m) => m.id === matchId);
      await interaction.editReply(
        `Bot đã tự chấm điểm cho **match #${matchId}**.\n\`\`\`\n${formatMatch(updatedMatch)}\n\`\`\``
      );
      return;
    }

    if (interaction.commandName === 'manual_result') {
      const matchId = interaction.options.getInteger('match_id', true);
      const placements = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
        interaction.options.getString(`top${n}`, true).trim()
      );

      const result = applyResults(matchId, placements);

      if (!result.ok) {
        await interaction.reply({
          content: result.message,
          ephemeral: true,
        });
        return;
      }

      const match = data.matches.find((m) => m.id === matchId);
      await interaction.reply(
        `${result.message}\n\`\`\`\n${formatMatch(match)}\n\`\`\``
      );
      return;
    }
  } catch (error) {
    console.error(error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'Có lỗi xảy ra.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'Có lỗi xảy ra.',
        ephemeral: true,
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);