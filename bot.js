
// ... etc
const { Telegraf, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const MINI_APP_URL = 'https://abdurakhimsrogresstrackinggbot.vercel.app';

// ============ CONFIG ============
require('dotenv').config();
const BOT_TOKEN = process.env.BOT_TOKEN;
const DB_PATH = path.join(__dirname, 'tracker.db');

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set. Add to .env file');
  process.exit(1);
}

// ============ DATABASE (SQLite - No server needed) ============
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('DB Error:', err);
  else console.log('✅ Connected to SQLite');
});

function initDB() {
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_text TEXT NOT NULL,
      date TEXT NOT NULL,
      completed BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      energy INTEGER,
      focus INTEGER,
      motivation INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date)
    )
  `);

  console.log('✅ Database tables initialized');
}

// ============ HELPERS ============
function today() {
  return new Date().toISOString().split('T')[0];
}

function getWeekDays() {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());

  return days.map((name, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return { name, date: d.toISOString().split('T')[0] };
  });
}

// ============ DATABASE QUERIES ============
function getTodayTasks(callback) {
  db.all(
    'SELECT * FROM tasks WHERE date = ? ORDER BY created_at',
    [today()],
    callback
  );
}

function addTask(taskText, callback) {
  db.run(
    'INSERT INTO tasks (task_text, date) VALUES (?, ?)',
    [taskText, today()],
    callback
  );
}

function toggleTask(taskId, callback) {
  db.get('SELECT completed FROM tasks WHERE id = ?', [taskId], (err, row) => {
    if (row) {
      db.run(
        'UPDATE tasks SET completed = ? WHERE id = ?',
        [row.completed ? 0 : 1, taskId],
        callback
      );
    }
  });
}

function getWeekStats(callback) {
  const weekDays = getWeekDays();
  const stats = {};

  let completed = 0;
  weekDays.forEach((day) => {
    db.get(
      'SELECT COUNT(*) as total, SUM(completed) as done FROM tasks WHERE date = ?',
      [day.date],
      (err, row) => {
        const total = row.total || 0;
        const done = row.done || 0;
        stats[day.name] = {
          total,
          done,
          percent: total > 0 ? Math.round((done / total) * 100) : 0
        };

        completed++;
        if (completed === weekDays.length) {
          callback(stats);
        }
      }
    );
  });
}

function saveCheckin(energy, focus, motivation, callback) {
  db.run(
    `INSERT OR REPLACE INTO checkins (date, energy, focus, motivation)
     VALUES (?, ?, ?, ?)`,
    [today(), energy, focus, motivation],
    callback
  );
}

function getCurrentStreak(callback) {
  let streak = 0;
  let currentDate = new Date();

  function checkDay() {
    const dateStr = currentDate.toISOString().split('T')[0];
    db.get(
      `SELECT COUNT(*) as total, SUM(completed) as done 
       FROM tasks WHERE date = ?`,
      [dateStr],
      (err, row) => {
        const total = row.total || 0;
        const done = row.done || 0;

        if (total > 0 && done === total) {
          streak++;
          currentDate.setDate(currentDate.getDate() - 1);
          checkDay();
        } else {
          callback(streak);
        }
      }
    );
  }

  checkDay();
}

// ============ BOT SETUP ============
const bot = new Telegraf(BOT_TOKEN);

// ============ COMMANDS ============
bot.start((ctx) => {
  ctx.reply(
    '🎯 Personal Task Tracker\n\n' +
    'Your productivity dashboard is ready!',
    Markup.inlineKeyboard([
      [Markup.button.webApp('📊 Open Dashboard', MINI_APP_URL)],
      [Markup.button.callback('/today', 'cmd_today')]
    ])
  );
});
// TODAY
bot.command('today', (ctx) => {
  getTodayTasks((err, tasks) => {
    if (!tasks || tasks.length === 0) {
      ctx.reply('📭 No tasks today. Use /add to create one.');
      return;
    }

    let message = `📋 Today (${today()}):\n\n`;
    const keyboard = [];

    tasks.forEach((task) => {
      const icon = task.completed ? '✅' : '⬜';
      message += `${icon} ${task.task_text}\n`;
      keyboard.push([
        Markup.button.callback(
          `${task.completed ? '✓' : '□'} ${task.task_text}`,
          `task_${task.id}`
        )
      ]);
    });

    keyboard.push([Markup.button.callback('➕ Add Task', 'cmd_add')]);
    ctx.replyWithHTML(message, Markup.inlineKeyboard(keyboard));
  });
});

// ADD TASK
bot.command('add', (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.addingTask = true;
  ctx.reply('📝 What task? (e.g., "Morning workout")');
});

// STATS
bot.command('stats', (ctx) => {
  getWeekStats((stats) => {
    let message = '📊 Weekly Progress:\n\n';
    let totalDone = 0,
      totalTasks = 0;

    for (const [day, data] of Object.entries(stats)) {
      const bar = '█'.repeat(Math.round(data.percent / 10)) +
                  '░'.repeat(10 - Math.round(data.percent / 10));
      message += `${day}: [${bar}] ${data.percent}% (${data.done}/${data.total})\n`;
      totalDone += data.done;
      totalTasks += data.total;
    }

    const overall = totalTasks > 0 ? Math.round((totalDone / totalTasks) * 100) : 0;
    message += `\n📈 Overall: ${overall}%`;

    ctx.reply(message);
  });
});

// CHECKIN
bot.command('checkin', (ctx) => {
  ctx.reply(
    '🧠 Rate your mindset today (1-10):\n\n' +
    'Energy / Focus / Motivation\n\n' +
    'Send as: "8 7 9"',
    Markup.keyboard([
      ['1 1 1', '5 5 5', '10 10 10'],
      ['/today', '/cancel']
    ]).resize()
  );
  ctx.session = ctx.session || {};
  ctx.session.waitingCheckin = true;
});

// STREAK
bot.command('streak', (ctx) => {
  getCurrentStreak((streak) => {
    const fire = '🔥'.repeat(Math.min(streak, 5));
    ctx.reply(`${fire} Current Streak: ${streak} days`);
  });
});

// CLEAR TODAY
bot.command('clear', (ctx) => {
  db.run('DELETE FROM tasks WHERE date = ?', [today()], () => {
    ctx.reply('🗑️ Today\'s tasks cleared');
  });
});

// TEXT INPUT (Add task or checkin)
bot.on('text', (ctx) => {
  ctx.session = ctx.session || {};

  // Adding task
  if (ctx.session.addingTask) {
    addTask(ctx.message.text, () => {
      ctx.reply('✅ Task added!', Markup.removeKeyboard());
      ctx.session.addingTask = false;
    });
    return;
  }

  // Saving checkin
  if (ctx.session.waitingCheckin) {
    const parts = ctx.message.text.split(' ').map(Number);
    if (parts.length === 3 && parts.every(n => n >= 1 && n <= 10)) {
      saveCheckin(parts[0], parts[1], parts[2], () => {
        ctx.reply('✅ Checkin saved!', Markup.removeKeyboard());
        ctx.session.waitingCheckin = false;
      });
    } else {
      ctx.reply('❌ Format: "8 7 9" (three numbers 1-10)');
    }
    return;
  }
});

// CALLBACKS (Task toggle)
bot.action(/task_(\d+)/, (ctx) => {
  const taskId = parseInt(ctx.match[1]);
  toggleTask(taskId, () => {
    ctx.answerCbQuery('✅ Updated');
    ctx.deleteMessage();
    // Refresh the list
    ctx.scene.leave();
    bot.telegram.sendMessage(ctx.chat.id, '📋 Refreshing...');
    getTodayTasks((err, tasks) => {
      if (!tasks || tasks.length === 0) return;

      let message = `📋 Today (${today()}):\n\n`;
      const keyboard = [];

      tasks.forEach((task) => {
        const icon = task.completed ? '✅' : '⬜';
        message += `${icon} ${task.task_text}\n`;
        keyboard.push([
          Markup.button.callback(
            `${task.completed ? '✓' : '□'} ${task.task_text}`,
            `task_${task.id}`
          )
        ]);
      });

      keyboard.push([Markup.button.callback('➕ Add Task', 'cmd_add')]);
      ctx.reply(message, Markup.inlineKeyboard(keyboard));
    });
  });
});

// LAUNCH
initDB();
bot.launch();
console.log('🚀 Bot running. Send /start to test.');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));