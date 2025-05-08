"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const telegraf_1 = require("telegraf");
const filters_1 = require("telegraf/filters");
const qrcode = __importStar(require("qrcode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const dotenv_1 = require("dotenv");
// Загрузка переменных окружения
(0, dotenv_1.config)();
// Проверка наличия токена
if (!process.env.BOT_TOKEN) {
    console.error('Ошибка: BOT_TOKEN не найден в переменных окружения!');
    console.error('Пожалуйста, создайте файл .env и добавьте в него BOT_TOKEN=your_token_here');
    process.exit(1);
}
// Инициализация бота
const bot = new telegraf_1.Telegraf(process.env.BOT_TOKEN);
// Обработка команды /start
bot.command('start', async (ctx) => {
    const welcomeMessage = `
👋 Привет! Я бот для генерации QR-кодов.

📝 Как использовать:
1. Просто отправьте мне любую ссылку
2. Я сгенерирую QR-код для этой ссылки
3. Вы получите изображение QR-кода

🔍 Доступные команды:
/start - Показать это сообщение
/help - Показать справку
    `;
    await ctx.reply(welcomeMessage, telegraf_1.Markup.keyboard([
        ['📝 Справка']
    ]).resize());
});
// Обработка команды /help
bot.command('help', async (ctx) => {
    const helpMessage = `
📝 Справка по использованию бота:

1. Отправьте любую ссылку, и я сгенерирую QR-код
2. Поддерживаются все форматы ссылок (http://, https://, ftp:// и т.д.)
3. QR-код будет отправлен вам в виде изображения
4. Изображение автоматически удалится через 5 минут

⚠️ Ограничения:
- Максимальная длина ссылки: 2048 символов
- Поддерживаются только текстовые ссылки
    `;
    await ctx.reply(helpMessage);
});
// Обработка текстовых сообщений
bot.on((0, filters_1.message)('text'), async (ctx) => {
    const text = ctx.message.text;
    // Проверка на кнопку "Справка"
    if (text === '📝 Справка') {
        await ctx.reply('Отправьте мне любую ссылку, и я сгенерирую QR-код для неё!');
        return;
    }
    // Проверка, является ли текст URL
    try {
        new URL(text);
    }
    catch {
        await ctx.reply('Пожалуйста, отправьте корректную ссылку!');
        return;
    }
    try {
        // Генерация QR-кода
        const qrCodePath = path.join(__dirname, 'temp', `${Date.now()}.png`);
        // Создаем временную директорию, если её нет
        if (!fs.existsSync(path.join(__dirname, 'temp'))) {
            fs.mkdirSync(path.join(__dirname, 'temp'));
        }
        // Генерируем QR-код
        await qrcode.toFile(qrCodePath, text, {
            width: 400,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#ffffff'
            }
        });
        // Отправляем QR-код
        await ctx.replyWithPhoto({ source: qrCodePath });
        // Удаляем файл через 5 минут
        setTimeout(() => {
            if (fs.existsSync(qrCodePath)) {
                fs.unlinkSync(qrCodePath);
            }
        }, 5 * 60 * 1000);
    }
    catch (error) {
        console.error('Error generating QR code:', error);
        await ctx.reply('Произошла ошибка при генерации QR-кода. Пожалуйста, попробуйте позже.');
    }
});
// Запуск бота
bot.launch().then(() => {
    console.log('Bot started successfully!');
}).catch((error) => {
    console.error('Error starting bot:', error);
});
// Обработка завершения работы
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
